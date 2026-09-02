const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const configSource = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const ownerSource = fs.readFileSync(path.join(root, 'plugins', 'owner.js'), 'utf8');
const removedJid = '120363366922413790@newsletter';

assert.match(configSource, new RegExp(`REMOVED_CHANNEL_JIDS:[\\s\\S]*?${removedJid}`));
const followList = configSource.match(/AUTO_FOLLOW_JIDS:\s*\[([\s\S]*?)\]/)?.[1] || '';
const reactList = configSource.match(/CHANNEL_POST_JIDS:\s*\[([\s\S]*?)\]/)?.[1] || '';
assert.doesNotMatch(followList, new RegExp(removedJid));
assert.doesNotMatch(reactList, new RegExp(removedJid));
assert.match(mainSource, /unfollowRemovedChannels/);
assert.match(mainSource, /config\.REMOVED_CHANNEL_JIDS/);
assert.match(mainSource, /conn\.newsletterUnfollow\(jid\)/);
assert.match(ownerSource, /pattern:\s*'removejid'[\s\S]*?conn\.newsletterUnfollow\(jid\)/);

console.log('PASS: removed channel JID is blocked from follow/react lists and explicitly unfollowed at runtime.');
