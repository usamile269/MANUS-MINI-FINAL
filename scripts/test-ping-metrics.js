const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'ping.js'), 'utf8');
assert.match(source, /label: 'SERVER', value: `\$\{processMs\}ms`/);
assert.match(source, /label: 'WA PROBE', value: probeLabel/);
assert.match(source, /const probeLabel = 'BACKGROUND'/);
assert.match(source, /sendPresenceUpdate\('available', from\)\.catch\(\(\) => \{\}\);/);
assert.doesNotMatch(source, /await Promise\.race\(\[/);
assert.match(source, /forwardingScore: 999/);
assert.match(source, /isForwarded: true/);
assert.match(source, /forwardedNewsletterMessageInfo:/);
assert.match(source, /contextInfo: channelContext/);
assert.doesNotMatch(source, /label: 'SPEED',\s+value: `\$\{networkMs\}ms`/);
console.log('truthful ping metrics regression: PASS');

