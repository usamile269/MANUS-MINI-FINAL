const { cmd } = require('../ahmad-core');
const { downloadContentFromMessage, generateWAMessage, prepareWAMessageMedia } = require('@whiskeysockets/baileys');
const { randomFooter } = require('../lib/menu-styles');
const crypto = require('crypto');

// ============================================================================
// .gcstatus — Group Status (groupStatusMessageV2)
// ============================================================================
// 2026-10-15: official Baileys 7.0.0-rc14 + a small patch
// (patches/@whiskeysockets+baileys+7.0.0-rc14.patch, applied automatically by
// patch-package on `npm install`). The patch mirrors the vkazee/baileys
// fork's proven group-status implementation inside relayMessage:
//   1. messageSecret is injected at BOTH the outer messageContextInfo level
//      and the inner groupStatusMessageV2.message.messageContextInfo level.
//   2. getMessageType() returns 'text' for groupStatusMessageV2 BEFORE
//      normalizeMessageContent unwraps it (otherwise the stanza type logic
//      misfires and WhatsApp silently drops the media).
// With that in place, image/video/audio/sticker post as REAL group statuses.
// (An earlier attempt switched package.json to the vkazee fork itself, but
// the fork is ESM-only with top-level await — it can't be require()'d from
// this CommonJS bot on Node 24 — and its git-based libsignal dependency
// broke the Railway build. So: official lib + patch instead.)
// ============================================================================

// Invite-link preview for .gcstatus.
// Ahmad's screenshot: other bots' .gcstatus shows the group invite CARD
// (pic + name + "Group chat invite") in the status, ours shows plain text.
// Root cause: link previews are sender-embedded; bots must attach them.
function extractInviteLink(text) {
  if (!text) return null;
  const m = text.match(/https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/i);
  return m ? m[0] : null;
}

async function buildInvitePreview(conn, inviteUrl, fallbackJid) {
  const code = inviteUrl.split('/').pop();
  let groupName = 'WhatsApp Group';
  let groupJid = fallbackJid || null;
  try {
    if (typeof conn.groupGetInviteInfo === 'function') {
      const info = await conn.groupGetInviteInfo(code);
      if (info) {
        if (info.subject) groupName = info.subject;
        if (info.id) groupJid = info.id;
      }
    }
  } catch (e) {}
  if (groupName === 'WhatsApp Group' && fallbackJid) {
    try {
      const meta = await conn.groupMetadata(fallbackJid);
      if (meta && meta.subject) groupName = meta.subject;
    } catch (e) {}
  }
  let thumb = null;
  if (groupJid) {
    try {
      const picUrl = await conn.profilePictureUrl(groupJid, 'image');
      if (picUrl) {
        const res = await fetch(picUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) thumb = Buffer.from(await res.arrayBuffer());
      }
    } catch (e) {}
  }
  const ad = {
    title: groupName,
    body: 'Group chat invite',
    sourceUrl: inviteUrl,
    mediaType: 1,
    renderLargerThumbnail: true,
    showAdAttribution: false,
  };
  if (thumb) ad.thumbnail = thumb;
  return ad;
}

async function relayGroupStatusV2(conn, jid, msgContent) {
  // MEDIA: prepare via official Baileys, then relay wrapped in
  // groupStatusMessageV2. The patch-package patch makes relayMessage inject
  // messageSecret at both levels and send the stanza as the fork does.
  if (msgContent.image || msgContent.video || msgContent.audio || msgContent.sticker) {
    let mediaInput;
    if (msgContent.image) {
      mediaInput = { image: msgContent.image, caption: msgContent.caption || '' };
    } else if (msgContent.video) {
      mediaInput = { video: msgContent.video, caption: msgContent.caption || '', mimetype: 'video/mp4' };
    } else if (msgContent.audio) {
      mediaInput = { audio: msgContent.audio, mimetype: msgContent.mimetype || 'audio/mp4', ptt: !!msgContent.ptt };
    } else {
      mediaInput = { sticker: msgContent.sticker };
    }
    // Mirror the WORKING text path: build the full wrapper explicitly with
    // messageSecret at the groupStatusMessageV2 level (the patch-package
    // patch then also ensures outer + inner messageContextInfo secrets).
    const messageSecret = crypto.randomBytes(32);
    const prepared = await prepareWAMessageMedia(mediaInput, { upload: conn.waUploadToServer });
    const relayMsg = {
      groupStatusMessageV2: {
        message: prepared,
        messageContextInfo: { messageSecret }
      }
    };
    return conn.relayMessage(jid, relayMsg, {});
  }

  // TEXT: manual relay (already working — green-ring status).
  const messageSecret = crypto.randomBytes(32);
  const msg = await generateWAMessage(jid, msgContent, {
    userJid: conn.user.id,
    upload: conn.waUploadToServer
  });
  const relayMsg = {
    groupStatusMessageV2: {
      message: msg.message,
      messageContextInfo: { messageSecret }
    }
  };
  await conn.relayMessage(jid, relayMsg, { messageId: msg.key.id });
  return msg;
}

// ============================================================================
// .gcstatus / .gstatus / .poststatus / .statuspost
// ----------------------------------------------------------------------------
// Posts directly into the group as a native Group Status (groupStatusMessageV2)
// — NOT the bot's own personal WhatsApp Status. Unlike the old status@broadcast
// approach, this isn't subject to "only people who've saved the bot's number
// as a contact can see it" — it's genuinely a group-scoped post.
// ============================================================================

