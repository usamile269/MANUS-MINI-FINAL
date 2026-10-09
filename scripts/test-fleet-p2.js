// P2 fleet tests: worker registry + atomic assignment (concurrency + recovery).
// Uses a faithful in-memory mock of model() implementing the MongoDB API
// surface used by the libs (findOne, find, create, findOneAndUpdate,
// updateMany, countDocuments) with real atomic compare-and-set semantics.
const assert = require('assert');
const Module = require('module');
const path = require('path');

// ---- in-memory mock ----
function makeCollection() {
    const docs = [];
    const matches = (d, f) => Object.entries(f).every(([k, v]) => {
        if (k === '$or') return v.some(sub => matches(d, sub));
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            return Object.entries(v).every(([op, val]) => {
                const dv = d[k];
                if (op === '$lt') return dv < val;
                if (op === '$in') return val.includes(dv);
                return false;
            });
        }
        return d[k] === v;
    });
    const applySet = (d, set) => { for (const [k, v] of Object.entries(set)) d[k] = v; };
    return {
        _docs: docs,
        async findOne(f) { return docs.find(d => matches(d, f)) || null; },
        async find(f = {}) { return docs.filter(d => matches(d, f)); },
        async create(d) { const c = { ...d, _id: String(docs.length + 1) }; docs.push(c); return c; },
        async countDocuments(f = {}) { return docs.filter(d => matches(d, f)).length; },
        // ATOMIC: single-threaded find+update = compare-and-set.
        // Simulates unique index on `number`: duplicate upsert -> E11000.
        async findOneAndUpdate(filter, update, opts = {}) {
            let d = docs.find(x => matches(x, filter));
            if (!d && opts.upsert) {
                const newDoc = { ...filter };
                for (const [k, v] of Object.entries(filter)) {
                    if (k !== '$or' && (typeof v !== 'object' || v === null)) newDoc[k] = v;
                }
                if (update.$set && update.$set.number) {
                    const dup = docs.find(x => x.number === update.$set.number);
                    if (dup) { const e = new Error('duplicate key error'); e.code = 11000; throw e; }
                }
                docs.push(newDoc);
                d = newDoc;
            }
            if (!d) return null;
            if (update.$set) applySet(d, update.$set);
            if (update.$setOnInsert && !d._touched) { applySet(d, update.$setOnInsert); }
            d._touched = true;
            return { ...d };
        },
        async updateMany(filter, update) {
            let n = 0;
            for (const d of docs) if (matches(d, filter)) { applySet(d, update.$set || {}); n++; }
            return { modifiedCount: n };
        },
    };
}

const collections = { Workers: makeCollection(), WorkerEvents: makeCollection(), SessionAssignments: makeCollection() };

// inject mock before requiring libs
const libDir = '/tmp/fleettest/lib';
require('fs').mkdirSync(libDir, { recursive: true });
require('fs').copyFileSync('/tmp/worker-registry.js', libDir + '/worker-registry.js');
require('fs').copyFileSync('/tmp/session-assigner.js', libDir + '/session-assigner.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
    if (req === './mongo') return path.join(libDir, 'mock-mongo.js');
    if (req === './worker-registry') return path.join(libDir, 'worker-registry.js');
    return origResolve.call(this, req, ...rest);
};
require('fs').writeFileSync(libDir + '/mock-mongo.js',
    `module.exports = { model: (name) => (${JSON.stringify('__COLLECTIONS__')} , global.__cols[name]) };`);
global.__cols = collections;

const registry = require(libDir + '/worker-registry.js');
const assigner = require(libDir + '/session-assigner.js');

