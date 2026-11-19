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
// requestFrom AND userJid MUST be the bot's PHONE JID
// (botNumber@s.whatsapp.net). conn.user.id can be a @lid on newer
// multi-device accounts: a LID requestFrom renders as "Requested from
// Unknown", and a LID userJid makes the card look like it came from the
// person who ran the command instead of the bot. botNumber is the real
// phone number from pairing (sanitizedNumber), so the card is from the
// bot and "Requested from" shows WhatsApp / WhatsApp Business.
//
// Usage:
//   .paymsg <text>                  -> send to this chat
//   .paymsg <group link> <text>     -> send to the group from the invite link
const { cmd } = require('../ahmad-core');
const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');

function randomDollars() {
    // Random whole-dollar amount, $10 - $999.
    return Math.floor(Math.random() * 990) + 10;
}

cmd({
    pattern: 'paymsg',
    desc: 'Send a payment request message (anti-delete)',
    category: 'tools',
    react: '💸'
}, async (conn, mek, m, { from, reply, sender, botNumber, q }) => {
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
    // Bot's real phone JID — NOT conn.user.id (can be a @lid).
    const botJid = botNumber ? `${botNumber}@s.whatsapp.net` : (conn.user?.id || sender);
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
