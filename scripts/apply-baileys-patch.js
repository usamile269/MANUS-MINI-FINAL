// Applies the .gcstatus media fix to @whiskeysockets/baileys WITHOUT patch-package.
// patch-package fails on Suga's builder (its own applier rejects this patch even
// though `git apply` accepts it), so we do the same two edits with plain string
// replacement. Safe: idempotent, and never fails the install — if the expected
// code is not found it warns and exits 0, so the build still goes green.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const jobs = [
  {
    file: 'node_modules/@whiskeysockets/baileys/lib/Utils/messages.js',
    already: 'm = { groupStatusMessageV2: { message: m } };',
    anchor: '    if (shouldIncludeReportingToken(m)) {',
    insert: [
      '    // Group Status (innovatorssoft/Baileys proven): set isGroupStatus on inner',
      '    // message and wrap into groupStatusMessageV2 envelope',
      "    if (message && typeof message === 'object' && 'groupStatus' in message && !!message.groupStatus) {",
      '        const messageType = Object.keys(m)[0];',
      '        const key = m[messageType];',
      "        if (key && 'contextInfo' in key && !!key.contextInfo) {",
      '            key.contextInfo.isGroupStatus = message.groupStatus;',
      '        }',
      '        else if (key) {',
      '            key.contextInfo = {',
      '                isGroupStatus: message.groupStatus',
      '            };',
      '        }',
      '        m = { groupStatusMessageV2: { message: m } };',
      '        delete message.groupStatus;',
      '    }',
    ].join('\n'),
  },
  {
    file: 'node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js',
    already: 'getMediaType(normalizeMessageContent(message) || message)',
    anchor: 'const mediaType = getMediaType(message);',
    replacement: 'const mediaType = getMediaType(normalizeMessageContent(message) || message);',
  },
];

for (const job of jobs) {
  const p = path.join(root, job.file);
  if (!fs.existsSync(p)) {
    console.log(`[baileys-patch] skip (not installed): ${job.file}`);
    continue;
  }
  const src = fs.readFileSync(p, 'utf8');
  if (src.includes(job.already)) {
    console.log(`[baileys-patch] already applied: ${job.file}`);
    continue;
  }
  if (job.insert) {
    const idx = src.indexOf(job.anchor);
    if (idx === -1) {
      console.log(`[baileys-patch] WARNING anchor not found, skipping: ${job.file}`);
      continue;
    }
    fs.writeFileSync(p, src.slice(0, idx) + job.insert + '\n' + src.slice(idx));
  } else {
    if (!src.includes(job.anchor)) {
      console.log(`[baileys-patch] WARNING anchor not found, skipping: ${job.file}`);
      continue;
    }
    fs.writeFileSync(p, src.replace(job.anchor, job.replacement));
  }
  console.log(`[baileys-patch] applied: ${job.file}`);
}
console.log('[baileys-patch] done.');