(async () => {
    let t = 0;
    const ok = (name) => { t++; console.log(`${t}. ${name}: PASS`); };

    // --- T1: register + heartbeat ---
    await registry.registerWorker('worker-01', { capacityMax: 50 });
    const hb = await registry.heartbeatWorker('worker-01', { activeSessions: 3, rssMB: 400, uptimeSec: 100 });
    assert.strictEqual(hb.activeSessions, 3);
    ok('T1 register + heartbeat');

    // --- T2: heartbeat timeout -> offline ---
    collections.Workers._docs.find(d => d.workerId === 'worker-01').lastHeartbeat = new Date(Date.now() - 60000);
    const marked = await registry.markStaleWorkers(30000);
    assert.strictEqual(marked, 1);
    const fleet = await registry.getFleetStatus();
    const w01 = fleet.slots.find(s => s.workerId === 'worker-01');
    assert.strictEqual(w01.status, 'offline');
    ok('T2 stale heartbeat -> offline');

    // --- T3: unregistered slots NEVER fake online ---
    const w05 = fleet.slots.find(s => s.workerId === 'worker-05');
    assert.strictEqual(w05.provisioned, false);
    assert.strictEqual(w05.status, 'not_provisioned');
    assert.strictEqual(fleet.totals.notProvisioned, 9);
    assert.strictEqual(fleet.totals.online, 0); // worker-01 is offline
    ok('T3 unprovisioned slots honest');

    // --- T4: atomic claim race — 2 workers, 1 session, 50 attempts ---
    for (let i = 0; i < 50; i++) {
        collections.SessionAssignments._docs.length = 0;
        const results = await Promise.allSettled([
            assigner.claimSession('923001234567', 'worker-01'),
            assigner.claimSession('923001234567', 'worker-02'),
        ]);
        const won = results.filter(r => r.status === 'fulfilled').length;
        assert.strictEqual(won, 1, `race ${i}: exactly 1 winner, got ${won}`);
    }
    ok('T4 claim race: exactly 1 winner x50');

    // --- T5: 50-session cap enforced ---
    collections.SessionAssignments._docs.length = 0;
    for (let i = 0; i < 50; i++) {
        await assigner.claimSession(`92300000${String(i).padStart(3, '0')}`, 'worker-01');
    }
    let capErr = null;
    try { await assigner.claimSession('923009999999', 'worker-01'); }
    catch (e) { capErr = e; }
    assert.ok(capErr && capErr.code === 'CAPACITY_EXCEEDED');
    ok('T5 50-cap enforced, 51st refused');

    // --- T6: failover — offline worker sessions released, online untouched ---
    collections.SessionAssignments._docs.length = 0;
    await assigner.claimSession('923001111111', 'worker-01'); // worker-01 offline
    await assigner.claimSession('923002222222', 'worker-02'); // worker-02 online
    await registry.registerWorker('worker-02', {});
    await registry.heartbeatWorker('worker-02', { activeSessions: 1 });
    const isOnline = async (id) => {
        const d = await collections.Workers.findOne({ workerId: id });
        return d && d.status === 'online' && (Date.now() - new Date(d.lastHeartbeat).getTime()) < 30000;
    };
    const n = await assigner.reassignOrphanedSessions(isOnline);
    assert.strictEqual(n, 1);
    const remaining = await assigner.getWorkerSessions('worker-02');
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].number, '923002222222');
    ok('T6 failover: orphan released, live untouched');

    // --- T7: fail-closed on DB error ---
    const badCols = { SessionAssignments: { countDocuments: async () => { throw new Error('mongo down'); } } };
    global.__cols = { ...collections, ...badCols };
    // need fresh require with bad cols — simulate via direct call check
    let failClosed = false;
    try {
        // claimSession calls countDocuments first
        const cols2 = { SessionAssignments: makeCollection() };
        cols2.SessionAssignments.countDocuments = async () => { throw new Error('mongo down'); };
        global.__cols = { ...collections, SessionAssignments: cols2.SessionAssignments };
        await assigner.claimSession('923003333333', 'worker-01');
    } catch (e) { failClosed = /fail-closed|mongo down/i.test(e.message); }
    global.__cols = collections;
    assert.ok(failClosed, 'claim must throw on DB error, never grant');
    ok('T7 fail-closed on DB error');

    // --- T8: release ---
    collections.SessionAssignments._docs.length = 0;
    await assigner.claimSession('923004444444', 'worker-01');
    await assigner.releaseSession('923004444444', 'worker-01');
    const after = await assigner.getWorkerSessions('worker-01');
    assert.strictEqual(after.length, 0);
    ok('T8 release returns session to pool');

    // --- T9: unknown worker slot rejected ---
    let slotErr = null;
    try { await registry.registerWorker('worker-99', {}); } catch (e) { slotErr = e; }
    assert.ok(slotErr && /unknown worker slot/.test(slotErr.message));
    ok('T9 unknown slot rejected');

    console.log(`\nfleet P2: ${t}/${t} PASS`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
