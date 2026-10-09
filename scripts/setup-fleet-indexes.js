// ============================================================================
// scripts/setup-fleet-indexes.js — worker fleet index setup
//
// Creates the MongoDB indexes REQUIRED for correct fleet operation:
//
//   SessionAssignments: { number: 1 } UNIQUE  <- atomic claim correctness;
//       without this, two workers racing an upsert can BOTH win (proven by
//       test-fleet-p2.js T4). This index is what makes the loser fail with
//       E11000 -> ALREADY_CLAIMED.
//   SessionAssignments: { workerId: 1, state: 1 }  <- worker session lookups
//   Workers:            { workerId: 1 } UNIQUE     <- one doc per slot
//   WorkerEvents:       { ts: -1 }                 <- recent-events queries
//
// SAFE: createIndex is idempotent and never modifies data. It only adds
// index metadata.
//
// Usage:
//   node scripts/setup-fleet-indexes.js
//
// Uses MONGODB_URI from config (env var first). Run against STAGING first.
// NEVER run against the production database without explicit approval.
// ============================================================================

const config = require('../config');

const INDEXES = [
    ['SessionAssignments', { number: 1 }, { unique: true, name: 'uniq_number' }],
    ['SessionAssignments', { workerId: 1, state: 1 }, { name: 'worker_state' }],
    ['Workers', { workerId: 1 }, { unique: true, name: 'uniq_workerId' }],
    ['WorkerEvents', { ts: -1 }, { name: 'ts_desc' }],
];

async function main() {
    const uri = (config.MONGODB_URI || '').trim();
    if (!uri) {
        console.error('MONGODB_URI is not set — nothing to do.');
        process.exit(1);
    }
    // Never print the URI (it contains credentials).
    console.log('Connecting to MongoDB (URI hidden)...');
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const db = client.db();
    console.log('Connected. Creating indexes...');
    for (const [coll, keys, opts] of INDEXES) {
        const name = await db.collection(coll).createIndex(keys, opts);
        console.log(`  ${coll}: ${name} OK`);
    }
    await client.close();
    console.log('All fleet indexes ready.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
