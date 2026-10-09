// ============================================================================
// scripts/test-fleet-p2-realdb.js — REAL DATABASE tests (NOT mocks)
//
// These tests run against a REAL MongoDB. They verify what mocks cannot:
//   - the unique index on SessionAssignments.number actually prevents
//     duplicate claims under real concurrency
//   - atomic $inc capacity reservation works with the real driver
//
// SAFETY (defense in depth):
//   1. Requires TEST_MONGODB_URI env var. If unset, the suite SKIPS (exit 0).
//   2. URI must contain an explicit database name that looks like a test DB
//      (must match /test|staging|scratch|fleet_test|dev/i). Refused otherwise —
//      this prevents accidentally targeting a default production database.
//   3. URI matching /MANUS|PROD/i is refused (legacy heuristic).
//   4. PRE-FLIGHT: after connecting, the script lists collections and REFUSES
//      if any production collection exists (Session, SessionKeys,
//      ActiveNumber, ConnectionLock). This is the primary guard — it works
//      even if the URI checks are bypassed.
//   5. Tests use ONLY run-scoped collections (SessionAssignments_run_<ts>,
//      Workers_run_<ts>). Existing collections are never read, written, or
//      dropped.
//   6. Cleanup (drop of the two run-scoped collections) runs in a finally
//      block — even if a test fails.
//   7. The URI is never printed, logged, or included in output.
//
// Run:
//   TEST_MONGODB_URI='mongodb+srv://user:pass@host/fleet_test_abc' \
//     node scripts/test-fleet-p2-realdb.js
// ============================================================================
const assert = require('assert');

// Production collections — if ANY exist in the target DB, refuse immediately.
const PROD_COLLECTIONS = ['Session', 'SessionKeys', 'ActiveNumber', 'ConnectionLock'];

const URI = (process.env.TEST_MONGODB_URI || '').trim();
if (!URI) {
    console.log('SKIP: TEST_MONGODB_URI not set — real-DB tests skipped (mock suite covers logic).');
    console.log('To run: TEST_MONGODB_URI=\'mongodb+srv://user:pass@host/fleet_test_<random>\' node scripts/test-fleet-p2-realdb.js');
    process.exit(0);
}

// --- Guard 1: legacy production-URI heuristic ---
if (/MANUS|PROD/i.test(URI)) {
    console.error('REFUSED: URI looks like production. Use a scratch database.');
    process.exit(1);
}

// --- Guard 2: require an explicit test-like database name in the URI ---
// mongodb+srv://user:pass@host/<dbname>?...  — <dbname> is required.
const dbNameMatch = URI.match(/mongodb(\+srv)?:\/\/[^/]+\/([^?]+)/);
const dbName = dbNameMatch ? decodeURIComponent(dbNameMatch[2]) : '';
if (!dbName || !/test|staging|scratch|fleet_test|dev/i.test(dbName)) {
    console.error(`REFUSED: URI must contain an explicit test database name (e.g. /fleet_test_<random>). Got: ${dbName ? `"${dbName}"` : '(none)'}.`);
    console.error('This prevents accidentally targeting a default production database.');
    process.exit(1);
}

const RUN = 'run_' + Date.now().toString(36);
const C_ASSIGN = `SessionAssignments_${RUN}`;
const C_WORKERS = `Workers_${RUN}`;

async function main() {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(URI, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    try {
        const db = client.db();

        // --- Guard 3 (primary): pre-flight production check ---
        // If ANY production collection exists in this database, abort before
        // creating indexes, writing, or cleaning anything.
        const existing = (await db.listCollections().toArray()).map(c => c.name);
        const prodFound = PROD_COLLECTIONS.filter(c => existing.includes(c));
        if (prodFound.length > 0) {
            console.error(`REFUSED: target database contains production collections: ${prodFound.join(', ')}.`);
            console.error('Aborting before any write. Use an isolated scratch database.');
            process.exit(1);
        }
        console.log(`Connected (db has ${existing.length} collections, none production; test collections: ${C_ASSIGN}, ${C_WORKERS})`);

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

        console.log('\nreal-DB fleet tests: 2/2 PASS');
    } finally {
        // Cleanup: drop ONLY the two run-scoped test collections.
        // Runs even if a test assertion fails.
        const db = client.db();
        await db.collection(C_ASSIGN).drop().catch(() => {});
        await db.collection(C_WORKERS).drop().catch(() => {});
        await client.close();
        console.log('(test collections cleaned up)');
    }
}

main().catch(e => { console.error('REAL-DB FAIL:', e.message); process.exit(1); });
