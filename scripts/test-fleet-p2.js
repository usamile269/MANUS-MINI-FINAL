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
            if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) d[k] = (d[k] || 0) + v;
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

async function main() {
    let t = 0;
    const ok = (name) => { t++; console.log(`${t}. ${name}: PASS`); };
    const reset = async () => {
        collections.SessionAssignments._docs.length = 0;
        collections.Workers._docs.length = 0;
        collections.WorkerEvents._docs.length = 0;
    };

    // --- T1: register + heartbeat ---
    await reset();
    await registry.registerWorker('worker-01', { capacityMax: 50 });
    const hb = await registry.heartbeatWorker('worker-01', { activeSessions: 3, rssMB: 400, uptimeSec: 100 });
    assert.strictEqual(hb.activeSessions, 3);
    ok('T1 register + heartbeat');

    // --- T2: stale heartbeat -> offline ---
    collections.Workers._docs.find(d => d.workerId === 'worker-01').lastHeartbeat = new Date(Date.now() - 60000);
    assert.strictEqual(await registry.markStaleWorkers(30000), 1);
    const fleet = await registry.getFleetStatus();
    assert.strictEqual(fleet.slots.find(s => s.workerId === 'worker-01').status, 'offline');
    ok('T2 stale heartbeat -> offline');

    // --- T3: unprovisioned slots honest ---
    assert.strictEqual(fleet.slots.find(s => s.workerId === 'worker-05').status, 'not_provisioned');
    assert.strictEqual(fleet.totals.notProvisioned, 9);
    ok('T3 unprovisioned slots honest');

    // --- T4: claim race x50 ---
    await reset();
    await registry.registerWorker('worker-01', {});
    await registry.registerWorker('worker-02', {});
    for (let i = 0; i < 50; i++) {
        collections.SessionAssignments._docs.length = 0;
        // reset reservations for clean race
        for (const w of collections.Workers._docs) w.reservedCount = 0;
        const results = await Promise.allSettled([
            assigner.claimSession('923001234567', 'worker-01'),
            assigner.claimSession('923001234567', 'worker-02'),
        ]);
        const won = results.filter(r => r.status === 'fulfilled').length;
        assert.strictEqual(won, 1, `race ${i}: won=${won}`);
        // release for next iteration
        await assigner.releaseSession('923001234567').catch(() => {});
        for (const w of collections.Workers._docs) w.reservedCount = 0;
    }
    ok('T4 claim race: exactly 1 winner x50');

    // --- T5: 50-cap ---
    await reset();
    await registry.registerWorker('worker-01', { capacityMax: 50 });
    for (let i = 0; i < 50; i++) await assigner.claimSession(`92300000${String(i).padStart(3, '0')}`, 'worker-01');
    let capErr = null;
    try { await assigner.claimSession('923009999999', 'worker-01'); } catch (e) { capErr = e; }
    assert.ok(capErr && capErr.code === 'CAPACITY_EXCEEDED');
    ok('T5 50-cap enforced');

    // --- T6: failover ---
    await reset();
    await registry.registerWorker('worker-01', {});
    await registry.registerWorker('worker-02', {});
    await assigner.claimSession('923001111111', 'worker-01');
    await assigner.claimSession('923002222222', 'worker-02');
    await registry.heartbeatWorker('worker-02', { activeSessions: 1 });
    collections.Workers._docs.find(d => d.workerId === 'worker-01').lastHeartbeat = new Date(Date.now() - 60000);
    await registry.markStaleWorkers(30000);
    collections.SessionAssignments._docs.find(d => d.number === '923001111111').leaseExpiresAt = new Date(Date.now() - 1000);
    const isOnline = async (id) => {
        const d = await collections.Workers.findOne({ workerId: id });
        return d && d.status === 'online' && (Date.now() - new Date(d.lastHeartbeat).getTime()) < 30000;
    };
    assert.strictEqual(await assigner.reassignOrphanedSessions(isOnline), 1);
    const rem = await assigner.getWorkerSessions('worker-02');
    assert.strictEqual(rem.length, 1);
    ok('T6 failover: orphan released, live untouched');

    // --- T7: fail-closed ---
    const origCols = global.__cols;
    global.__cols = { ...collections, SessionAssignments: { countDocuments: async () => { throw new Error('mongo down'); } } };
    let fc = false;
    try { await assigner.claimSession('923003333333', 'worker-01'); } catch (e) { fc = /fail-closed|mongo down/i.test(e.message); }
    global.__cols = origCols;
    assert.ok(fc);
    ok('T7 fail-closed on DB error');

    // --- T8: release ---
    await reset();
    await registry.registerWorker('worker-01', {});
    await assigner.claimSession('923004444444', 'worker-01');
    await assigner.releaseSession('923004444444', 'worker-01');
    assert.strictEqual((await assigner.getWorkerSessions('worker-01')).length, 0);
    ok('T8 release');

    // --- T9: unknown slot ---
    let se = null;
    try { await registry.registerWorker('worker-99', {}); } catch (e) { se = e; }
    assert.ok(se && /unknown worker slot/.test(se.message));
    ok('T9 unknown slot rejected');

    // --- T10: 60 simultaneous claims, never exceed 50 ---
    await reset();
    await registry.registerWorker('worker-03', { capacityMax: 50 });
    const results = await Promise.all(
        Array.from({ length: 60 }, (_, i) =>
            assigner.claimSession(`92310000${String(i).padStart(3, '0')}`, 'worker-03').then(() => 'won', e => e.code || 'err'))
    );
    const won = results.filter(r => r === 'won').length;
    assert.ok(won <= 50, `won=${won}`);
    assert.strictEqual(won + results.filter(r => r === 'CAPACITY_EXCEEDED').length, 60);
    const wdoc = await collections.Workers.findOne({ workerId: 'worker-03' });
    assert.ok((wdoc.reservedCount || 0) <= 50);
    console.log(`   (60 claims -> ${won} won, reserved=${wdoc.reservedCount})`);
    ok('T10 simultaneous capacity never exceeds 50');

    // --- T11: invalid telemetry ---
    await reset();
    await registry.registerWorker('worker-01', {});
    const bad = [
        () => registry.registerWorker('worker-99', {}),
        () => registry.registerWorker('worker-01', { capacityMax: 51 }),
        () => registry.registerWorker('worker-01', { capacityMax: 0 }),
        () => registry.heartbeatWorker('worker-01', { rssMB: 'huge' }),
        () => registry.heartbeatWorker('worker-01', { activeSessions: -5 }),
        () => assigner.claimSession('abc', 'worker-01'),
    ];
    for (const fn of bad) { let threw = false; try { await fn(); } catch (e) { threw = true; } assert.ok(threw); }
    await registry.registerWorker('worker-04', { capacityMax: 50 });
    await registry.registerWorker('worker-05', { capacityMax: 1 });
    ok('T11 invalid telemetry rejected');

    // --- T12: XSS ---
    const html = require('fs').readFileSync('/tmp/fleet.html', 'utf8');
    const escMatch = html.match(/function esc\(s\) \{[\s\S]*?\n\}/);
    assert.ok(escMatch, 'esc() exists');
    eval(escMatch[0]);
    assert.strictEqual(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.ok(/\$\{esc\(v\.event\)\}/.test(html) && /\$\{esc\(w\.error\)\}/.test(html));
    assert.ok(!/fleet\/status\?apikey=/.test(html), 'no query-string keys');
    ok('T12 XSS-safe rendering + header auth');

    // --- T13: lease-protected recovery ---
    await reset();
    await registry.registerWorker('worker-06', {});
    await assigner.claimSession('923006666666', 'worker-06');
    collections.Workers._docs.find(d => d.workerId === 'worker-06').lastHeartbeat = new Date(Date.now() - 60000);
    await registry.markStaleWorkers(30000);
    const isOnline2 = async (id) => {
        const d = await collections.Workers.findOne({ workerId: id });
        return d && d.status === 'online' && (Date.now() - new Date(d.lastHeartbeat).getTime()) < 30000;
    };
    assert.strictEqual(await assigner.reassignOrphanedSessions(isOnline2), 0, 'no release while lease valid');
    collections.SessionAssignments._docs.find(d => d.number === '923006666666').leaseExpiresAt = new Date(Date.now() - 1000);
    assert.strictEqual(await assigner.reassignOrphanedSessions(isOnline2), 1, 'release after lease expiry');
    ok('T13 lease-protected recovery');

    console.log(`\nfleet P2: ${t}/13 PASS (mock — see TEST-MODES below)`);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
