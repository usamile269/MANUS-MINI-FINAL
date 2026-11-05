// ============================================================================
// plugins/ai-personal.js — per-person personalization for .aiauto.
// Har banda apna profile set karta hai (name + details), AI yaad rakhta hai
// aur reply mein naam use karta hai — realistic, jaise dost baat kar raha ho.
// Profile har sender ke number par MongoDB mein save hoti hai (restart-safe);
// chat history sirf memory mein rehti hai (koi per-message DB write nahi).
//
// .setname <name>   — apna naam set karo (masalan: .setname Ali)
// .setabout <text>  — apne baare mein details (masalan: .setabout I am 20, from Lahore, I like cricket)
// .myprofile        — dekho AI ne tumhare baare mein kya yaad rakha hai
// .forgetme         — apna profile delete karo
// ============================================================================
const { cmd } = require('../ahmad-core');
const { getUserProfile, setUserProfile, deleteUserProfile, normalizeNumber } = require('../data/UserProfile');
const { randomFooter } = require('../lib/menu-styles');

const FOOTER = () => `\n\n> ${randomFooter()}`;

function senderNumber(mek, m) {
    const raw = (m && m.sender) || (mek && mek.key && (mek.key.participant || mek.key.remoteJid)) || '';
    return normalizeNumber(raw);
}

cmd({
    pattern: "setname",
    alias: ["setmyname"],
    desc: "Set your name so the AI remembers you and uses it in replies",
    category: "ai",
    react: "👤"
}, async (conn, mek, m, { q, reply }) => {
    const name = (q || '').trim().replace(/\s+/g, ' ');
    if (!name) return reply("❌ Usage: .setname <your name>\nExample: .setname Ali" + FOOTER());
    if (name.length > 30) return reply("❌ Name is too long — keep it under 30 characters." + FOOTER());
    const number = senderNumber(mek, m);
    if (!number) return reply("❌ Could not identify your number, try again." + FOOTER());
    const ok = await setUserProfile(number, { name });
    if (!ok) return reply("❌ Could not save your name, try again." + FOOTER());
    reply(`✅ Got it — I'll remember you as *${name}*. From now on I'll talk to you like a friend who knows you.` + FOOTER());
});

cmd({
    pattern: "setabout",
    alias: ["setinfo"],
    desc: "Tell the AI about yourself (age, city, likes) so replies feel personal",
    category: "ai",
    react: "📝"
}, async (conn, mek, m, { q, reply }) => {
    const about = (q || '').trim().replace(/\s+/g, ' ');
    if (!about) return reply("❌ Usage: .setabout <about yourself>\nExample: .setabout I am 20, from Lahore, I like cricket" + FOOTER());
    if (about.length > 300) return reply("❌ That's too long — keep it under 300 characters." + FOOTER());
    const number = senderNumber(mek, m);
    if (!number) return reply("❌ Could not identify your number, try again." + FOOTER());
    const ok = await setUserProfile(number, { about });
    if (!ok) return reply("❌ Could not save that, try again." + FOOTER());
    reply(`✅ Noted — I'll remember that about you.` + FOOTER());
});

cmd({
    pattern: "myprofile",
    alias: ["mydata"],
    desc: "See what the AI remembers about you",
    category: "ai",
    react: "👤"
}, async (conn, mek, m, { reply }) => {
    const number = senderNumber(mek, m);
    if (!number) return reply("❌ Could not identify your number, try again." + FOOTER());
    const profile = await getUserProfile(number);
    if (!profile || (!profile.name && !profile.about)) {
        return reply("👤 I don't know anything about you yet.\n\nUse *.setname <your name>* and *.setabout <about yourself>* and I'll remember you." + FOOTER());
    }
    const lines = [`👤 *YOUR PROFILE*`, ``];
    if (profile.name) lines.push(`Name: ${profile.name}`);
    if (profile.about) lines.push(`About: ${profile.about}`);
    lines.push(``, `Use *.forgetme* to delete this.`);
    reply(lines.join('\n') + FOOTER());
});

cmd({
    pattern: "forgetme",
    desc: "Delete everything the AI remembers about you",
    category: "ai",
    react: "🗑️"
}, async (conn, mek, m, { reply }) => {
    const number = senderNumber(mek, m);
    if (!number) return reply("❌ Could not identify your number, try again." + FOOTER());
    const ok = await deleteUserProfile(number);
    if (!ok) return reply("❌ Could not delete that, try again." + FOOTER());
    reply(`✅ Done — I've forgotten everything about you. Use *.setname <your name>* if you want me to remember you again.` + FOOTER());
});
