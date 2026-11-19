// .paymsg — Send a payment request message (anti-delete).
// Sends the text as a WhatsApp payment request (requestPaymentMessage).
// Payment messages cannot be deleted for everyone by group admins or the
// sender, so the message stays in the chat. Amount is RANDOM dollars.
// Sends ONLY the payment card — no confirmation text (like JAWAD-MD).
//
// NOTE: Baileys sendMessage() does NOT support requestPaymentMessage —
// generateWAMessageContent() has no case for it and falls through to
// prepareWAMessageMedia(), which throws "Invalid media type". So we build
// the message with generateWAMessageFromContent() and send it with
// relayMessage() instead, bypassing that check.
//
// requestFrom AND userJid should be the bot's PHONE JID. conn.user.id can
// be a @lid on newer multi-device accounts (a LID renders as "Requested
// from Unknown"). The phone number is recovered from the LID via the
// signalRepository lidMapping when available; otherwise the botNumber
// from pairing is used. The payment is ALWAYS sent — a missing phone
// number falls back to conn.user.id rather than failing the command.
//
// Usage:
//   .paymsg <text>                  -> send to this chat
//   .paymsg <group link> <text>     -> send to the group from the invite link
const { cmd } = require('../ahmad-core');
const { generateWAMessageFromContent, jidNormalizedUser } = require('@whiskeysockets/baileys');

function randomDollars() {
    // Random whole-dollar amount, $10 - $999.
    return Math.floor(Math.random() * 990) + 10;
}

const digits = (v) => String(v || '').replace(/[^0-9]/g, '');

// Best-effort bot JID for requestFrom/userJid. Prefers a phone JID
// (digits@s.whatsapp.net) so "Requested from" shows WhatsApp / WhatsApp
// Business instead of "Unknown". Never returns null.
async function botJid(conn, botNumber, botNumber2) {
    // 1. botNumber — the bot's real number from pairing.
    const b = digits(botNumber);
    if (b && b.length >= 8 && b.length <= 15) return `${b}@s.whatsapp.net`;
    // 2. botNumber2 — jidNormalizedUser(conn.user.id).
    const b2 = jidNormalizedUser(botNumber2 || '') || '';
    if (b2.endsWith('@s.whatsapp.net')) return b2;
    // 3. conn.user.id — if it is a LID, convert it to the phone number.
    const uid = conn.user?.id || '';
    if (!uid) return '';
    const norm = jidNormalizedUser(uid) || uid;
    if (norm.endsWith('@s.whatsapp.net')) return norm;
    try {
        const lidMap = conn.signalRepository?.lidMapping;
        if (lidMap && typeof lidMap.getPNForLID === 'function') {
            const pn = await lidMap.getPNForLID(uid);
            const p = pn ? String(pn) : '';
            if (p) return p.includes('@') ? p : `${digits(p)}@s.whatsapp.net`;
        }
    } catch (_) {}
    // 4. Last resort — use the id as-is (may render as "Unknown", but the
    // payment still sends instead of failing the command).
    return norm || uid;
}

cmd({
    pattern: 'paymsg',
    desc: 'Send a payment request message (anti-delete)',
    category: 'tools',
    react: '💸'
}, async (conn, mek, m, { from, reply, sender, botNumber, botNumber2, q }) => {
    const input = (q || '').trim();
    if (!input) {
        return reply('❌ Usage: .paymsg <text>\nOr: .paymsg <group link> <text>');
    }

    let targetJid = from;
    let messageText = input;

    // Group-link mode: first token is a chat.whatsapp.com invite link.
    const firstToken = input.split(/\s+/)[0];
    if (/chat\.whatsapp\.com\//i.test(firstToken)) {
        const code = firstToken.split(/chat\.whatsapp\.com\//i)[1].split(/[?\/\s]/)[0];
        if (!code) return reply('❌ That group link looks invalid.');
        try {
            const info = await conn.groupGetInviteInfo(code);
            targetJid = info.id;
        } catch (e) {
            return reply('❌ Could not read that group link. Make sure it is a valid WhatsApp group invite link.');
        }
        messageText = input.slice(firstToken.length).trim();
        if (!messageText) {
            return reply('❌ Please add a message after the group link.\nUsage: .paymsg <group link> <text>');
        }
    }

    const dollars = randomDollars();
    const amount1000 = dollars * 1000;
    const requester = (await botJid(conn, botNumber, botNumber2)) || sender;
    const expiry = Math.floor(Date.now() / 1000) + 86400; // 24 hours

    try {
        const waMsg = generateWAMessageFromContent(targetJid, {
            requestPaymentMessage: {
                currencyCodeIso4217: 'USD',
                amount1000: amount1000,
                requestFrom: requester,
                noteMessage: {
                    extendedTextMessage: { text: messageText }
                },
                expiryTimestamp: expiry,
                amount: {
                    currencyCode: 'USD',
                    offset: 1000,
                    value: amount1000
                }
            }
        }, { userJid: requester });
        await conn.relayMessage(targetJid, waMsg.message, { messageId: waMsg.key.id });
        // No confirmation text — the payment card itself is the output.
    } catch (e) {
        console.log('[PAYMSG ERROR]', e.message);
        return reply(`❌ Could not send the payment message (${e.message || 'unknown error'}). Make sure the bot is in that group and try again.`);
    }
});
