const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ownerSource = fs.readFileSync(path.join(root, 'plugins', 'owner.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const { whitelist, normalizeAllowedJid, isWhitelisted } = require(path.join(root, 'lib', 'owner-lists'));

whitelist.clear();
assert.strictEqual(normalizeAllowedJid('923017717664'), '923017717664@s.whatsapp.net');
assert.strictEqual(normalizeAllowedJid('923017717664@s.whatsapp.net'), '923017717664@s.whatsapp.net');
assert.strictEqual(normalizeAllowedJid('120363000000000000@g.us'), '120363000000000000@g.us');
whitelist.add(normalizeAllowedJid('923017717664'));
assert.strictEqual(isWhitelisted('923017717664@s.whatsapp.net'), true);
assert.strictEqual(isWhitelisted('923000000000@s.whatsapp.net'), false);
whitelist.clear();
whitelist.add('120363000000000000@g.us');
assert.strictEqual(isWhitelisted('120363000000000000@g.us'), true);
assert.strictEqual(isWhitelisted('923017717664@s.whatsapp.net'), false);

assert.match(ownerSource, /pattern:\s*'addjid'[\s\S]*?if \(!isOwner\) return reply\(ownerOnlyDenied\(\)\)/);
assert.match(ownerSource, /pattern:\s*'addjid'[\s\S]*?normalizeAllowedJid\(args\[0\]\)/);
assert.match(ownerSource, /pattern:\s*'removejid'[\s\S]*?normalizeAllowedJid\(args\[0\]\)/);
assert.match(mainSource, /const \{ isWhitelisted \} = require\('\.\/lib\/owner-lists'\)/);
assert.match(mainSource, /const isAllowedJid = isWhitelisted\(sender, from\)/);
assert.match(mainSource, /!isOwner && !isMe && !isAllowedJid/);

console.log('PASS: .addjid normalizes and affects runtime allow-list checks; owner guard and other command boundaries remain intact.');
