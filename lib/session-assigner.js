// ============================================================================
// lib/session-assigner.js — P2 (feature/worker-fleet)
//
// Atomic session-to-worker assignment. Uses ONLY the new `SessionAssignments`
// collection — existing `Session`, `SessionKeys`, `ActiveNumber` collections
// and all live WhatsApp sessions are NEVER touched by this module.
//
// States: unassigned -> assigned -> active -> (failed | unassigned)
// Claims are atomic via findOneAndUpdate. On ANY database error the claim
// FAILS CLOSED (throws) — it never grants a session it cannot record.
// ============================================================================

const { model } = require('./mongo');
const { DEFAULT_CAPACITY, logEvent } = require('./worker-registry');

const Assignments = () => model('SessionAssignments');

// REQUIRED INDEX (create once): db.SessionAssignments.createIndex({ number: 1 }, { unique: true })
// Without it, two workers racing an upsert can both create a doc. With it,
// the loser's upsert throws E11000, which we convert to ALREADY_CLAIMED.
// Atomic claim: exactly one worker wins, even under race.
// Throws on DB error (fail-closed) or when the worker is at capacity.
async function claimSession(number, workerId, capacityMax = DEFAULT_CAPACITY) {
    const n = String(number).replace(/[^0-9]/g, '');
    if (!n) throw new Error('invalid number');

    // capacity check (best-effort pre-check; the atomic filter below is the guarantee)
    const active = await Assignments().countDocuments({ workerId, state: { $in: ['assigned', 'active'] } });
    if (active >= capacityMax) {
        const err = new Error(`capacity-exceeded: ${workerId} at ${active}/${capacityMax}`);
        err.code = 'CAPACITY_EXCEEDED';
        throw err;
    }

    const now = new Date();
    let doc;
    try {
        doc = await Assignments().findOneAndUpdate(
            {
                number: n,
                $or: [
                    { state: 'unassigned' },
                    { state: 'failed' },
                    // stale lease: assigned but never activated and lease expired
                    { state: 'assigned', leaseExpiresAt: { $lt: now } },
                ],
            },
            {
                $set: {
                    number: n, workerId, state: 'assigned',
                    claimedAt: now, updatedAt: now,
                    leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
                },
            },
            { upsert: true, returnDocument: 'after' }
        );
    } catch (e) {
        // Duplicate key = another worker won the upsert race (unique index on number).
        if (e.code === 11000 || /duplicate key/i.test(e.message || '')) {
            const err = new Error(`already-claimed: ${n} (race lost)`);
            err.code = 'ALREADY_CLAIMED';
            throw err;
        }
        // FAIL CLOSED: never hand out a session we couldn't record.
        throw new Error(`assignment DB error (fail-closed): ${e.message}`);
    }

    // If the doc already belonged to a live worker, the claim lost the race.
    if (doc.workerId !== workerId && ['assigned', 'active'].includes(doc.state)) {
        const err = new Error(`already-claimed: ${n} held by ${doc.workerId}`);
        err.code = 'ALREADY_CLAIMED';
        throw err;
    }
    await logEvent(workerId, 'session-claimed', n);
    return doc;
}

// Mark a claimed session as fully active (socket connected).
async function markSessionActive(number, workerId) {
    const n = String(number).replace(/[^0-9]/g, '');
    return Assignments().findOneAndUpdate(
        { number: n, workerId, state: 'assigned' },
        { $set: { state: 'active', updatedAt: new Date(), leaseExpiresAt: null } },
        { returnDocument: 'after' }
    );
}

// Release a session back to the pool (worker shutdown, manual unassign).
async function releaseSession(number, workerId = null) {
    const n = String(number).replace(/[^0-9]/g, '');
    const filter = workerId ? { number: n, workerId } : { number: n };
    const doc = await Assignments().findOneAndUpdate(
        filter,
        { $set: { state: 'unassigned', workerId: null, updatedAt: new Date(), leaseExpiresAt: null } },
        { returnDocument: 'after' }
    );
    if (doc) await logEvent(workerId || 'controller', 'session-released', n);
    return doc;
}

// Sessions currently held by a worker.
async function getWorkerSessions(workerId) {
    return Assignments().find({ workerId, state: { $in: ['assigned', 'active'] } });
}

// Reassign sessions held by dead workers. Returns reassigned count.
// Never touches sessions held by workers that are still online.
async function reassignOrphanedSessions(isWorkerOnline) {
    const held = await Assignments().find({ state: { $in: ['assigned', 'active'] } });
    let n = 0;
    for (const a of held) {
        if (!a.workerId) continue;
        let online = false;
        try { online = await isWorkerOnline(a.workerId); } catch (e) { online = true; } // fail-closed: don't steal on DB error
        if (!online) {
            await Assignments().findOneAndUpdate(
                { number: a.number, workerId: a.workerId },
                { $set: { state: 'unassigned', workerId: null, updatedAt: new Date(), leaseExpiresAt: null } }
            );
            await logEvent('controller', 'session-orphaned-released', `${a.number} from ${a.workerId}`);
            n++;
        }
    }
    return n;
}

module.exports = {
    claimSession, markSessionActive, releaseSession,
    getWorkerSessions, reassignOrphanedSessions,
};
