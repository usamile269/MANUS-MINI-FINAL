const { cmd } = require('../ahmad-core');
const { sleep } = require('../lib/functions');
const config = require('../config');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
// 🚨 BUG FIX (Bunty: ".vv → ERROR: randomFooter is not defined") — every
// reply box in this file uses randomFooter() but the import was missing
// entirely, so it crashed the moment it tried to build the footer.
const { randomFooter } = require('../lib/menu-styles');

async function downloadViewOnce(msgContent, type) {
    const mediaType = type === "imageMessage" ? "image" : type === "videoMessage" ? "video" : "audio";
    const mediaObj = msgContent[type];
    if (!mediaObj || !mediaObj.mediaKey) {
        throw new Error(`No mediaKey found for ${type}. The quoted message may be too old or not cached.`);
    }
    const stream = await downloadContentFromMessage(mediaObj, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

// Try the pre-captured cache first (works even if the view-once was already opened),
// then fall back to a live re-download attempt (only works if it's still unopened).
// 🚨 CROSS-SESSION LEAK FIX (Bunty): this bot can run multiple paired
// numbers in one process, and WhatsApp message IDs aren't guaranteed
// unique across different sessions — so the cache lookup MUST be scoped
// by botNumber (see lib/viewonce-capture.js's scopedKey), or one paired
// session's .vv/.vv2 could pull back media captured under a totally
// different session/chat.
async function getViewOnceMedia(m, botNumber, conn, from) {
    const stanzaId = m.quoted && m.quoted.stanzaId;
    const altId = m.quoted && m.quoted.key && m.quoted.key.id;
    const keys = [];
    if (stanzaId) keys.push(`${botNumber || 'unknown'}::${stanzaId}`);
    if (altId && altId !== stanzaId) keys.push(`${botNumber || 'unknown'}::${altId}`);

    const tryCache = () => {
        if (!global.viewOnceCache) return null;
        for (const cacheKey of keys) {
            if (!global.viewOnceCache.has(cacheKey)) continue;
            const cached = global.viewOnceCache.get(cacheKey);
            try {
                const fs = require('fs');
                const buffer = fs.readFileSync(cached.filePath);
                return { buffer, type: cached.type };
            } catch (_) { /* file missing/expired, keep trying other keys */ }
        }
        return null;
    };

    // Fast path: already captured.
    let hit = tryCache();
    if (hit) return hit;

    // 🚨 INSTANT FIX (Ahmad 2026-11-18 — "usi time sab ho", no waiting):
    // do NOT wait for the background capture. The bot's message store
    // already holds the original view-once message (WITH its mediaKey)
    // from the moment it arrived — look it up by id and download the
    // media directly, right now. This is what makes .vv work the instant
    // it's used, instead of racing the background capture.
    if (conn && conn.ahmadStore && from) {
        const ids = [];
        if (stanzaId) ids.push(stanzaId);
        if (altId && altId !== stanzaId) ids.push(altId);
        for (const id of ids) {
            try {
                const orig = await conn.ahmadStore.loadMessage(from, id);
                if (!orig || !orig.message) continue;
                let inner = orig.message;
                if (inner.viewOnceMessage) inner = inner.viewOnceMessage.message;
                else if (inner.viewOnceMessageV2) inner = inner.viewOnceMessageV2.message;
                else if (inner.viewOnceMessageV2Extension) inner = inner.viewOnceMessageV2Extension.message;
                const type = inner ? Object.keys(inner)[0] : null;
                if (!type || !['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) continue;
                const buffer = await downloadViewOnce(inner, type);
                return { buffer, type };
            } catch (_) { /* try next id, then fall through to live download */ }
        }
    }

    if (!m.quoted.message) throw new Error("Quoted message content not available anymore.");
    let msg = m.quoted.message;
    if (msg?.viewOnceMessage) msg = msg.viewOnceMessage.message;
    else if (msg?.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message;
    else if (msg?.viewOnceMessageV2Extension) msg = msg.viewOnceMessageV2Extension.message;
    const type = msg ? Object.keys(msg)[0] : null;
    if (!type) throw new Error("Could not read quoted media type.");
    const buffer = await downloadViewOnce(msg, type);
    return { buffer, type };
}

// ============================================================
// 👑 VV / VVWHERE - Sends view-once media right here in the same
// chat (Ahmad 2026-11-18: .vv and .vvhere do the same thing — no
// more auto-send to owner DM/inbox).
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

        // 🔥 VIEW ONCE FIX
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

        // 📤 Send right here in the same chat (Ahmad 2026-11-18: .vv and
        // .vvhere do the same thing — no more auto-send to owner DM).
        // `mek` lives in this same chat, so quoting it here is safe.
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
// 🔥 VV2 - PUBLIC VERSION (Sends to User's DM)
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

        // 📤 Send to user's DM (who used the command)
        const userJid = m.sender; // The person who sent the command

        // ✅ FIX: same cross-chat quoted issue as .vv — mek belongs to the
        // group, not the user's DM.
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
// 🎯 EMOJI COMMAND - PUBLIC (Sends to User's DM)
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

        // Send to user's DM
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
