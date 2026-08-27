const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pairHtml = fs.readFileSync(path.join(__dirname, '..', 'pair.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

assert.match(pairHtml, /replace\(\/\\D\/g, ''\)\.replace\(\/\^00\//);
assert.match(pairHtml, /digitsOnly\.length < 8 \|\| digitsOnly\.length > 15/);
assert.doesNotMatch(pairHtml, /Invalid Pakistan number/);
assert.doesNotMatch(pairHtml, /Country code not recognized/);
assert.match(pairHtml, /_pairing_request=\$\{Date\.now\(\)\}/);
assert.match(pairHtml, /cache: 'no-store'/);
assert.match(pairHtml, /const fullNumber = digitsOnly/);
assert.match(pairHtml, /function openAdmin\(\) \{[\s\S]*adminOverlay[\s\S]*showLockView\(\)/);
assert.match(pairHtml, /function openAdmin\(\) \{[\s\S]*overlay\.classList\.add\(['"]show['"]\)[\s\S]*showLockView\(\)/);
assert.match(pairHtml, /if \(data\.valid\) \{[\s\S]*window\.location\.assign\(['"]\/admin\.html['"]\)/);
assert.match(adminHtml, /id="adminOverlay"/);
assert.match(adminHtml, /body\.admin-route.*overflow-y:auto/);
assert.match(adminHtml, /admin-control-center-main.*overflow:visible !important/);
assert.match(adminHtml, /scroll-behavior:smooth/);
assert.match(pairHtml, /scroll-behavior:smooth/);
assert.match(adminHtml, /window\.closeAdmin = \(\) => window\.location\.assign\(['\"]\/['\"]\)/);

assert.match(mainJs, /String\(number \?\? ''\)\.replace\(\/\\D\/g, ''\)\.replace\(\/\^00\//);
assert.match(mainJs, /sanitizedNumber\.length < 8 \|\| sanitizedNumber\.length > 15/);
assert.match(mainJs, /requestPairingCode\(sanitizedNumber\)/);
assert.match(mainJs, /const pairingReadyPromise = !state\.creds\.registered/);
assert.match(mainJs, /await pairingReadyPromise/);
assert.match(mainJs, /if \(update\.qr\) return finish\(\)/);
assert.doesNotMatch(mainJs, /socket\.waitForSocketOpen\(\)/);
assert.match(mainJs, /PAIRING_SOCKET_READY_TIMEOUT_MS = 15000/);
assert.doesNotMatch(mainJs, /await delay\(1500\)/);
assert.match(mainJs, /Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'/);
assert.match(mainJs, /Surrogate-Control': 'no-store'/);

const normalize = value => String(value ?? '').replace(/\D/g, '').replace(/^00/, '');
assert.equal(normalize('+1 202-555-0100'), '12025550100');
assert.equal(normalize('0044 20 7946 0958'), '442079460958');
assert.equal(normalize('923044975027'), '923044975027');
assert.equal(normalize('  +81-90-1234-5678 '), '819012345678');

console.log('international pairing normalization and socket-readiness regression: PASS');
