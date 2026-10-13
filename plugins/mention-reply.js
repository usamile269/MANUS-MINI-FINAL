// ============================================================================
// plugins/mention-reply.js — .mention on/off + .setmention <text>
// Mention-responder: jab koi group mein bot ko mention/tag kare, bot auto-
// reply karta hai. Toggle per botNumber (har paired number apna set kare).
// Actual reply-sending main.js mein hota hai (har message dekhna zaroori).
// ============================================================================
const { cmd } = require('../ahmad-core');
const { getMentionReplySettings, setMentionReplySettings, DEFAULT_TEXT } = require('../data/MentionReply');

cmd({
    pattern: "mention",
    alias: ["mentionreply", "tagreply"],
    desc: "Auto-reply when someone mentions the bot",
    category: "settings",
    react: "📢",
    use: ".mention on/off"
}, async (conn, mek, m, { isOwner, isMe, botNumber, args, reply, isGroup }) => {
    if (!isMe && !isOwner) return reply('⛔ Owner only!');
    const sub = (args[0] || '').toLowerCase();
    const s = await getMentionReplySettings(botNumber);

    if (sub === 'on') {
        await setMentionReplySettings(botNumber, { enabled: true });
        return reply('📢 *MENTION REPLY: ON* ✅\n\nAb koi apko mention karega to bot auto-reply karega!\n\n_Reply change karne ke liye: .setmention <text>_');
    }
    if (sub === 'off') {
        await setMentionReplySettings(botNumber, { enabled: false });
        return reply('📢 *MENTION REPLY: OFF* ❌');
    }
    // status
    return reply(`📢 *MENTION REPLY*\n\nStatus: ${s.enabled ? 'ON ✅' : 'OFF ❌'}\n\nCurrent reply:\n${s.text}\n\n*.mention on/off*\n*.setmention <apna text>*`);
});

cmd({
    pattern: "setmention",
    alias: ["setmentionreply", "settagreply"],
    desc: "Set custom mention auto-reply text",
    category: "settings",
    react: "✏️",
    use: ".setmention <text>"
}, async (conn, mek, m, { isOwner, isMe, botNumber, args, reply }) => {
    if (!isMe && !isOwner) return reply('⛔ Owner only!');
    const text = args.join(' ').trim();
    if (!text) {
        const s = await getMentionReplySettings(botNumber);
        return reply(`✏️ *Current mention reply:*\n\n${s.text}\n\n_Change: .setmention <apna text>_\n_Reset: .setmention reset_`);
    }
    if (text.toLowerCase() === 'reset') {
        await setMentionReplySettings(botNumber, { text: DEFAULT_TEXT });
        return reply('✏️ Mention reply reset to default! ✅');
    }
    await setMentionReplySettings(botNumber, { text });
    return reply(`✏️ *Mention reply set!* ✅\n\n${text}`);
});
