const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ownerSource = fs.readFileSync(path.join(root, 'plugins', 'owner.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'config.js'), 'utf8');

assert.match(ownerSource, /pattern:\s*'addjid'[\s\S]*?if \(!isOwner\) return reply\(ownerOnlyDenied\(\)\)/);
assert.match(ownerSource, /pattern:\s*'addjid'[\s\S]*?@newsletter/);
assert.match(ownerSource, /pattern:\s*'addjid'[\s\S]*?AUTO_FOLLOW_JIDS/);
assert.match(ownerSource, /pattern:\s*'addjid'[\s\S]*?CHANNEL_POST_JIDS/);
assert.match(ownerSource, /pattern:\s*'addjid'[\s\S]*?newsletterFollow\(jid\)/);
assert.match(ownerSource, /pattern:\s*'removejid'[\s\S]*?AUTO_FOLLOW_JIDS/);
assert.match(ownerSource, /pattern:\s*'removejid'[\s\S]*?CHANNEL_POST_JIDS/);
assert.match(ownerSource, /pattern:\s*'removejid'[\s\S]*?if \(!isOwner\) return reply\(ownerOnlyDenied\(\)\)/);
assert.match(ownerSource, /pattern:\s*'listjid'[\s\S]*?if \(!isOwner\) return reply\(ownerOnlyDenied\(\)\)/);
assert.match(ownerSource, /pattern:\s*'listjid'[\s\S]*?AUTO_FOLLOW_JIDS/);
assert.match(ownerSource, /pattern:\s*'listjid'[\s\S]*?CHANNEL_POST_JIDS/);
assert.match(ownerSource, /pattern:\s*'listjid'[\s\S]*?removejid <channelJid>/);
assert.match(mainSource, /const newsletterJids = \(Array\.isArray\(config\.AUTO_FOLLOW_JIDS\)/);
assert.match(mainSource, /if \(!newsletterJids\.includes\(jid\)\) continue;/);
assert.match(mainSource, /await conn\.newsletterReactMessage\(jid, serverId\.toString\(\), emoji\)/);
assert.match(configSource, /AUTO_FOLLOW_JIDS:/);
assert.match(configSource, /CHANNEL_POST_JIDS:/);
assert.doesNotMatch(mainSource, /isWhitelisted|owner-lists/);
assert.doesNotMatch(ownerSource, /normalizeAllowedJid|owner-lists/);

console.log('PASS: .addjid is owner-only, registers newsletter JIDs for follow and channel auto-react, and no longer controls private-mode allow-listing.');
