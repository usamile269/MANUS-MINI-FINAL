const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const ownerIndex = Math.max(
    source.indexOf('const isOwner = await ownerCheckPromise;'),
    source.indexOf('isOwner = await ownerCheckPromise;')
);
const meIndex = source.indexOf('const isMe = botNumber === senderNumber;');
const gateIndex = Math.max(
    source.indexOf('const privateGroupBlocked = isGroup'),
    source.indexOf('privateGroupBlocked = isGroup')
);
assert.ok(ownerIndex >= 0, 'owner initialization must exist');
assert.ok(meIndex >= 0, 'self identity initialization must exist');
assert.ok(gateIndex >= 0, 'private-group gate must exist');
assert.ok(ownerIndex < gateIndex, 'private-group gate must follow isOwner initialization');
assert.ok(meIndex < gateIndex, 'private-group gate must follow isMe initialization');
assert.equal(source.indexOf('&& !isOwner && !isMe', 0), source.indexOf('&& !isOwner && !isMe', gateIndex), 'no earlier private gate may reference uninitialized identities');
console.log('owner scope initialization-order regression: PASS');

