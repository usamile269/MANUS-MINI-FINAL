const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'all-settings.js'), 'utf8');
const start = source.indexOf('pattern: "autoreact"');
const end = source.indexOf('// ============================================================', start + 1);
assert.ok(start >= 0, 'global autoreact command must exist');
assert.ok(end > start, 'global autoreact command boundary must exist');
const autoreact = source.slice(start, end);

assert.match(autoreact, /isOwner, isMe/);
assert.match(autoreact, /if \(!isOwner && !isMe\) return reply\(ownerOnlyDenied\(\)\);/);
assert.match(autoreact, /updateConfig\('AUTO_REACT', 'true', botNumber, config, reply\)/);
assert.match(autoreact, /updateConfig\('AUTO_REACT', 'false', botNumber, config, reply\)/);
assert.doesNotMatch(autoreact, /setUserBotSettings|updateAllUserModesInMongoDB/);

console.log('autoreact per-bot owner boundary regression: PASS');
