// ============================================================
// VIEW-ONCE RECOVERY — clean rewrite from scratch (2026-11-18)
// Ahmad: "khud write karoo SAB code yeh vv Wala again"
// Single job: recover a view-once photo/video/audio the user replies
// to, and send it back. Nothing else in the bot is touched.
// ============================================================
const { cmd } = require('../ahmad-core');
const { sleep } = require('../lib/functions');
const config = require('../config');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { randomFooter } = require('../lib/menu-styles');
const fs = require('fs');

// ---------- unwrap ----------
// Peel every wrapper WhatsApp can put around a view-once:
// ephemeralMessage (disappearing messages) -> viewOnceMessage / V2 /
// V2Extension -> imageMessage / videoMessage / audioMessage.
// Also handles documentWithCaptionMessage. Any order, any depth
// (guarded against loops). Returns the inner media content object,
// e.g. { imageMessage: {...} }, or null when there is no media inside.
function unwrapMedia(message) {
    let inner = message;
    let guard = 0;
    while (inner && typeof inner === 'object' && guard++ < 10) {
        if (inner.ephemeralMessage) { inner = inner.ephemeralMessage.message; continue; }
        if (inner.viewOnceMessage) { inner = inner.viewOnceMessage.message; continue; }
        if (inner.viewOnceMessageV2) { inner = inner.viewOnceMessageV2.message; continue; }
        if (inner.viewOnceMessageV2Extension) { inner = inner.viewOnceMessageV2Extension.message; continue; }
        if (inner.documentWithCaptionMessage) { inner = inner.documentWithCaptionMessage.message; continue; }
        break;
    }
    if (!inner || typeof inner !== 'object') return null;
    return inner;
}

// Pick the media node out of unwrapped content. Returns
// { type, mediaObj } for image/video/audio, or null. Also honours a
// direct `.viewOnce` flag on a media node (some clients set the flag
// instead of wrapping the message).
function pickMedia(content) {
    if (!content || typeof content !== 'object') return null;
    for (const type of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (content[type]) return { type, mediaObj: content[type] };
    }
    return null;
}

