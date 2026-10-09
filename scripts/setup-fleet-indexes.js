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
// Requires MONGODB_URI env var (explicit — no config.js fallback).
// Run against STAGING first. NEVER run against production without explicit approval.
// ============================================================================

// SECURITY: This script intentionally does NOT use config.js.
// config.js contains a hardcoded production URI fallback. Requiring an explicit
// MONGODB_URI env var prevents accidentally targeting production.

const INDEXES = [
    ['SessionAssignments', { number: 1 }, { unique: true, name: 'uniq_number' }],
    ['SessionAssignments', { workerId: 1, state: 1 }, { name: 'worker_state' }],
    ['Workers', { workerId: 1 }, { unique: true, name: 'uniq_workerId' }],
    ['WorkerEvents', { ts: -1 }, { name: 'ts_desc' }],
];

const PROD_COLLECTIONS = ['Session', 'SessionKeys', 'ActiveNumber', 'ConnectionLock'];

async function main() {
    const uri = (process.env.MONGODB_URI || '').trim();
    if (!uri) {
        console.error('REFUSED: MONGODB_URI env var is required.');
        console.error('Not falling back to config.js (it contains a hardcoded production URI).');
        console.error('Set MONGODB_URI explicitly to the target database.');
        process.exit(1);
    }
    // Never print the URI (it contains credentials).
    console.log('Connecting to MongoDB (URI hidden)...');
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const db = client.db();
    // Preflight: warn if production collections exist (informational only —
    // indexes are on new collections, but the operator should confirm intent).
    const existing = (await db.listCollections().toArray()).map(c => c.name);
    const prodFound = PROD_COLLECTIONS.filter(c => existing.includes(c));
    if (prodFound.length > 0) {
        console.log(`NOTE: target DB contains production collections: ${prodFound.join(', ')}.`);
        console.log('Indexes will only be created on new fleet collections (no existing data touched).');
    }
    console.log('Connected. Creating indexes...');
    for (const [coll, keys, opts] of INDEXES) {
        const name = await db.collection(coll).createIndex(keys, opts);
        console.log(`  ${coll}: ${name} OK`);
    }
    await client.close();
    console.log('All fleet indexes ready.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
