// .paymsg — Send a payment request message (anti-delete).
// Sends the text as a WhatsApp payment request (requestPaymentMessage).
// Payment messages cannot be deleted for everyone by group admins or the
// sender, so the message stays in the chat. Amount is RANDOM dollars.
// Usage:
//   .paymsg <text>                  -> send to this chat
//   .paymsg <group link> <text>     -> send to the group from the invite link
const { cmd } = require('../ahmad-core');
const { randomFooter } = require('../lib/menu-styles');

function randomDollars() {
    // Random whole-dollar amount, $10 - $999.
    return Math.floor(Math.random() * 990) + 10;
}

cmd({
    pattern: 'paymsg',
    desc: 'Send a payment request message (anti-delete)',
    category: 'tools',
    react: '💸'
}, async (conn, mek, m, { from, reply, sender, q }) => {
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
    const requester = conn.user?.id || sender;

    try {
        await conn.sendMessage(targetJid, {
            requestPaymentMessage: {
                currencyCodeIso4217: 'USD',
                amount1000: amount1000,
                requestFrom: requester,
                noteMessage: {
                    extendedTextMessage: { text: messageText }
                },
                amount: {
                    currencyCode: 'USD',
                    offset: 1000,
                    value: amount1000
                }
            }
        });
        await reply(`✅ Payment message sent ($${dollars}).\n\n> ${randomFooter()}`);
    } catch (e) {
        console.log('[PAYMSG ERROR]', e.message);
        return reply('❌ Could not send the payment message. Make sure the bot is in that group and try again.');
    }
});
