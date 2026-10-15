// .gcstatus — innovatorssoft proven approach (2026-10-15)
// Uses sendMessage with groupStatus:true; the Baileys patch handles
// wrapping + isGroupStatus + mediatype inside generateWAMessageContent.
const { cmd } = require('../ahmad-core');

async function downloadBuffer(mediaMsg, type) {
  const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
  const stream = await downloadContentFromMessage(mediaMsg, type);
  let buf = Buffer.from([]);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

cmd({
  pattern: 'gcstatus',
  alias: ['gcs'],
  desc: 'Post group status (text/image/video)',
  category: 'group',
  react: '📡',
  filename: __filename
}, async (conn, mek, m, { body, reply, from, isGroup }) => {
  try {
    if (!isGroup) return reply('❌ Group main hi chalega.');
    const text = body.split(' ').slice(1).join(' ').trim();

    // Media: quoted reply OR direct attachment with .gcstatus caption
    let mediaMsg = null, mediaKind = null;
    const q = m.quoted?.message;
    if (q?.imageMessage) { mediaMsg = q.imageMessage; mediaKind = 'image'; }
    else if (q?.videoMessage) { mediaMsg = q.videoMessage; mediaKind = 'video'; }
    else {
      const dm = mek?.message || {};
      const k = Object.keys(dm).find(x => x === 'imageMessage' || x === 'videoMessage');
      if (k) { mediaMsg = dm[k]; mediaKind = k === 'imageMessage' ? 'image' : 'video'; }
    }

    if (mediaKind) {
      const buf = await downloadBuffer(mediaMsg, mediaKind);
      const content = mediaKind === 'image'
        ? { image: buf, caption: text || mediaMsg.caption || '', groupStatus: true }
        : { video: buf, caption: text || mediaMsg.caption || '', mimetype: 'video/mp4', groupStatus: true };
      await conn.sendMessage(from, content);
      await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
      return reply('✅ 𝘚𝘵𝘢𝘵𝘶𝘴 𝘱𝘰𝘴𝘵𝘦𝘥.');
    }

    if (text) {
      await conn.sendMessage(from, { text, groupStatus: true });
      await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
      return reply('✅ 𝘚𝘵𝘢𝘵𝘶𝘴 𝘱𝘰𝘴𝘵𝘦𝘥.');
    }

    return reply('❌ Pic/video ke sath ya reply karke .gcstatus likho.\n💡 Ya: .gcstatus Hello');
  } catch (e) {
    console.log('GCSTATUS ERROR:', e?.message || e);
    return reply('❌ Error: ' + (e?.message || 'unknown'));
  }
});
