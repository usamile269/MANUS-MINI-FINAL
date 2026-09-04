const assert = require('assert');
const fs = require('fs');

const main = fs.readFileSync('main.js', 'utf8');
const settings = fs.readFileSync('plugins/all-settings.js', 'utf8');
const config = fs.readFileSync('config.js', 'utf8');

// Both runtime gates must use the per-bot record and must not inherit a
// shared global WORK_TYPE when Mongo is unavailable or the record is empty.
assert.match(main, /privateGroupBlocked[\s\S]*?\(userConfig\?\.WORK_TYPE \|\| 'private'\) === 'private'/);
assert.match(main, /const effectiveWorkType = userConfig\?\.WORK_TYPE \|\| 'private';/);
assert.doesNotMatch(main, /userConfig\?\.WORK_TYPE \|\| config\.WORK_TYPE \|\| 'private'/);
assert.match(settings, /const effectiveMode = userConfig\.WORK_TYPE \|\| 'private';/);
assert.match(config, /WORK_TYPE:\s*process\.env\.WORK_TYPE \|\| ["']private["']/);

// Explicit mode commands must remain owner/self-gated and retain all modes.
assert.match(settings, /const validModes = \['public', 'private', 'groups', 'inbox'\]/);
assert.match(settings, /if \(!isOwner && !isMe\) return reply/);
assert.match(settings, /await updateConfig\('WORK_TYPE', mode, modeKey, config, reply\)/);

console.log('private mode fail-closed regression: PASS');
