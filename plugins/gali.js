const { cmd } = require('../lib/command');
const fs = require('fs');
const path = require('path');

const GALI_FILE = path.join(__dirname, '..', 'data', 'custom-galis.json');

const defaultGalis = [
    "Bhosdike teri maa ko 🖕 chodun, paidaishi chutiye 👶",
    "Madarchod teri behen ki chut main 🍆 de dun",
    "Behenchod teri gaand maar dun 🍑🔨",
    "Lund lele apne munh main 🍆👄, chutiye",
    "Teri maa ki chut, bhosdike 💦",
    "Gaand mara ke aaya hai kya? 🍑💥",
    "Chut ke dhakkan, teri chut main keeda 🐛",
    "Lund choos mere 🍆, madarchod",
    "Teri behen ki phudi maar dun 🌸🔨",
    "Bhosde ke baal, jhaant ke baal 🪒💩",
    "Teri maa ka bhosda, chutiye 🖕💦",
    "Lund pe charh ja, madarchod 🍆🧗",
    "Chut maar ke aaya kya? 🌸👊",
    "Gaand main ungli kar dunga 🍑👉",
    "Teri behen ko chod dun 🌸🍆",
    "Bhosde ka Tattoo bana dun tere munh par 🎨🖕",
    "Lund ka paani pila dun 💦🍆",
    "Chutiyaap na kar, bhosdike 🤡🖕",
    "Teri gaand ki seal tod dun 🔨🍑",
    "Maa chod dunga teri 👩🍆",
];

function getGalis() {
    try {
        if (fs.existsSync(GALI_FILE)) {
            const custom = JSON.parse(fs.readFileSync(GALI_FILE, 'utf8'));
            return [...defaultGalis, ...custom];
        }
    } catch {}
    return defaultGalis;
}

function saveCustomGali(text) {
    try {
        const dir = path.dirname(GALI_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        let custom = [];
        if (fs.existsSync(GALI_FILE)) {
            custom = JSON.parse(fs.readFileSync(GALI_FILE, 'utf8'));
        }
        custom.push(text);
        fs.writeFileSync(GALI_FILE, JSON.stringify(custom, null, 2));
        return true;
    } catch { return false; }
}

cmd({
    pattern: "gali",
    desc: "Send a random desi gali",
    category: "fun",
    use: ".gali @user",
    filename: __filename
}, async (conn, mek, m, { from, mentionedJid }) => {
    const target = mentionedJid?.[0];
    const galis = getGalis();
    const gali = galis[Math.floor(Math.random() * galis.length)];
    const mention = target ? `@${target.split('@')[0]}` : "Oye";
    await conn.sendMessage(from, {
        text: `${mention} ${gali}`,
        mentions: target ? [target] : []
    }, { quoted: mek });
});

cmd({
    pattern: "addgali",
    desc: "Add your own custom gali",
    category: "fun",
    use: ".addgali <your gali text>",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    if (!q) return reply("Usage: .addgali <your gali text>\nExample: .addgali Teri to...");
    if (saveCustomGali(q)) {
        reply(`✅ Gali added! Total: ${getGalis().length}`);
    } else {
        reply("❌ Failed to save gali.");
    }
});
