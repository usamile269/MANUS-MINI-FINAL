// ============================================================================
// plugins/panel.js — User Web Panel ("My Panel") access commands.
//
// .panelpass — sends the paired number's CURRENT panel password to the
//              owner's own DM only (never in a group, where anyone could
//              read it). If the user changed their password in the panel,
//              .panelpass returns THAT SAME password (the owner asked for
//              exactly this). A fresh password is generated only when none
//              exists yet. Only the person who paired this number (isMe)
//              or the global owner can run it.
// .panel     — sends the panel link + a reminder how to get the password.
//
// Panel itself: https://ahmadminipair.vercel.app/panel (login = number +
// this password). Passwords are stored hashed (lib/database.js PanelUser).
// ============================================================================
const { cmd } = require('../ahmad-core');
const { setPanelPassword, getPanelPassword } = require('../lib/database');
const { randomFooter, toSansBoldItalic } = require('../lib/menu-styles');

const PANEL_URL = 'https://ahmadminipair.vercel.app/panel';

function box(title, lines) {
    return `╭◆──「 ✦ ${toSansBoldItalic(title)} ✦ 」──◆╮\n` +
        lines.map(l => `┃  ${l}`).join('\n') + '\n' +
        `╰──────────────────────╯\n\n` +
        `> ${randomFooter()}`;
}

function genPassword() {
    // Readable alphabet (no 0/O/1/l confusion), 10 characters.
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

cmd({
    pattern: "panelpass",
    alias: ["mypanelpass", "panelpassword"],
    desc: "🔐 Get your My Panel password (sent to your DM only)",
    category: "settings",
    react: "🔐",
    use: ".panelpass",
    filename: __filename
}, async (conn, mek, m, { isOwner, isMe, botNumber, from, reply }) => {
    if (!isMe && !isOwner) {
        return reply(box('MY PANEL', ['⛔ Only the number paired with this bot can get its panel password.']));
    }
    try {
        let password = await getPanelPassword(botNumber).catch(() => null);
        let isNew = false;
        if (!password) {
            password = genPassword();
            await setPanelPassword(botNumber, password);
            isNew = true;
        }
        const ownJid = `${botNumber}@s.whatsapp.net`;
        await conn.sendMessage(ownJid, {
            text: box('MY PANEL PASSWORD', [
                isNew ? `🔐 Your new panel password:` : `🔐 Your panel password (the one you saved):`,
                ``,
                `   *${password}*`,
                ``,
                `🌐 Panel: ${PANEL_URL}`,
                `📱 Login with your number + this password.`,
                `✏️ Change it any time from inside the panel —`,
                `   .panelpass will then show the new one.`,
                `🤫 Keep it private — anyone with it can open your panel.`
            ])
        });
        if (from !== ownJid) {
            return reply(box('MY PANEL', ['✅ Your panel password was sent to your DM.', '🤫 Never share it with anyone.']));
        }
    } catch (e) {
        return reply(box('MY PANEL', [`❌ Could not fetch your password right now: ${e.message}`]));
    }
});

cmd({
    pattern: "panel",
    alias: ["mypanel", "webpanel"],
    desc: "🌐 Open your My Panel (web) — manage your bot from the website",
    category: "settings",
    react: "🌐",
    use: ".panel",
    filename: __filename
}, async (conn, mek, m, { reply }) => {
    return reply(box('MY PANEL', [
        `🌐 Your panel: ${PANEL_URL}`,
        ``,
        `Yahan se aap apni DP, naam, bio, settings, AI persona`,
        `aur groups — sab web se manage kar sakte hain.`,
        ``,
        `🔐 Password chahiye? Apne number se .panelpass likhein,`,
        `password sirf aap ke DM mein aayega.`
    ]));
});
