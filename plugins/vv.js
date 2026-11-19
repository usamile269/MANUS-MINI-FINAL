'use strict';
// plugins/vv.js — .vv / .vv2 / .vv3 view-once recovery
// Context: AHMAD-MD, Baileys @whiskeysockets/baileys, Node.js, Railway
// Exports: getViewOnceMedia, unwrapMedia, downloadMedia, downloadFromRecord, scopedKey

const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { cmd } = require('../ahmad-core');
const { randomFooter } = require('../lib/menu-styles');

// ─── scoped key ──────────────────────────────────────────────────────────────
// Produces the lookup key used by both vv.js and viewonce-capture.js.
// Must match EXACTLY what captureViewOnce uses to store entries.
function scopedKey(botNumber, jid, msgId) {
  const bot = (botNumber || '').replace(/[^0-9]/g, '');
  return `${bot}::${jid}::${msgId}`;
}

// ─── layer unwrap ────────────────────────────────────────────────────────────
// Peels up to 12 nesting layers to find imageMessage/videoMessage/audioMessage.
// Returns the inner media object or null.
// Handles: viewOnceMessage, viewOnceMessageV2, viewOnceMessageV2Extension,
//          ephemeralMessage, documentWithCaptionMessage, and others.
const VIEWONCE_WRAPPERS = [
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
];
const PASSTHROUGH_WRAPPERS = [
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'templateMessage',
  'buttonsMessage',
  'interactiveMessage',
  'productMessage',
];
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];

function unwrapMedia(msgObj) {
  if (!msgObj || typeof msgObj !== 'object') return null;
  let obj = msgObj;
  for (let depth = 0; depth < 12; depth++) {
    // Direct media hit
    for (const mt of MEDIA_TYPES) {
      if (obj[mt]) return obj[mt];
    }
    // View-once wrapper — go one level deeper into its message field
    for (const vw of VIEWONCE_WRAPPERS) {
      if (obj[vw]) {
        const inner = obj[vw].message || obj[vw];
        if (inner && inner !== obj) { obj = inner; break; }
      }
    }
    // Pass-through wrappers
    let descended = false;
    for (const pw of PASSTHROUGH_WRAPPERS) {
      if (obj[pw]) {
        const inner = obj[pw].message || obj[pw];
        if (inner && inner !== obj) { obj = inner; descended = true; break; }
      }
    }
    if (!descended) break;
  }
  // Final pass on obj itself
  for (const mt of MEDIA_TYPES) {
    if (obj[mt]) return obj[mt];
  }
  return null;
}

// ─── detect if a raw message contains a view-once ────────────────────────────
function isViewOnceMsg(mek) {
  const content = mek?.message;
  if (!content) return false;
  for (const vw of VIEWONCE_WRAPPERS) {
    if (content[vw]) return true;
  }
  // Also check ephemeral wrapping a viewOnce
  const eph = content.ephemeralMessage?.message;
  if (eph) {
    for (const vw of VIEWONCE_WRAPPERS) {
      if (eph[vw]) return true;
    }
  }
  return false;
}

// ─── determine media type string ─────────────────────────────────────────────
function mediaTypeOf(mediaObj) {
  if (!mediaObj) return null;
  if (mediaObj.mimetype?.startsWith('video/')) return 'video';
  if (mediaObj.mimetype?.startsWith('audio/')) return 'audio';
  return 'image';
}

// ─── stream download with timeout ────────────────────────────────────────────
const DL_TIMEOUT_MS = 25_000;

