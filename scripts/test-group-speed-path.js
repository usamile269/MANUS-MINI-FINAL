const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const sudoSource = fs.readFileSync(path.join(__dirname, '..', 'data', 'Sudo.js'), 'utf8');
const groupSettingsSource = fs.readFileSync(path.join(__dirname, '..', 'data', 'GroupSettings.js'), 'utf8');
assert.ok(source.includes("|| (isCmd && command !== 'ping' && await isSudo(botNumber, senderNumber)))();"), 'public ping must bypass the Sudo lookup');
assert.ok(source.includes("const needsGroupContext = (isCmd && command !== 'ping') || mightBeLink || groupExtraActive;"), 'ping must bypass group context metadata');
assert.ok(source.includes('if (isGroup && needsGroupContext) {'), 'group context must use the optimized predicate');
assert.ok(source.includes('void Promise.all(['), 'anti-feature work must not block ordinary replies');
assert.ok(source.includes("__mark('antideleteEditViewOnceStarted')"), 'the pre-dispatch timing marker must record detached side effects');
assert.ok(sudoSource.includes('const sudoRefreshing = new Map()'), 'Sudo reads must deduplicate in-flight refreshes');
assert.ok(sudoSource.includes('void refreshSudoList(botNumber)'), 'expired Sudo data must refresh in the background');
assert.ok(groupSettingsSource.includes('const groupSettingsRefreshing = new Map()'), 'group settings must deduplicate in-flight refreshes');
assert.ok(groupSettingsSource.includes('void refreshGroupSettings(chatId)'), 'expired group settings must refresh in the background');
console.log('group speed path regression: PASS');