async function downloadQuotedMedia(quotedMsg, type) {
  const mediaTypeMap = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker' };
  const mediaType = mediaTypeMap[type];
  const stream = await downloadContentFromMessage(quotedMsg[type], mediaType);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

cmd({
  pattern: "groupstatus",
  alias: ["gstatus", "poststatus", "statuspost", "gcstatus"],
  desc: "Post text/image/video/audio/sticker as a native Group Status, visible to everyone in this group",
  category: "group",
  react: "📡",
  filename: __filename
}, async (conn, mek, m, { body, reply, from, isGroup }) => {
  try {
    if (!isGroup) return reply("❌ This command only works in groups.");
    await conn.sendMessage(from, { react: { text: "📡", key: m.key } });
    const caption = body.split(" ").slice(1).join(" ");
    const quoted = m.quoted?.message;
    // Short + mature confirmation (Ahmad, 2026-10-15) — same line for every type.
    const done = () => `✅ 𝘚𝘵𝘢𝘵𝘶𝘴 𝘱𝘰𝘴𝘵𝘦𝘥.`;

    if (!quoted && caption) {
      // Invite-link preview card in the status itself (Ahmad's
      // screenshot: other bots show pic+name card, ours was plain).
      const inviteUrl = extractInviteLink(caption);
      if (inviteUrl) {
        const adReply = await buildInvitePreview(conn, inviteUrl, from);
        await relayGroupStatusV2(conn, from, { text: caption, contextInfo: { externalAdReply: adReply } });
      } else {
        await relayGroupStatusV2(conn, from, { text: caption });
      }
      await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
      return reply(done('Text status posted!'));
    }

    if (!quoted) {
      await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
      return reply(`❌ No message or media!\n💡 Use: .gcstatus Hello\n💡 Or reply to media with .gcstatus`);
    }

    if (quoted.imageMessage) {
      const media = await downloadQuotedMedia(quoted, 'imageMessage');
      const imgCaption = caption || quoted.imageMessage.caption || '';
      await relayGroupStatusV2(conn, from, { image: media, caption: imgCaption }).catch(e => console.log('GROUPSTATUS MEDIA RELAY ERROR:', e?.message || e));
      // Also post to bot's own status (backup - supports images properly)
      try {
        await conn.sendMessage('status@broadcast', { image: media, caption: imgCaption });
      } catch (e) {}
      // Invite-link preview card on the visible group message too
      // (Ahmad: ".gcstatus may pic atii, link [ka preview] nii").
      let imgCtx = {};
      const imgInvite = extractInviteLink(imgCaption);
      if (imgInvite) {
        imgCtx = { externalAdReply: await buildInvitePreview(conn, imgInvite, from) };
      }
      await conn.sendMessage(from, {
        image: media,
        caption: `╭═══ 📡 GC STATUS ═══⊷\n┃❃│ ${imgCaption || 'Image status'}\n╰═════════════════⊷`,
        contextInfo: imgCtx
      }, { quoted: mek });
      await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
      return reply(done('Image status posted!'));
    }

    if (quoted.videoMessage) {
      const media = await downloadQuotedMedia(quoted, 'videoMessage');
      const vidCaption = caption || quoted.videoMessage.caption || '';
      await relayGroupStatusV2(conn, from, { video: media, caption: vidCaption, mimetype: 'video/mp4' }).catch(e => console.log('GROUPSTATUS MEDIA RELAY ERROR:', e?.message || e));
      let vidCtx = {};
      const vidInvite = extractInviteLink(vidCaption);
      if (vidInvite) {
        vidCtx = { externalAdReply: await buildInvitePreview(conn, vidInvite, from) };
      }
      await conn.sendMessage(from, {
        video: media,
        mimetype: 'video/mp4',
        caption: `╭═══ 📡 GC STATUS ═══⊷\n┃❃│ ${vidCaption || 'Video status'}\n╰═════════════════⊷`,
        contextInfo: vidCtx
      }, { quoted: mek });
      await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
      return reply(done('Video status posted!'));
    }

    if (quoted.audioMessage) {
      const media = await downloadQuotedMedia(quoted, 'audioMessage');
      await relayGroupStatusV2(conn, from, { audio: media, mimetype: "audio/mp4", ptt: false }).catch(() => {});
      await conn.sendMessage(from, { audio: media, mimetype: "audio/mp4", ptt: false }, { quoted: mek });
      await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
      return reply(done('Audio status posted!'));
    }

    if (quoted.stickerMessage) {
      const media = await downloadQuotedMedia(quoted, 'stickerMessage');
      await relayGroupStatusV2(conn, from, { sticker: media }).catch(() => {});
      await conn.sendMessage(from, { sticker: media }, { quoted: mek });
      await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
      return reply(done('Sticker status posted!'));
    }

    if (quoted.documentMessage || quoted.conversation || quoted.extendedTextMessage) {
      const text = caption || quoted.extendedTextMessage?.text || quoted.conversation || 'No text';
      await relayGroupStatusV2(conn, from, { text });
      await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
      return reply(done('Text/Doc status posted!'));
    }

    await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
    return reply(`❌ Unsupported media type — reply to image/video/audio/sticker/text.`);
  } catch (err) {
    console.log("GROUPSTATUS ERROR:", err);
    await conn.sendMessage(from, { react: { text: "❌", key: m.key } });
    reply(`❌ Error: ${err.message}\n📌 Ensure bot's account allows Status posting.`);
  }
});