async function downloadMedia(mediaObj, typeHint) {
  const type = typeHint || mediaTypeOf(mediaObj) || 'image';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Download timed out after ${DL_TIMEOUT_MS / 1000}s`)),
      DL_TIMEOUT_MS
    );
    const chunks = [];
    (async () => {
      try {
        const stream = await downloadContentFromMessage(mediaObj, type);
        for await (const chunk of stream) chunks.push(chunk);
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    })();
  });
}

// ─── download from a captured record ─────────────────────────────────────────
// record = { mediaObj, buf } — buf may be pre-downloaded, or we re-download.
async function downloadFromRecord(record) {
  if (!record) return null;
  if (record.buf && Buffer.isBuffer(record.buf) && record.buf.length > 0) {
    return record.buf;
  }
  if (record.mediaObj) {
    return downloadMedia(record.mediaObj, record.mediaType);
  }
  return null;
}

// ─── build the send payload ──────────────────────────────────────────────────
function buildPayload(buf, mediaType, caption) {
  const foot = `📸 View Once\n\n> ${randomFooter()}`;
  const cap = caption ? `${caption}\n\n${foot}` : foot;
  if (mediaType === 'video') return { video: buf, caption: cap };
  if (mediaType === 'audio') return { audio: buf, mimetype: 'audio/mp4', ptt: false };
  return { image: buf, caption: cap };
}

// ─── send recovered media ────────────────────────────────────────────────────
async function sendRecovered(conn, targetJid, buf, mediaType, originalCaption) {
  const payload = buildPayload(buf, mediaType, originalCaption || '');
  await conn.sendMessage(targetJid, payload);
}

// ─── look up from every available source ─────────────────────────────────────
// Returns { buf, mediaType, caption, source } or null.
// Sources tried in order: in-memory viewonce-capture cache → store → disk cache.

async function getViewOnceMediaCore(conn, quotedMek, { botNumber, from }) {
  // Lazy-require capture module to avoid circular deps
  const vc = require('../lib/viewonce-capture');

  const qKey = quotedMek?.key;
  const qMsg = quotedMek?.message;
  if (!qKey || !qMsg) return null;

  const jid = from || qKey.remoteJid;
  const msgId = qKey.id;
  const bot = botNumber || conn?.user?.id || '';

  const diag = { store: 'miss', chats: 0, cache: 'miss', disk: 'miss', noKey: 0 };

  // 1. In-memory capture cache (viewonce-capture.js maintains this)
  const cacheKey = scopedKey(bot, jid, msgId);
  const cached = vc.captureCache?.get(cacheKey);
  if (cached) {
    diag.cache = 'hit';
    try {
      const buf = await downloadFromRecord(cached);
      if (buf && buf.length > 0) {
        return { buf, mediaType: cached.mediaType, caption: cached.caption, source: 'cache' };
      }
    } catch (_) {}
  }

  // 2. ahmadStore — check if the full original mek is still there
  const storeMek = (conn?.ahmadStore && typeof conn.ahmadStore.loadMessage === 'function')
    ? await conn.ahmadStore.loadMessage(jid, msgId)
    : null;
  if (storeMek) {
    diag.store = 'hit';
    diag.chats = Object.keys(conn.ahmadStore?.messages || {}).length;
    const media = unwrapMedia(storeMek.message);
    if (media?.mediaKey) {
      try {
        const buf = await downloadMedia(media, mediaTypeOf(media));
        if (buf && buf.length > 0) {
          return { buf, mediaType: mediaTypeOf(media), caption: media.caption, source: 'store' };
        }
      } catch (_) { diag.noKey++; }
    } else {
      diag.noKey++;
    }
  } else {
    diag.chats = Object.keys(conn.ahmadStore?.messages || {}).length;
  }

  // 3. Disk cache (populated by handleAntiViewOnce on first arrival)
  const diskRecord = await vc.loadDiskRecord(cacheKey);
  if (diskRecord) {
    diag.disk = 'hit';
    try {
      const buf = await downloadFromRecord(diskRecord);
      if (buf && buf.length > 0) {
        return { buf, mediaType: diskRecord.mediaType, caption: diskRecord.caption, source: 'disk' };
      }
    } catch (_) {}
  }

  return { buf: null, mediaType: null, caption: null, source: null, diag };
}

// ─── exported getViewOnceMedia (both signatures) ─────────────────────────────
// New style (used inside this file):
//   getViewOnceMedia(conn, quotedMek, { botNumber, from })
//     -> { buf, mediaType, caption, source, diag }
// Old style (used by plugins/recovery-tools.js .vvpost/.vvdoc):
//   getViewOnceMedia(m, botNumber, conn, from)
//     -> { buffer, type }  (type = 'imageMessage'|'videoMessage'|'audioMessage',
//                            throws on failure, like the old version did)
async function getViewOnceMedia(a, b, c, d) {
  // New style: a=conn (has .user), b=quotedMek (has .key)
  if (a && a.user && b && b.key) {
    return getViewOnceMediaCore(a, b, c || {});
  }
  // Old style: a=m (has .quoted), b=botNumber (string), c=conn, d=from
  if (a && a.quoted && typeof b === 'string') {
    const m = a, botNumber = b, conn = c, from = d;
    const q = m.quoted;
    const quotedMek = {
      key: {
        remoteJid: from,
        id: q?.id || q?.stanzaId,
        fromMe: q?.fromMe ?? false,
        participant: q?.participant,
      },
      message: q?.message || q,
    };
    const res = await getViewOnceMediaCore(conn, quotedMek, { botNumber, from });
    if (!res || !res.buf) {
      const dg = res?.diag;
      throw new Error(dg
        ? `Recovery failed [store=${dg.store} chats=${dg.chats} cache=${dg.cache} disk=${dg.disk} noKey=${dg.noKey}]`
        : 'Recovery failed');
    }
    const type = res.mediaType === 'video' ? 'videoMessage'
      : res.mediaType === 'audio' ? 'audioMessage' : 'imageMessage';
    return { buffer: res.buf, type };
  }
  return null;
}

// ─── shared recovery logic ───────────────────────────────────────────────────
// dest: 'chat' (send to `from`) | 'dm' (send to sender DM)
// Errors follow the SAME destination as the result: .vv errors go to the
// chat, .vv2/.vv3 errors go to the REQUESTER'S DM only (never the group).
async function runRecovery(conn, mek, m, { from, reply, sender }, dest) {
  async function sendErr(text) {
    if (dest === 'dm') {
      const dm = sender || m?.sender;
      if (dm) {
        try { await conn.sendMessage(dm, { text }); return; } catch (_) {}
      }
    }
    if (typeof reply === 'function') {
      try { await reply(text); return; } catch (_) {}
    }
    try { await conn.sendMessage(from, { text }); } catch (_) {}
  }

  const quoted = m?.quoted || mek?.message?.extendedTextMessage?.contextInfo;
  if (!quoted) {
    return sendErr('Reply to a view-once message with .vv to recover it.');
  }

  // Build a minimal mek-like object for the quoted message
  const quotedMek = {
    key: {
      remoteJid: from,
      id: quoted.id || quoted.stanzaId,
      fromMe: quoted.fromMe ?? false,
      participant: quoted.participant,
    },
    message: quoted.message || quoted,
  };

  if (!quotedMek.key.id) {
    return sendErr('Could not read the quoted message ID. Try again.');
  }

  const botNumber = conn?.user?.id || '';
  let result;
  try {
    result = await getViewOnceMedia(conn, quotedMek, { botNumber, from });
  } catch (err) {
    return sendErr(`Recovery failed: ${err.message}`);
  }

  if (!result || !result.buf) {
    const diag = result?.diag;
    let reason = 'The view-once could not be recovered.';
    if (diag) {
      if (diag.cache === 'miss' && diag.disk === 'miss' && diag.store === 'miss') {
        reason =
          'The bot did not capture this view-once on arrival (it may have arrived before the bot was running, or the bot was redeployed). Send a new view-once after deploy and try again.';
      } else if (diag.noKey > 0) {
        reason =
          'Found the message but WhatsApp already stripped the media key (view-once was opened before the bot could download it).';
      }
      reason += `\n\n_[store=${diag.store} chats=${diag.chats} cache=${diag.cache} disk=${diag.disk} noKey=${diag.noKey}]_`;
    }
    return sendErr(reason);
  }

  const targetJid = dest === 'dm' ? (sender || m?.sender) : from;
  if (!targetJid) return sendErr('Could not determine where to send the recovered media.');

  try {
    await sendRecovered(conn, targetJid, result.buf, result.mediaType, result.caption);
    if (dest === 'dm' && targetJid !== from) {
      await reply(`Sent to your DM. _(source: ${result.source})_`);
    }
  } catch (err) {
    return sendErr(`Recovered the media but failed to send it: ${err.message}`);
  }
}

// ─── .vv — recover to same chat ─────────────────────────────────────────────
cmd(
  {
    pattern: 'vv',
    alias: ['viewonce', 'view', 'vvhere'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video (reply to it). Result goes to this chat.',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, sender }) => {
    await runRecovery(conn, mek, m, { from, reply, sender }, 'chat');
  }
);

// ─── .vv2 — recover to requester's DM ───────────────────────────────────────
cmd(
  {
    pattern: 'vv2',
    alias: ['viewonce2', 'getmedia'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video (reply to it). Result goes to YOUR DM.',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, sender }) => {
    await runRecovery(conn, mek, m, { from, reply, sender }, 'dm');
  }
);

// ─── .vv3 — recover to requester's DM (alias) ───────────────────────────────
cmd(
  {
    pattern: 'vv3',
    alias: ['👁️'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video (reply to it). Result goes to YOUR DM.',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, sender }) => {
    await runRecovery(conn, mek, m, { from, reply, sender }, 'dm');
  }
);

// ─── exports (required by main.js and plugins/recovery-tools.js) ─────────────
module.exports = {
  getViewOnceMedia,
  unwrapMedia,
  downloadMedia,
  downloadFromRecord,
  scopedKey,
};
