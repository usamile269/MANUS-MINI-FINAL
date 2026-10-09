// ============================================================================
// scripts/test-fleet-p2-realdb.js — REAL DATABASE tests (NOT mocks)
//
// These tests run against a REAL MongoDB. They verify what mocks cannot:
//   - the unique index on SessionAssignments.number actually prevents
//     duplicate claims under real concurrency
//   - atomic $inc capacity reservation works with the real driver
//
// SAFETY:
//   - Requires TEST_MONGODB_URI env var. If unset, the suite SKIPS (exit 0).
//   - NEVER point TEST_MONGODB_URI at production. Use a scratch database:
//       mongodb+srv://.../fleet_test_<random>
//   - Uses ONLY the fleet collections (Workers_TestRun, SessionAssignments_TestRun).
//     Existing Session/SessionKeys/ActiveNumber collections are never touched.
//
// Run:  TEST_MONGODB_URI='mongodb+srv://...' node scripts/test-fleet-p2-realdb.js
// ============================================================================
const assert = require('assert');

const URI = (process.env.TEST_MONGODB_URI || '').trim();
if (!URI) {
    console.log('SKIP: TEST_MONGODB_URI not set — real-DB tests skipped (mock suite covers logic).');
    console.log('To run: TEST_MONGODB_URI=<staging-uri> node scripts/test-fleet-p2-realdb.js');
    process.exit(0);
}
if (/MANUS|PROD/i.test(URI)) {
    console.error('REFUSED: URI looks like production. Use a scratch database.');
    process.exit(1);
}

const RUN = 'run_' + Date.now().toString(36);
const C_ASSIGN = `SessionAssignments_${RUN}`;
const C_WORKERS = `Workers_${RUN}`;

async function main() {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(URI, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const db = client.db();
    console.log(`Connected (test collections: ${C_ASSIGN}, ${C_WORKERS})`);

    // R1: unique index prevents duplicate claims under real concurrency
    await db.collection(C_ASSIGN).createIndex({ number: 1 }, { unique: true });
    const tryClaim = async (workerId) => {
        try {
            await db.collection(C_ASSIGN).findOneAndUpdate(
                { number: '923009000001', $or: [{ state: 'unassigned' }, { state: 'failed' }] },
                { $set: { number: '923009000001', workerId, state: 'assigned', claimedAt: new Date() } },
                { upsert: true, returnDocument: 'after' }
            );
            return 'won';
        } catch (e) {
            return e.code === 11000 ? 'duplicate-key' : 'error:' + e.message;
        }
    };
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => tryClaim(`worker-${i}`)));
    const won = results.filter(r => r === 'won').length;
    const dups = results.filter(r => r === 'duplicate-key').length;
    console.log(`R1: 20 concurrent claims -> ${won} won, ${dups} duplicate-key`);
    assert.strictEqual(won, 1, 'exactly 1 winner with real unique index');
    assert.strictEqual(dups, 19);
    console.log('R1 real-DB unique index under concurrency: PASS');

    // R2: atomic $inc capacity reservation never exceeds 50
    await db.collection(C_WORKERS).insertOne({ workerId: 'w-cap', reservedCount: 0 });
    const tryReserve = async () => {
        const doc = await db.collection(C_WORKERS).findOneAndUpdate(
            { workerId: 'w-cap', reservedCount: { $lt: 50 } },
            { $inc: { reservedCount: 1 } },
            { returnDocument: 'after' }
        );
        return doc ? 'reserved' : 'denied';
    };
    const r2 = await Promise.all(Array.from({ length: 80 }, tryReserve));
    const reserved = r2.filter(r => r === 'reserved').length;
    const final = await db.collection(C_WORKERS).findOne({ workerId: 'w-cap' });
    console.log(`R2: 80 concurrent reservations -> ${reserved} granted, final count=${final.reservedCount}`);
    assert.strictEqual(reserved, 50);
    assert.strictEqual(final.reservedCount, 50);
    console.log('R2 real-DB atomic capacity (never exceeds 50): PASS');

    // cleanup test collections
    await db.collection(C_ASSIGN).drop().catch(() => {});
    await db.collection(C_WORKERS).drop().catch(() => {});
    await client.close();
    console.log('\nreal-DB fleet tests: 2/2 PASS (collections cleaned up)');
}

main().catch(e => { console.error('REAL-DB FAIL:', e.message); process.exit(1); });
