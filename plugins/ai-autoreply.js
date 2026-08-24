// ============================================================================
// plugins/ai-autoreply.js — ".aibyahmad" — simplified to ONE thing (Bunty:
// "storage boht ho raha, aiby ahmad se saara heavy settings hata do, sirf
// DM auto-reply on/off wala rahay").
//
// Everything else that used to live here (group mode, persona, custom
// footer, ignore list, known-contacts-only, active hours, voice replies,
// daily summary, live test) has been removed on purpose — every one of
// those was its own field saved to MongoDB per botNumber, its own
// in-memory cache/Map in main.js, and its own code path. Cutting them
// down to just enabled/disabled means far less written to the DB and far
// less kept in memory, which is exactly the "storage boht" complaint.
//
// Toggle lives per botNumber (each paired WhatsApp number is its own
// instance). The actual auto-reply SENDING happens in main.js (needs to
// see every incoming message, not just command messages) — this file is
// just the on/off switch.
// ============================================================================
const { cmd } = require('../ahmad-core');
const { getAIAutoReplySettings, setAIAutoReplySettings } = require('../data/AIAutoReply');
const { randomFooter, toSansBoldItalic } = require('../lib/menu-styles');

function box(title, lines) {
    return `╭◆──「 ✦ ${toSansBoldItalic(title)} ✦ 」──◆╮\n` +
        lines.map(l => `┃  ${l}`).join('\n') + '\n' +
        `╰──────────────────────╯\n\n` +
        `> ${randomFooter()}`;
}

cmd({
    pattern: "aibyahmad",
    alias: ["aiby", "aiauto", "autoai"],
    desc: "🤖 AI auto-reply for your DMs — on/off",
    category: "settings",
    react: "🤖",
    use: ".aibyahmad on/off",
    filename: __filename
}, async (conn, mek, m, { isOwner, isMe, botNumber, args, reply }) => {
    // isMe (you're messaging yourself on the number you paired), not the
    // single global config.OWNER_NUMBER — this is per-instance, every paired
    // user configures their OWN DM auto-replies.
    if (!isMe && !isOwner) return reply(box('AIBYAHMAD', ['⛔ Only the number you paired can run this — it controls your own DM auto-replies.']));

    const sub = (args[0] || '').toLowerCase();
    const s = await getAIAutoReplySettings(botNumber);

    if (sub === 'on') {
        await setAIAutoReplySettings(botNumber, { enabled: true });
        reply(box('AIBYAHMAD', ['✅ DM Auto-Reply: ON', '💬 Anyone who DMs you now gets a real AI reply, understood in context.']));

    } else if (sub === 'off') {
        await setAIAutoReplySettings(botNumber, { enabled: false });
        reply(box('AIBYAHMAD', ['❌ DM Auto-Reply: OFF']));

    } else {
        reply(box('AIBYAHMAD', [
            `Status: ${s.enabled ? '✅ ON' : '❌ OFF'}`,
            `──────────────`,
            `💡 .aibyahmad on`,
            `💡 .aibyahmad off`
        ]));
    }
});

// Group AI auto-reply — stored per group, so enabling it here never affects
// another group or private chats. Only group admins/owner may change it.
cmd({
    pattern: "aigc",
    alias: ["gcautoai", "groupai", "gcautoreply"],
    desc: "AI auto-reply in this group — on/off",
    category: "group",
    react: "🧠",
    use: ".aigc on/off"
}, async (conn, mek, m, { isGroup, isAdmins, isOwner, args, reply, from }) => {
    if (!isGroup) return reply(box('GROUP AI', ['❌ Yeh command sirf group mein use hoti hai.']));
    if (!isAdmins && !isOwner) return reply(box('GROUP AI', ['⛔ Sirf group admins ya owner is setting ko change kar sakte hain.']));
    const { getGroupSettings, setGroupSettings } = require('../data/GroupSettings');
    const sub = (args[0] || '').toLowerCase();
    const current = await getGroupSettings(from);
    if (sub === 'on' || sub === 'off') {
        const enabled = sub === 'on';
        const saved = await setGroupSettings(from, { aiGroupAutoReply: enabled });
        if (!saved) return reply(box('GROUP AI', ['❌ Setting save nahi hui, dobara try karo.']));
        require('../lib/group-extra-cache').invalidate(from);
        return reply(box('GROUP AI', [enabled ? '✅ Group AI Auto-Reply: ON' : '❌ Group AI Auto-Reply: OFF', '🛡️ Sirf non-admin messages par reply karega.', '⏱️ Anti-spam cooldown active rahega.']));
    }
    return reply(box('GROUP AI', [
        `Status: ${current.aiGroupAutoReply ? '✅ ON' : '❌ OFF'}`,
        '💡 .aigc on',
        '💡 .aigc off'
    ]));
});

module.exports = {};