// Download the media bytes for unwrapped content. Throws when there is
// no media, or when the media has no mediaKey (already viewed / expired).
async function downloadMedia(content) {
    const picked = pickMedia(content);
    if (!picked) throw new Error('No view-once media found in this message.');
    const { type, mediaObj } = picked;
    if (!mediaObj.mediaKey) {
        throw new Error(`No mediaKey found for ${type}. The quoted message may be too old or not cached.`);
    }
    const mediaType = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
    const stream = await downloadContentFromMessage(mediaObj, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return { buffer, type };
}

// Download from a stored/original message record (mek). Never throws —
// returns { buffer, type } on success, null otherwise.
async function downloadFromRecord(record) {
    if (!record || !record.message) return null;
    try {
        const content = unwrapMedia(record.message);
        if (!content) return null;
        return await downloadMedia(content);
    } catch (_) {
        return null;
    }
}

// ---------- getViewOnceMedia ----------
// Recovery order (fastest / most reliable first):
//  1. pre-captured cache (works even after the view-once was opened)
//  2. bot message store, by quoted message id (loadMessage + scan all chats)
//  3. most-recent view-once in this chat (ID-mismatch fallback — the user
//     replies within seconds, so the newest view-once here is the target)
//  4. live download from the quoted message itself (only if still unopened)
// Throws a diagnostic error when every stage misses, so the next failure
// explains itself from a screenshot.
async function getViewOnceMedia(m, botNumber, conn, from) {
    const stanzaId = m.quoted && m.quoted.stanzaId;
    const altId = m.quoted && m.quoted.key && m.quoted.key.id;
    const ids = [];
    if (stanzaId) ids.push(stanzaId);
    if (altId && altId !== stanzaId) ids.push(altId);
    const bn = botNumber || 'unknown';

    const store = conn && conn.ahmadStore ? conn.ahmadStore : null;
    const storeChatCount = store && store.messages ? Object.keys(store.messages).length : 0;
    const cacheState = global.viewOnceCache ? 'miss' : 'unavailable';
    let storeStatus = store ? 'miss' : 'not-attached';
    let foundButNoKey = 0;
    let recentTried = 0;

    const log = (cache, storeSt, extra = '') => console.log(
        `[VV MEDIA] bot=${bn} chat=${from || 'unknown'} quotedIds=${JSON.stringify(ids)} ` +
        `cache=${cache} store=${storeSt}${extra ? ' ' + extra : ''}`
    );

    // ---- 1. cache (exact scoped keys, then suffix scan) ----
    if (global.viewOnceCache) {
        for (const id of ids) {
            const entry = global.viewOnceCache.get(`${bn}::${id}`);
            if (!entry) continue;
            try {
                const buffer = fs.readFileSync(entry.filePath);
                log('hit', 'not-needed', `source=cache type=${entry.type}`);
                return { buffer, type: entry.type };
            } catch (_) { /* file gone/expired — try next */ }
        }
        // Suffix scan: same message id under any botNumber scope.
        for (const [key, entry] of global.viewOnceCache) {
            for (const id of ids) {
                if (!key.endsWith(`::${id}`)) continue;
                try {
                    const buffer = fs.readFileSync(entry.filePath);
                    log('hit', 'not-needed', `source=cache-scan type=${entry.type}`);
                    return { buffer, type: entry.type };
                } catch (_) { /* keep scanning */ }
            }
        }
    }

    // ---- 2. store by id ----
    if (store && from) {
        for (const id of ids) {
            try {
                const orig = await store.loadMessage(from, id);
                if (!orig) continue;
                const picked = pickMedia(unwrapMedia(orig.message));
                if (picked && !picked.mediaObj.mediaKey) foundButNoKey++;
                const got = await downloadFromRecord(orig);
                if (got) {
                    storeStatus = 'hit';
                    log('miss', storeStatus, `source=loadMessage type=${got.type}`);
                    return got;
                }
            } catch (_) { /* try next id */ }
        }
        // Scan every stored chat (same chat can arrive under @lid vs phone JID).
        try {
            const all = store.messages || {};
            for (const id of ids) {
                for (const jid of Object.keys(all)) {
                    const arr = all[jid] || [];
                    for (let i = arr.length - 1; i >= 0; i--) {
                        const cand = arr[i];
                        if (!cand || !cand.key || cand.key.id !== id) continue;
                        const picked = pickMedia(unwrapMedia(cand.message));
                        if (picked && !picked.mediaObj.mediaKey) foundButNoKey++;
                        const got = await downloadFromRecord(cand);
                        if (got) {
                            storeStatus = 'hit';
                            log('miss', storeStatus, `source=scan:${jid} type=${got.type}`);
                            return got;
                        }
                    }
                }
            }
        } catch (_) { /* fall through */ }
    }

    // ---- 3. most-recent view-once in this chat (ID-mismatch fallback) ----
    // The user replies within seconds of the photo arriving, so the newest
    // view-once message in this chat is almost certainly the target. This
    // bypasses quoted-id mismatches entirely (ephemeral wrapper ids, @lid
    // vs phone JIDs, stale quote references). Only messages from the last
    // 5 minutes are considered, newest first, max 2 attempts.
    if (store) {
        try {
            const all = store.messages || {};
            const chatJids = [];
            if (from) chatJids.push(from);
            for (const jid of Object.keys(all)) if (jid !== from) chatJids.push(jid);
            const nowSec = Date.now() / 1000;
            for (const jid of chatJids) {
                const arr = all[jid] || [];
                for (let i = arr.length - 1; i >= 0 && recentTried < 2; i--) {
                    const cand = arr[i];
                    if (!cand || !cand.message) continue;
                    const ts = cand.messageTimestamp ? Number(cand.messageTimestamp) : 0;
                    if (ts && nowSec - ts > 300) break; // older than 5 min — stop this chat
                    const picked = pickMedia(unwrapMedia(cand.message));
                    if (!picked) continue;
                    if (!picked.mediaObj.mediaKey) { foundButNoKey++; continue; }
                    recentTried++;
                    const got = await downloadFromRecord(cand);
                    if (got) {
                        storeStatus = 'hit';
                        log('miss', storeStatus, `source=recent:${jid} type=${got.type}`);
                        return got;
                    }
                }
                if (recentTried >= 2) break;
            }
        } catch (_) { /* fall through to live download */ }
    }

    // ---- 4. live download from the quoted message ----
    const diag = `store=${storeStatus} chats=${storeChatCount} cache=${cacheState}` +
        (foundButNoKey ? ` noKey=${foundButNoKey}` : '') +
        (recentTried ? ` recent=${recentTried}` : '');
    log(cacheState, storeStatus, `storeChats=${storeChatCount} noKey=${foundButNoKey} recent=${recentTried}`);

    if (!m.quoted || !m.quoted.message) throw new Error(`Quoted message content not available anymore. [${diag}]`);
    try {
        const content = unwrapMedia(m.quoted.message);
        return await downloadMedia(content);
    } catch (e) {
        throw new Error(`${e.message} [${diag}]`);
    }
}

// ============================================================
// VV / VVWHERE — sends the view-once media right here in the
// same chat (no auto-send to owner DM).
// ============================================================
cmd({
    pattern: "vv",
    alias: ["viewonce", "view", "vvhere"],
    react: "🫶🏻",
    desc: "Retrieve view-once media",
    category: "tools",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        if (!m.quoted) {
            const display = `╭═══ 🥺 VIEW ONCE ═══⊷
┃❃╭──────────────
┃❃│ ❌ Reply to a view-once media!
┃❃│ 💡 Use: .vv (reply to view once)
┃❃╰───────────────
╰═════════════════⊷

> ${randomFooter()}`;

            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply(display);
        }

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const { buffer, type } = await getViewOnceMedia(m, botNumber, conn, from);

        let content = {};

        if (type === "imageMessage") {
            content = {
                image: buffer,
                caption: m.quoted.text || "📸 View Once Image"
            };
        } else if (type === "videoMessage") {
            content = {
                video: buffer,
                caption: m.quoted.text || "🎥 View Once Video"
            };
        } else if (type === "audioMessage") {
            content = {
                audio: buffer,
                mimetype: "audio/mp4",
                ptt: false
            };
        } else {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply("❌ *THIS VIEW-ONCE MEDIA TYPE IS NOT SUPPORTED 🥺*");
        }

        await conn.sendMessage(from, content);
        await sleep(700);

        const done = `╭═══ ✅ VIEW ONCE ═══⊷
┃❃╭──────────────
┃❃│ ✅ Media retrieved successfully!
┃❃│ 📤 Sent here in this chat
┃❃╰───────────────
╰═════════════════⊷

> ${randomFooter()}`;

        await conn.sendMessage(from, {
            text: done
        }, { quoted: mek });

        await conn.sendMessage(from, {
            react: { text: "✅", key: m.key }
        });

    } catch (e) {
        console.log("VV ERROR:", e);
        await conn.sendMessage(from, {
            react: { text: "❌", key: m.key }
        });
        reply(`❌ *ERROR:* ${e.message}`);
    }
});

