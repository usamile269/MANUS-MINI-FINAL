const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

assert.match(source, /const presenceIntervalId = setInterval\(async \(\) =>/);
assert.match(source, /\}, 2 \* 60 \* 1000\);/);
assert.match(source, /await conn\.sendPresenceUpdate\('available'\);/);
assert.match(source, /lastActivityAt\.set\(sanitizedNumber, Date\.now\(\)\);/);
assert.match(source, /function registerStaleSocketWatchdog\(socket, number, sanitizedNumber\)/);
assert.match(source, /const CHECK_EVERY_MS = 5 \* 60 \* 1000;/);
assert.match(source, /const GRACE_PERIOD_MS = 15 \* 60 \* 1000/);
assert.match(source, /const STALE_THRESHOLD_MS = 45 \* 60 \* 1000/);
assert.match(source, /scheduleSelfHealingReconnect\(number, statusCode, errorMessage\);/);
assert.match(source, /if \(connection === 'close'\)/);
assert.doesNotMatch(source, /setInterval\([^\n]+process\.exit/);

console.log('always-on liveness path regression: PASS');
