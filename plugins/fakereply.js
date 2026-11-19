// .fakereply — Send a message that looks like a reply to someone else.
// WhatsApp shows a quoted message from the contextInfo the sender provides
// and does not verify that the quoted message really exists, so a fabricated
// quote renders exactly like a real reply.
//
// Usage:
//   .fakereply <number/@user/name> | <fake message> | <your reply>
//   .fakereply 923001234567 | Hello bro | Theek hoon yaar!
//   .fakereply @Ahmad | Hello bro | Theek hoon yaar!
const { cmd } = require('../ahmad-core');

cmd({
    pattern: 'fakereply',
    alias: ['fakequote', 'fr'],
    desc: 'Send a message as a fake reply to someone',
    category: 'tools',
    react: '🎭'
}, async (conn, mek, m, { from, reply, sender, mentionedJid, groupMetadata, isGroup, q }) => {
    const input = (q || '').trim();
    const parts = input.split('|').map(s => s.trim());
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
        return reply('❌ Usage: .fakereply <number/@user/name> | <fake message> | <your reply>\n\nExample: .fakereply 923001234567 | Hello bro | Theek hoon yaar!\nExample: .fakereply @Ahmad | Hello bro | Theek hoon yaar!');
    }
    const [who, fakeText, replyText] = parts;

    let fakeJid = null;
    // 1. @mention
    if (mentionedJid && mentionedJid.length) {
        fakeJid = mentionedJid[0];
    } else {
        const digits = who.replace(/[^0-9]/g, '');
        // 2. Pure phone number (digits, +, spaces, - only)
        if (/^[+0-9\s-]+$/.test(who) && digits.length >= 8 && digits.length <= 15) {
            fakeJid = `${digits}@s.whatsapp.net`;
        } else if (isGroup && groupMetadata && groupMetadata.participants) {
            // 3. Group member by display name
            const needle = who.toLowerCase();
            const found = groupMetadata.participants.find(p => {
                const name = String(p.notify || p.pushName || '').toLowerCase();
                const id = String(p.id || '').toLowerCase();
                return (name && name.includes(needle)) || id.includes(needle);
            });
            if (found) fakeJid = found.id;
        }
    }
    if (!fakeJid) {
        return reply('❌ Could not find that person. Use a number (e.g. 923001234567), @mention them, or use their exact name from this group.');
    }

    const fakeQuoted = {
        key: {
            remoteJid: from,
            fromMe: false,
            id: 'BAE5' + Math.random().toString(36).slice(2, 10).toUpperCase(),
            participant: fakeJid
        },
        message: { conversation: fakeText }
    };
    try {
        await conn.sendMessage(from, { text: replyText }, { quoted: fakeQuoted });
    } catch (e) {
        return reply(`❌ Could not send the fake reply (${e.message || 'unknown error'}).`);
    }
});
