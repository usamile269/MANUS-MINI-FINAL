// ============================================================================
// lib/session-assigner.js — P2 (feature/worker-fleet)
//
// Atomic session-to-worker assignment. Uses ONLY the new `SessionAssignments`
// collection — existing `Session`, `SessionKeys`, `ActiveNumber` collections
// and all live WhatsApp sessions are NEVER touched by this module.
//
// States: unassigned -> assigned -> active -> (failed | unassigned)
//
// CORRECTNESS FOUNDATIONS:
//  1. UNIQUE INDEX on { number: 1 } (see scripts/setup-fleet-indexes.js).
//     Without it, two workers racing an upsert can BOTH win. With it, the
//     loser gets E11000 -> ALREADY_CLAIMED. Best-effort ensured at runtime.
//  2. ATOMIC CAPACITY RESERVATION: the 50-cap is enforced by an atomic
//     $inc on Workers.reservedCount guarded by { reservedCount: { $lt: 50 } }.
//     A pre-check count alone can be raced; the atomic reservation cannot.
//  3. FAIL-CLOSED: on ANY database error the claim throws — never grants a
//     session it cannot record.
//  4. LEASES: assignments carry leaseExpiresAt. A dead worker's sessions are
//     only released after the lease expires AND the worker is confirmed
//     offline — never while it could still be connected.
// ============================================================================

const { model } = require('./mongo');
const { DEFAULT_CAPACITY, logEvent } = require('./worker-registry');

const Assignments = () => model('SessionAssignments');
const Workers = () => model('Workers');

const LEASE_MS = 5 * 60 * 1000;

// Best-effort runtime index ensure. Primary path is scripts/setup-fleet-indexes.js.
async function ensureAssignmentIndex() {
    try {
        const m = Assignments();
        const col = m._col ? await m._col() : null;
        if (col && col.createIndex) {
            await col.createIndex({ number: 1 }, { unique: true, name: 'uniq_number' });
        }
    } catch (e) { /* setup script is the primary path; this is best-effort */ }
}

function sanitizeNumber(number) {
    const n = String(number || '').replace(/[^0-9]/g, '');
    if (!n || n.length < 8 || n.length > 15) throw new Error('invalid number');
    return n;
}

// Atomic capacity reservation: increments Workers.reservedCount ONLY if < max.
// Returns true if reserved, false if at capacity. Genuinely atomic via MongoDB.
async function reserveSlot(workerId, capacityMax) {
    const doc = await Workers().findOneAndUpdate(
        { workerId, reservedCount: { $lt: capacityMax } },
        { $inc: { reservedCount: 1 } },
        { returnDocument: 'after' }
    );
    return !!doc;
}

async function releaseSlot(workerId) {
    await Workers().findOneAndUpdate(
        { workerId, reservedCount: { $gt: 0 } },
        { $inc: { reservedCount: -1 } }
    );
}