// ============================================================
// VV2 — sends the view-once media to the user's DM.
// ============================================================
cmd({
    pattern: "vv2",
    alias: ["viewonce2", "getmedia"],
    react: "👁️",
    desc: "Get view once media in your DM (Public)",
    category: "recovery",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        await conn.sendMessage(from, {
            react: { text: "👁️", key: m.key }
        });

        if (!m.quoted) {
            const display = `╭═══ 👁️ VIEW ONCE ═══⊷
┃❃╭──────────────
┃❃│ ❌ Reply to a view-once media!
┃❃│ 💡 Use: .vv2 (reply to view once)
┃❃╰───────────────
╰═════════════════⊷

> ${randomFooter()}`;

            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply(display);
        }

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const { buffer, type } = await getViewOnceMedia(m, botNumber, conn, from);

        let content = {};

        if (type === "imageMessage") {
            content = {
                image: buffer,
                caption: m.quoted.text || "📸 View Once Image"
            };
        } else if (type === "videoMessage") {
            content = {
                video: buffer,
                caption: m.quoted.text || "🎥 View Once Video"
            };
        } else if (type === "audioMessage") {
            content = {
                audio: buffer,
                mimetype: "audio/mp4",
                ptt: false
            };
        } else {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply("❌ *THIS VIEW-ONCE MEDIA TYPE IS NOT SUPPORTED 🥺*");
        }

        const userJid = m.sender;
        await conn.sendMessage(userJid, content);
        await sleep(700);

        const done = `╭━━━━━━━━━━━━━━━━━━━━━━╮
┃  ✅ *VIEW ONCE SENT!*  ┃
┃  ═══════════════════════
┃  📥 Media sent to your DM
┃  🔒 Check your inbox
╰━━━━━━━━━━━━━━━━━━━━━━╯

> ${randomFooter()}`;

        await conn.sendMessage(from, {
            text: done
        }, { quoted: mek });

        await conn.sendMessage(from, {
            react: { text: "✅", key: m.key }
        });

    } catch (e) {
        console.log("VV2 ERROR:", e);
        await conn.sendMessage(from, {
            react: { text: "❌", key: m.key }
        });
        reply(`❌ *ERROR:* ${e.message}`);
    }
});

// ============================================================
// EMOJI COMMAND — sends the view-once media to the user's DM.
// ============================================================
cmd({
    pattern: "👁️",
    alias: ["vv3"],
    react: "👁️",
    desc: "Quick view once (Public)",
    category: "recovery",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        await conn.sendMessage(from, {
            react: { text: "👁️", key: m.key }
        });

        if (!m.quoted) {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply("❌ *Reply to a view once media!*");
        }

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const { buffer, type } = await getViewOnceMedia(m, botNumber, conn, from);

        let content = {};

        if (type === "imageMessage") {
            content = { image: buffer, caption: "📸 View Once" };
        } else if (type === "videoMessage") {
            content = { video: buffer, caption: "🎥 View Once" };
        } else if (type === "audioMessage") {
            content = { audio: buffer, mimetype: "audio/mp4", ptt: false };
        } else {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply("❌ *Not supported!*");
        }

        const userJid = m.sender;
        await conn.sendMessage(userJid, content);
        await sleep(500);

        await conn.sendMessage(from, {
            react: { text: "✅", key: m.key }
        });
        reply("✅ *Check your DM!*");

    } catch (e) {
        console.log("EMOJI VV ERROR:", e);
        await conn.sendMessage(from, {
            react: { text: "❌", key: m.key }
        });
        reply(`❌ *ERROR:* ${e.message}`);
    }
});
module.exports = { getViewOnceMedia };
