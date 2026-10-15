// ============================================================================
// lib/persist.js — zero-config persistent storage picker
// ----------------------------------------------------------------------------
// Ahmad (2026-10-15): "variable ki need nahi ho" — sessions/settings must
// survive Railway redeploys WITHOUT requiring MONGODB_URI.
//
// How it works:
//   1. If MONGODB_URI is set, lib/mongo.js uses MongoDB (unchanged, best).
//   2. Otherwise this picker looks for a persistent volume at /data
//      (the Railway convention — just attach a volume with mount path /data,
//      no variable needed). If /data exists and is writable, everything
//      (jsondb collections + WhatsApp session folders) lives under
//      /data/ahmad-db and survives redeploys.
//   3. If no volume is attached, falls back to the old local ./database and
//      ./session folders (wiped on redeploy — same as before).
// ============================================================================

const fs = require('fs');
const path = require('path');

let _resolved = null;

function resolve() {
    if (_resolved) return _resolved;

    // Explicit override still wins (existing JSONDB_DIR behavior).
    if (process.env.JSONDB_DIR) {
        _resolved = {
            dbDir: process.env.JSONDB_DIR,
            sessionDir: path.join(process.env.JSONDB_DIR, 'session'),
            persistent: true,
            how: 'JSONDB_DIR',
        };
        return _resolved;
    }

    // Auto-detect a persistent volume — zero configuration needed.
    try {
        fs.accessSync('/data', fs.constants.W_OK);
        const dbDir = '/data/ahmad-db';
        const sessionDir = '/data/ahmad-db/session';
        fs.mkdirSync(dbDir, { recursive: true });
        fs.mkdirSync(sessionDir, { recursive: true });
        console.log('💾 persistent volume detected at /data — sessions & settings will survive redeploys (no MONGODB_URI needed).');
        _resolved = { dbDir, sessionDir, persistent: true, how: 'volume' };
        return _resolved;
    } catch (e) { /* no volume — fall through */ }

    // Last resort: local folders (ephemeral on Railway).
    _resolved = {
        dbDir: path.join(__dirname, '..', 'database'),
        sessionDir: path.join(__dirname, '..', 'session'),
        persistent: false,
        how: 'local',
    };
    console.log('ℹ️ no persistent volume at /data and MONGODB_URI not set — using local storage (wiped on redeploy). Attach a Railway volume at /data to fix this permanently.');
    return _resolved;
}

module.exports = {
    getJsonDbDir: () => resolve().dbDir,
    getSessionDir: () => resolve().sessionDir,
    isPersistent: () => resolve().persistent,
};
