// ============================================================================
// lib/worker-registry.js — P2 (feature/worker-fleet)
//
// Central worker registry for the 10-worker fleet. MongoDB is the control
// plane: workers register and heartbeat directly into the `Workers`
// collection (same pattern as the existing ConnectionLock). No worker is
// ever fabricated — a slot with no document is NOT PROVISIONED.
//
// Collections:
//   Workers: { workerId, status, capacityMax, activeSessions, rssMB,
//              uptimeSec, error, lastHeartbeat, registeredAt, version }
//   WorkerEvents: append-only { ts, workerId, event, detail }
// ============================================================================

const { model } = require('./mongo');

const Workers = () => model('Workers');
const WorkerEvents = () => model('WorkerEvents');

const SLOT_IDS = Array.from({ length: 10 }, (_, i) => `worker-${String(i + 1).padStart(2, '0')}`);
const HEARTBEAT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_CAPACITY = 50;

async function logEvent(workerId, event, detail = '') {
    try {
        await WorkerEvents().create({ ts: new Date(), workerId, event, detail: String(detail).slice(0, 500) });
    } catch (e) { /* audit log must never break the registry */ }
}

// F3: strict input validation. Rejects unknown slots, out-of-range capacity
// (hard max 50), non-numeric telemetry, and oversized strings.
function validateWorkerId(workerId) {
    if (!SLOT_IDS.includes(workerId)) throw new Error(`unknown worker slot: ${workerId}`);
}
function toSafeInt(v, fallback = 0) {
    if (v === undefined || v === null) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`invalid numeric telemetry: ${v}`);
    return Math.floor(n);
}
function validateCapacity(cap) {
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error(`invalid capacityMax (must be 1-50): ${cap}`);
    return n;
}
function validateTelemetry(stats = {}) {
    return {
        activeSessions: toSafeInt(stats.activeSessions, 0),
        rssMB: toSafeInt(stats.rssMB, 0),
        uptimeSec: toSafeInt(stats.uptimeSec, 0),
        error: String(stats.error || '').slice(0, 300),
        version: String(stats.version || '').slice(0, 50),
    };
}

// Register (or re-register) a worker. Idempotent.
async function registerWorker(workerId, info = {}) {
    validateWorkerId(workerId);
    const capacityMax = info.capacityMax !== undefined ? validateCapacity(info.capacityMax) : DEFAULT_CAPACITY;
    const t = validateTelemetry(info);
    const now = new Date();
    const doc = await Workers().findOneAndUpdate(
        { workerId },
        {
            $set: {
                workerId, status: 'online', lastHeartbeat: now,
                capacityMax, rssMB: t.rssMB, uptimeSec: t.uptimeSec,
                error: '', version: t.version,
            },
            $setOnInsert: { registeredAt: now, reservedCount: 0, activeSessions: 0 },
        },
        { upsert: true, returnDocument: 'after' }
    );
    await logEvent(workerId, 'register', `capacity=${doc.capacityMax}`);
    return doc;
}

// Heartbeat from a running worker. Updates liveness + load stats.
async function heartbeatWorker(workerId, stats = {}) {
    validateWorkerId(workerId);
    const t = validateTelemetry(stats);
    const res = await Workers().findOneAndUpdate(
        { workerId },
        {
            $set: {
                status: 'online', lastHeartbeat: new Date(),
                activeSessions: t.activeSessions,
                rssMB: t.rssMB, uptimeSec: t.uptimeSec,
                error: t.error,
            },
        },
        { returnDocument: 'after' }
    );
    if (!res) throw new Error(`heartbeat from unregistered worker: ${workerId}`);
    return res;
}

// Mark workers whose heartbeat is stale as offline. Returns the count marked.
async function markStaleWorkers(timeoutMs = HEARTBEAT_TIMEOUT_MS) {
    const cutoff = new Date(Date.now() - timeoutMs);
    const res = await Workers().updateMany(
        { status: 'online', lastHeartbeat: { $lt: cutoff } },
        { $set: { status: 'offline', error: 'heartbeat timeout' } }
    );
    const n = res.modifiedCount || 0;
    if (n) {
        const stale = await Workers().find({ status: 'offline', error: 'heartbeat timeout' });
        for (const w of stale) await logEvent(w.workerId, 'heartbeat-timeout', 'marked offline');
    }
    return n;
}

// All 10 slots with honest status. Unregistered slots => NOT PROVISIONED.
async function getFleetStatus() {
    const docs = await Workers().find({});
    const byId = new Map(docs.map(d => [d.workerId, d]));
    const now = Date.now();
    const slots = SLOT_IDS.map(id => {
        const d = byId.get(id);
        if (!d) {
            return { workerId: id, provisioned: false, status: 'not_provisioned', activeSessions: 0, capacityMax: DEFAULT_CAPACITY };
        }
        const staleMs = now - new Date(d.lastHeartbeat).getTime();
        return {
            workerId: id, provisioned: true,
            status: staleMs > HEARTBEAT_TIMEOUT_MS ? 'offline' : d.status,
            activeSessions: d.activeSessions || 0, capacityMax: d.capacityMax || DEFAULT_CAPACITY,
            rssMB: d.rssMB || 0, uptimeSec: d.uptimeSec || 0,
            error: d.error || '', lastHeartbeat: d.lastHeartbeat,
            staleMs,
        };
    });
    const totalActive = slots.reduce((a, s) => a + s.activeSessions, 0);
    return {
        slots,
        totals: {
            workers: 10,
            provisioned: slots.filter(s => s.provisioned).length,
            online: slots.filter(s => s.status === 'online').length,
            offline: slots.filter(s => s.status === 'offline').length,
            notProvisioned: slots.filter(s => !s.provisioned).length,
            activeSessions: totalActive,
            capacityMax: 10 * DEFAULT_CAPACITY,
        },
        generatedAt: new Date(),
    };
}

async function getRecentEvents(limit = 50) {
    const all = await WorkerEvents().find({});
    return all.sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, limit);
}

module.exports = {
    SLOT_IDS, HEARTBEAT_TIMEOUT_MS, DEFAULT_CAPACITY,
    registerWorker, heartbeatWorker, markStaleWorkers,
    getFleetStatus, getRecentEvents, logEvent,
};
