const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
assert.ok(source.includes('|| (isCmd && await isSudo(botNumber, senderNumber)))();'), 'sudo lookup must be limited to command messages');
assert.ok(source.includes("const needsGroupContext = (isCmd && command !== 'ping') || mightBeLink || groupExtraActive;"), 'ping must bypass group context metadata');
assert.ok(source.includes('if (isGroup && needsGroupContext) {'), 'group context must use the optimized predicate');
console.log('group speed path regression: PASS');

