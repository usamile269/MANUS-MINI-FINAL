const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pairHtml = fs.readFileSync(path.join(__dirname, '..', 'pair.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

assert.match(pairHtml, /replace\(\/\\D\/g, ''\)\.replace\(\/\^00\//);
assert.match(pairHtml, /digitsOnly\.length < 8 \|\| digitsOnly\.length > 15/);
assert.doesNotMatch(pairHtml, /Invalid Pakistan number/);
assert.doesNotMatch(pairHtml, /Country code not recognized/);
assert.match(pairHtml, /const fullNumber = digitsOnly/);

assert.match(mainJs, /String\(number \?\? ''\)\.replace\(\/\\D\/g, ''\)\.replace\(\/\^00\//);
assert.match(mainJs, /sanitizedNumber\.length < 8 \|\| sanitizedNumber\.length > 15/);
assert.match(mainJs, /requestPairingCode\(sanitizedNumber\)/);

const normalize = value => String(value ?? '').replace(/\D/g, '').replace(/^00/, '');
assert.equal(normalize('+1 202-555-0100'), '12025550100');
assert.equal(normalize('0044 20 7946 0958'), '442079460958');
assert.equal(normalize('923044975027'), '923044975027');
assert.equal(normalize('  +81-90-1234-5678 '), '819012345678');

console.log('international pairing normalization regression: PASS');
