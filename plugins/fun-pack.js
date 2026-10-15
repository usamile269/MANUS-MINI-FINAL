const { cmd } = require('../lib/command');

const bezatis = [
    "@user teri bezati karne ke liye alfaaz kam pad jayein 😭",
    "@user tu wo hai jise dekh kar darwaza khud band ho jaye 🚪",
    "@user teri shakal dekh kar aina toot jaye 🪞💔",
    "@user tu itna bekaar hai ke raddi wala bhi na le 🗑️",
    "@user teri auqaat chappal se bhi kam hai 🩴",
    "@user tu paida hua to doctor ne kaha 'yeh to gaya' 👨‍⚕️",
    "@user teri baatein sun kar neend aa jaye 😴",
    "@user tu wo kachra hai jo recycle bhi nahi hota ♻️❌",
];

const dialogues = [
    "🎬 'Mogambo khush hua!' 😎",
    "🎬 'Rishte mein to hum tumhare baap lagte hain!' 👨",
    "🎬 'Don ko pakadna mushkil hi nahi, namumkin hai!' 🕶️",
    "🎬 'Kitne aadmi the?' 🔫",
    "🎬 'Pushpa naam sunke flower samjhe kya? Fire hai main!' 🔥",
    "🎬 'All is well!' 🤗",
    "🎬 'Bade bade deshon mein aisi chhoti chhoti baatein hoti rehti hain!' 💕",
    "🎬 'Tareekh pe tareekh, tareekh pe tareekh!' ⚖️",
    "🎬 'Ja Simran ja, jee le apni zindagi!' ✈️",
    "🎬 'Dosti ka ek usool hai madam, no sorry no thank you!' 🤝",
];

const savages = [
    "💀 I'm not insulting you, I'm describing you.",
    "💀 You're the reason God created the middle finger.",
    "💀 I'd agree with you but then we'd both be wrong.",
    "💀 You're like a cloud, when you disappear it's a beautiful day.",
    "💀 Mirrors can't talk, lucky for you they can't laugh either.",
    "💀 You bring everyone joy... when you leave the room.",
    "💀 I'd call you a tool, but tools are useful.",
    "💀 Your birth certificate is an apology from the condom factory.",
];

const flirts = [
    "😘 Tumhari smile dekh kar dil garden garden ho gaya 🌸",
    "😘 Kya tum WiFi ho? Kyunki main tumse connect ho raha hun 📶❤️",
    "😘 Tum itni khoobsurat ho ke chand bhi sharma jaye 🌙",
    "😘 Meri aankhon main dekho, wahan sirf tum ho 👀❤️",
    "😘 Tum Google ho kya? Kyunki tumhare bina kuch nahi milta 🔍",
    "😘 Kya main tumhara naam apne dil pe likh dun? ✍️❤️",
    "😘 Tumhari ek muskaan pe poori duniya qurban 💕",
    "😘 Chai se zyada nasha teri aankhon main hai ☕👀",
];

const sads = [
    "💔 Toot kar bhi muskurana padta hai, yehi zindagi ka dastoor hai...",
    "💔 Mohabbat main haara hua insaan, duniya se bhi haar jata hai...",
    "💔 Aansu chhupane ka hunar aa gaya hai, ab dard bhi mehmaan lagta hai...",
    "💔 Wo chala gaya, lekin uski yaadein aaj bhi rula deti hain...",
    "💔 Dil toota hai, lekin umeed abhi baaki hai...",
    "💔 Raat bhar jaagta hun, subah ko hansta hun — yehi meri kahani hai...",
    "💔 Judai ka dard wo samjhe jo bichhda ho...",
    "💔 Khush rehne ka natak karna bhi ek kala hai...",
];

const attitudes = [
    "😎 Main wo hun jise dekh kar log kehte hain 'yeh to alag level hai'",
    "😎 Attitude mera janam sidh adhikaar hai",
    "😎 Sher apni taqat se nahi, apne attitude se raja hota hai 🦁",
    "😎 Log kehte hain badal gaya hun, main kehta hun sambhal gaya hun",
    "😎 Meri khamoshi ko kamzori mat samajhna",
    "😎 Style apna apna, attitude mera sab se alag",
    "😎 Main aaina hun, jaisa dekhoge waisa dikhunga 🪞",
    "😎 Waqt badalte der nahi lagti, bas attitude hona chahiye ⏰",
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getTarget(mentionedJid, mek, m) {
    let target = mentionedJid?.[0];
    if (!target) {
        const qp = mek.message?.extendedTextMessage?.contextInfo?.participant || m.quoted?.sender;
        if (qp) target = qp;
    }
    return target;
}

async function sendWithMention(conn, from, target, text) {
    const mentionText = target ? `@${target.split('@')[0]}` : "";
    const fullText = mentionText ? `${mentionText} ${text.replace('@user', '').trim()}` : text.replace('@user', '').trim();
    await conn.sendMessage(from, { text: fullText, mentions: target ? [target] : [] });
}

cmd({ pattern: "bezati", desc: "Bezti karo kisi ki", category: "fun", use: ".bezati @user", filename: __filename },
async (conn, mek, m, { from, mentionedJid }) => {
    const target = getTarget(mentionedJid, mek, m);
    await sendWithMention(conn, from, target, pick(bezatis));
});

cmd({ pattern: "dialogue", desc: "Random filmy dialogue", category: "fun", use: ".dialogue", filename: __filename },
async (conn, mek, m, { from }) => {
    await conn.sendMessage(from, { text: pick(dialogues) });
});

cmd({ pattern: "savage", desc: "Savage English roast", category: "fun", use: ".savage @user", filename: __filename },
async (conn, mek, m, { from, mentionedJid }) => {
    const target = getTarget(mentionedJid, mek, m);
    await sendWithMention(conn, from, target, pick(savages));
});

cmd({ pattern: "flirt", desc: "Flirty lines", category: "fun", use: ".flirt @user", filename: __filename },
async (conn, mek, m, { from, mentionedJid }) => {
    const target = getTarget(mentionedJid, mek, m);
    await sendWithMention(conn, from, target, pick(flirts));
});

cmd({ pattern: "sad", desc: "Sad shayari", category: "fun", use: ".sad", filename: __filename },
async (conn, mek, m, { from }) => {
    await conn.sendMessage(from, { text: pick(sads) });
});

cmd({ pattern: "attitude", desc: "Attitude status", category: "fun", use: ".attitude", filename: __filename },
async (conn, mek, m, { from }) => {
    await conn.sendMessage(from, { text: pick(attitudes) });
});
