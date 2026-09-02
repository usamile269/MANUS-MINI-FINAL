const assert = require('assert');
const fs = require('fs');

const owner = fs.readFileSync('plugins/owner.js', 'utf8');
const main = fs.readFileSync('main.js', 'utf8');

assert.match(owner, /pattern:\s*'addjid'[\s\S]*?if \(!isOwner\) return reply\(ownerOnlyDenied\(\)\)/);
assert.match(owner, /pattern:\s*'removejid'[\s\S]*?if \(!isOwner\) return reply\(ownerOnlyDenied\(\)\)/);
assert.match(owner, /pattern:\s*'activelist'[\s\S]*?if \(!isOwner\) return reply\(ownerOnlyDenied\(\)\)/);
assert.match(owner, /pattern:\s*'addjid'[\s\S]*?await conn\.newsletterFollow\(jid\)[\s\S]*?config\.AUTO_FOLLOW_JIDS/);
assert.match(owner, /pattern:\s*'addjid'[\s\S]*?Follow failed; bot lists unchanged/);
assert.match(owner, /pattern:\s*'removejid'[\s\S]*?await conn\.newsletterUnfollow\(jid\)[\s\S]*?config\.AUTO_FOLLOW_JIDS/);
assert.match(owner, /pattern:\s*'removejid'[\s\S]*?Live unfollow failed; bot lists unchanged/);
assert.match(owner, /pattern:\s*'activelist'[\s\S]*?getAllNumbersFromMongoDB/);
assert.match(owner, /pattern:\s*'activelist'[\s\S]*?ACTIVE[\s\S]*?OFFLINE/);
assert.match(main, /global\.__ahmadSessionRegistry\s*=\s*\{\s*activeSockets,\s*connectionOpenState,\s*socketCreationTime\s*\}/);

console.log('owner session controls: PASS');
