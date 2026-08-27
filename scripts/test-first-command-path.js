const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

assert.match(source, /function hasBeenProcessed\(number, id\)/);
assert.match(source, /function markProcessed\(number, id\)/);
assert.match(source, /const batchSeenIds = new Set\(\);/);
assert.match(source, /if \(id && \(batchSeenIds\.has\(id\) \|\| hasBeenProcessed\(sanitizedNumber, id\)\)\) return false;/);
assert.match(source, /if \(id && mm\.message\) batchSeenIds\.add\(id\);/);
assert.match(source, /hasBeenProcessed\(sanitizedNumber, id\)\)\) return false;/);
assert.match(source, /if \(mm\.message\) markProcessed\(sanitizedNumber, mm\.key && mm\.key\.id\);/);
assert.doesNotMatch(source, /return !wasAlreadyProcessed\(sanitizedNumber, mm\.key && mm\.key\.id\);/);
assert.match(source, /an empty encrypted delivery first and a usable retry later/);
assert.match(source, /void Promise\.all\(\[/);

console.log('first-command retry regression: PASS');
