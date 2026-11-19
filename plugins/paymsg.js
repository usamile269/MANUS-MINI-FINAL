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
// requestFrom AND userJid MUST be the bot's PHONE JID. If either one ends
// up as the command sender (or a @lid), WhatsApp renders "Requested from
// <sender's name>" / "Unknown" instead of WhatsApp / WhatsApp Business.
// The bot's phone JID is derived robustly: botNumber (real number from
// pairing) first, then conn.user.id normalized to a phone JID. A LID is
// NEVER used — it renders as "Unknown", and a sender JID renders as the
// sender's name.
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

// Return the bot's phone JID (digits@s.whatsapp.net), or null if it cannot
// be determined. Never returns a LID or the command sender's JID.
function botPhoneJid(conn, botNumber, botNumber2, sender, senderNumber) {
    const digits = (v) => String(v || '').replace(/[^0-9]/g, '');
    const snd = digits(senderNumber) || digits(sender);
    // 1. botNumber — the bot's real number from pairing.
    const b = digits(botNumber);
    if (b && b.length >= 8 && b.length <= 15 && b !== snd) return `${b}@s.whatsapp.net`;
    // 2. botNumber2 — jidNormalizedUser(conn.user.id).
    const b2 = jidNormalizedUser(botNumber2 || '') || '';
    if (b2.endsWith('@s.whatsapp.net') && digits(b2) !== snd) return b2;
    // 3. conn.user.id — use it only if it is already a phone JID.
    const uid = jidNormalizedUser(conn.user?.id || '') || '';
    if (uid.endsWith('@s.whatsapp.net') && digits(uid) !== snd) return uid;
    return null;
}

cmd({
    pattern: 'paymsg',
    desc: 'Send a payment request message (anti-delete)',
    category: 'tools',
    react: '💸'
}, async (conn, mek, m, { from, reply, sender, senderNumber, botNumber, botNumber2, q }) => {
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
    const botJid = botPhoneJid(conn, botNumber, botNumber2, sender, senderNumber);
    if (!botJid) {
        return reply('❌ Could not determine the bot number. Try again.');
    }
    const expiry = Math.floor(Date.now() / 1000) + 86400; // 24 hours

    try {
        const waMsg = generateWAMessageFromContent(targetJid, {
            requestPaymentMessage: {
                currencyCodeIso4217: 'USD',
                amount1000: amount1000,
                requestFrom: botJid,
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
        }, { userJid: botJid });
        await conn.relayMessage(targetJid, waMsg.message, { messageId: waMsg.key.id });
        // No confirmation text — the payment card itself is the output.
    } catch (e) {
        console.log('[PAYMSG ERROR]', e.message);
        return reply(`❌ Could not send the payment message (${e.message || 'unknown error'}). Make sure the bot is in that group and try again.`);
    }
});
