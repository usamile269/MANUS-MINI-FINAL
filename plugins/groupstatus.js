// .gcstatus — clean rewrite (2026-10-15)
// Based on deep-research findings from working forks
// (mauricegift/gifted-baileys, innovatorssoft, wolfsocket):
//  - stanza: type="media" + mediatype="image|video" for media, type="text" for text
//  - envelope: { groupStatusMessageV2: { message: <inner> } }, NO inner messageContextInfo
//  - one outer messageContextInfo.messageSecret (pre-set so Baileys patch skips its injection)
//  - inner.contextInfo.isGroupStatus = true
const { cmd } = require('../ahmad-core');
const crypto = require('crypto');

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
    const messageSecret = crypto.randomBytes(32);

    // Media source: quoted reply OR direct attachment with .gcstatus caption
    let mediaMsg = null, mediaKind = null; // 'image' | 'video'
    const q = m.quoted?.message;
    if (q?.imageMessage) { mediaMsg = q.imageMessage; mediaKind = 'image'; }
    else if (q?.videoMessage) { mediaMsg = q.videoMessage; mediaKind = 'video'; }
    else {
      const dm = mek?.message || {};
      const k = Object.keys(dm).find(x => x === 'imageMessage' || x === 'videoMessage');
      if (k) { mediaMsg = dm[k]; mediaKind = k === 'imageMessage' ? 'image' : 'video'; }
    }

    if (mediaKind) {
      // 1. download + re-upload via Baileys (proven path)
      const buf = await downloadBuffer(mediaMsg, mediaKind);
      const { prepareWAMessageMedia } = require('@whiskeysockets/baileys');
      const prepared = await prepareWAMessageMedia(
        mediaKind === 'image'
          ? { image: buf, caption: text || mediaMsg.caption || '' }
          : { video: buf, caption: text || mediaMsg.caption || '', mimetype: 'video/mp4' },
        { upload: conn.waUploadToServer }
      );
      const innerKey = mediaKind === 'image' ? 'imageMessage' : 'videoMessage';
      const inner = prepared[innerKey] || {};
      // 2. research-backed envelope: isGroupStatus, NO inner messageContextInfo
      inner.contextInfo = { ...(inner.contextInfo || {}), isGroupStatus: true };
      delete prepared.messageContextInfo;
      const relayMsg = {
        messageContextInfo: { messageSecret },
        groupStatusMessageV2: { message: prepared }
      };
      // 3. correct stanza typing: type=media + mediatype
      await conn.relayMessage(from, relayMsg, {
        additionalAttributes: { type: 'media', mediatype: mediaKind }
      });
      await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
      return reply('✅ 𝘚𝘵𝘢𝘵𝘶𝘴 𝘱𝘰𝘴𝘵𝘦𝘥.');
    }

    if (text) {
      const inner = { extendedTextMessage: { text } };
      inner.extendedTextMessage.contextInfo = { isGroupStatus: true };
      const relayMsg = {
        messageContextInfo: { messageSecret },
        groupStatusMessageV2: { message: inner }
      };
      await conn.relayMessage(from, relayMsg, {
        additionalAttributes: { type: 'text' }
      });
      await conn.sendMessage(from, { react: { text: '✅', key: m.key } });
      return reply('✅ 𝘚𝘵𝘢𝘵𝘶𝘴 𝘱𝘰𝘴𝘵𝘦𝘥.');
    }

    return reply('❌ Pic/video ke sath ya reply karke .gcstatus likho.\n💡 Ya: .gcstatus Hello');
  } catch (e) {
    console.log('GCSTATUS ERROR:', e?.message || e);
    return reply('❌ Error: ' + (e?.message || 'unknown'));
  }
});