// Atomic claim: exactly one worker wins, even under race.
// Capacity is reserved atomically BEFORE the claim; released if claim fails.
async function claimSession(number, workerId, capacityMax = DEFAULT_CAPACITY) {
    const n = sanitizeNumber(number);
    if (!workerId) throw new Error('workerId required');

    await ensureAssignmentIndex();

    // 1. atomic reservation (the real capacity guard)
    let reserved = false;
    try {
        reserved = await reserveSlot(workerId, capacityMax);
    } catch (e) {
        throw new Error(`assignment DB error (fail-closed): ${e.message}`);
    }
    if (!reserved) {
        const err = new Error(`capacity-exceeded: ${workerId} at ${capacityMax}/${capacityMax}`);
        err.code = 'CAPACITY_EXCEEDED';
        throw err;
    }

    // 2. atomic claim
    const now = new Date();
    try {
        const doc = await Assignments().findOneAndUpdate(
            {
                number: n,
                $or: [
                    { state: 'unassigned' },
                    { state: 'failed' },
                    { state: 'assigned', leaseExpiresAt: { $lt: now } },
                ],
            },
            {
                $set: {
                    number: n, workerId, state: 'assigned',
                    claimedAt: now, updatedAt: now,
                    leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
                },
            },
            { upsert: true, returnDocument: 'after' }
        );
        // If the doc belongs to a live claim by another worker, we lost.
        if (doc.workerId !== workerId && ['assigned', 'active'].includes(doc.state)) {
            await releaseSlot(workerId);
            const err = new Error(`already-claimed: ${n} held by ${doc.workerId}`);
            err.code = 'ALREADY_CLAIMED';
            throw err;
        }
        await logEvent(workerId, 'session-claimed', n);
        return doc;
    } catch (e) {
        if (e.code === 'ALREADY_CLAIMED') throw e;
        await releaseSlot(workerId).catch(() => {});
        if (e.code === 11000 || /duplicate key/i.test(e.message || '')) {
            const err = new Error(`already-claimed: ${n} (race lost)`);
            err.code = 'ALREADY_CLAIMED';
            throw err;
        }
        throw new Error(`assignment DB error (fail-closed): ${e.message}`);
    }
}

// Mark claimed session as active + extend lease (called after socket connects).
async function markSessionActive(number, workerId) {
    const n = sanitizeNumber(number);
    return Assignments().findOneAndUpdate(
        { number: n, workerId, state: 'assigned' },
        { $set: { state: 'active', updatedAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) } },
        { returnDocument: 'after' }
    );
}

// Extend leases for all of a worker's sessions (called on heartbeat).
async function renewLeases(workerId) {
    await Assignments().updateMany(
        { workerId, state: { $in: ['assigned', 'active'] } },
        { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS), updatedAt: new Date() } }
    );
}

// Release a session back to the pool. Releases the capacity slot too.
async function releaseSession(number, workerId = null) {
    const n = sanitizeNumber(number);
    const filter = workerId ? { number: n, workerId } : { number: n };
    const doc = await Assignments().findOneAndUpdate(
        filter,
        { $set: { state: 'unassigned', workerId: null, updatedAt: new Date(), leaseExpiresAt: null } },
        { returnDocument: 'after' }
    );
    if (doc) {
        if (doc.workerId || workerId) await releaseSlot(doc.workerId || workerId).catch(() => {});
        await logEvent(workerId || 'controller', 'session-released', n);
    }
    return doc;
}

async function getWorkerSessions(workerId) {
    return Assignments().find({ workerId, state: { $in: ['assigned', 'active'] } });
}

// Safe orphan recovery: release ONLY sessions where
//   (a) the lease has EXPIRED (worker had 5 min to renew), AND
//   (b) the worker is confirmed offline (or unknown).
// Never releases while the previous worker could still be connected.
async function reassignOrphanedSessions(isWorkerOnline) {
    const now = new Date();
    const held = await Assignments().find({ state: { $in: ['assigned', 'active'] } });
    let n = 0;
    for (const a of held) {
        if (!a.workerId) continue;
        // lease still valid -> worker might be alive, do not touch
        if (a.leaseExpiresAt && new Date(a.leaseExpiresAt) > now) continue;
        let online = true; // fail-closed: on DB error assume online (don't steal)
        try { online = await isWorkerOnline(a.workerId); } catch (e) { online = true; }
        if (!online) {
            await Assignments().findOneAndUpdate(
                { number: a.number, workerId: a.workerId },
                { $set: { state: 'unassigned', workerId: null, updatedAt: new Date(), leaseExpiresAt: null } }
            );
            await releaseSlot(a.workerId).catch(() => {});
            await logEvent('controller', 'session-orphaned-released', `${a.number} from ${a.workerId}`);
            n++;
        }
    }
    return n;
}

module.exports = {
    LEASE_MS,
    claimSession, markSessionActive, renewLeases, releaseSession,
    getWorkerSessions, reassignOrphanedSessions,
    ensureAssignmentIndex, reserveSlot, releaseSlot,
};
