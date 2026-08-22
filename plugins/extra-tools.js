const { cmd } = require('../ahmad-core');
const config = require('../config');
const { renderQuotedCard } = require('../lib/menu-styles');

// ==================== TIME ====================
cmd({
    pattern: "time",
    alias: ["clock"],
    desc: "🕐 Get current time",
    category: "general",
    react: "🕐",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        const moment = require("moment-timezone");
        const now = moment().tz("Asia/Karachi");
        reply(renderQuotedCard('LOCAL TIME', [`🕘 ${now.format('hh:mm:ss A')}`, `📅 ${now.format('dddd, DD MMMM YYYY')}`, '🌍 Timezone: Asia/Karachi'], undefined, '🕐'));
    } catch (e) {
        reply("❌ Error: " + e.message);
    }
});

// ==================== JID ====================
cmd({
    pattern: "jid",
    desc: "🆔 Get chat JID",
    category: "general",
    react: "🆔",
    filename: __filename
}, async (conn, mek, m, { from, reply, quoted }) => {
    // A forwarded WhatsApp Channel post carries its newsletter JID in
    // forwardedNewsletterMessageInfo. Return only that JID for .jid.
    const ctx = quoted?.message?.contextInfo || mek?.message?.contextInfo;
    const channelJid = ctx?.forwardedNewsletterMessageInfo?.newsletterJid;
    if (/^\d+@newsletter$/.test(String(channelJid || ''))) {
        return reply(channelJid);
    }
    // Preserve the original behavior for normal chats.
    return reply(from);
});

// ==================== MYID ====================
cmd({
    pattern: "myid",
    desc: "🆔 Get your number/JID",
    category: "general",
    react: "🆔",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    reply(renderQuotedCard('YOUR ID', [`🆔 ${m.sender}`], undefined, '🆔'));
});

// ==================== COINFLIP ====================
cmd({
    pattern: "coinflip",
    alias: ["flip", "toss"],
    desc: "🪙 Flip a coin",
    category: "fun",
    react: "🪙",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    const result = Math.random() < 0.5 ? "Heads 🪙" : "Tails 🪙";
    reply(renderQuotedCard('COIN FLIP', [`🎯 Result: ${result}`], undefined, '🪙'));
});

// ==================== DICE ====================
cmd({
    pattern: "dice",
    alias: ["roll"],
    desc: "🎲 Roll a dice",
    category: "fun",
    react: "🎲",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    const result = Math.floor(Math.random() * 6) + 1;
    reply(renderQuotedCard('DICE ROLL', [`🎲 You rolled: ${result}`], undefined, '🎲'));
});

// ==================== 8BALL ====================
cmd({
    pattern: "ask8ball",
    alias: ["8b"],
    desc: "🎱 Magic 8 ball (alt version)",
    category: "fun",
    react: "🎱",
    use: ".ask8ball <question>",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    const question = args.join(" ");
    if (!question) return reply("❌ Use: .ask8ball <your question>");

    const answers = [
        "Yes, definitely!", "No way.", "Maybe...", "Ask again later.",
        "Without a doubt.", "Very doubtful.", "It is certain.",
        "Cannot predict now.", "Most likely.", "My sources say no."
    ];
    const answer = answers[Math.floor(Math.random() * answers.length)];
    reply(renderQuotedCard('MAGIC 8-BALL', [`❓ Question: ${question}`, `💬 Answer: ${answer}`], undefined, '🎱'));
});

// ==================== CALCULATE ====================
cmd({
    pattern: "calc",
    alias: ["calculate"],
    desc: "🧮 Simple calculator",
    category: "tools",
    react: "🧮",
    use: ".calc 5+5",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        const expr = args.join("");
        if (!expr) return reply("❌ Use: .calc 5+5*2");
        if (!/^[0-9+\-*/().\s]+$/.test(expr)) return reply("❌ Invalid characters.");
        const result = Function(`"use strict"; return (${expr})`)();
        reply(renderQuotedCard('CALCULATOR', [`🧮 ${expr} = ${result}`], undefined, '🧮'));
    } catch (e) {
        reply("❌ Invalid expression.");
    }
});

// ==================== REVERSE TEXT ====================
cmd({
    pattern: "reverse",
    desc: "🔄 Reverse text",
    category: "tools",
    react: "🔄",
    use: ".reverse hello",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    const text = args.join(" ");
    if (!text) return reply("❌ Use: .reverse <text>");
    reply(renderQuotedCard('REVERSED TEXT', [`🔄 ${text.split('').reverse().join('')}`], undefined, '🔄'));
});

// ==================== COUNT WORDS ====================
cmd({
    pattern: "wordcount",
    alias: ["wc"],
    desc: "📊 Count words and characters",
    category: "tools",
    react: "📊",
    use: ".wordcount <text>",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    const text = args.join(" ");
    if (!text) return reply("❌ Use: .wordcount <text>");
    const words = text.trim().split(/\s+/).length;
    const chars = text.length;
    reply(renderQuotedCard('WORD COUNT', [`📝 Words: ${words}`, `🔤 Characters: ${chars}`], undefined, '📊'));
});

// ==================== UPPERCASE/LOWERCASE ====================
cmd({
    pattern: "upper",
    desc: "🔠 Convert to uppercase",
    category: "tools",
    react: "🔠",
    use: ".upper hello",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    const text = args.join(" ");
    if (!text) return reply("❌ Use: .upper <text>");
    reply(renderQuotedCard('UPPERCASE', [`🔠 ${text.toUpperCase()}`], undefined, '🔠'));
});

cmd({
    pattern: "lower",
    desc: "🔡 Convert to lowercase",
    category: "tools",
    react: "🔡",
    use: ".lower HELLO",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    const text = args.join(" ");
    if (!text) return reply("❌ Use: .lower <text>");
    reply(renderQuotedCard('LOWERCASE', [`🔡 ${text.toLowerCase()}`], undefined, '🔡'));
});

// ==================== RANDOM NUMBER ====================
cmd({
    pattern: "random",
    alias: ["rand"],
    desc: "🔢 Random number between two values",
    category: "fun",
    react: "🔢",
    use: ".random 1 100",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    const min = parseInt(args[0]) || 1;
    const max = parseInt(args[1]) || 100;
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    reply(renderQuotedCard('RANDOM NUMBER', [`🎯 Range: ${min}–${max}`, `🔢 Result: ${result}`], undefined, '🔢'));
});

// ==================== TAGME ====================
cmd({
    pattern: "tagme",
    desc: "📍 Tag yourself",
    category: "group",
    react: "📍",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    await conn.sendMessage(from, {
        text: `📍 @${m.sender.split('@')[0]} tagged themselves!`,
        mentions: [m.sender]
    }, { quoted: mek });
});

// ==================== RUNTIME ====================
let botStart = Date.now();
cmd({
    pattern: "uptime2",
    desc: "⏳ Bot runtime",
    category: "general",
    react: "⏳",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    const ms = Date.now() - botStart;
    const h = Math.floor(ms / 3600000);
    const mi = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    reply(renderQuotedCard('BOT RUNTIME', [`⏳ ${h}h ${mi}m ${s}s`, '🟢 Status: Online'], undefined, '⏳'));
});

// ==================== STICKER TO TEXT INFO ====================
cmd({
    pattern: "support",
    alias: ["help2", "contact"],
    desc: "💬 Support info",
    category: "general",
    react: "💬",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    reply(`╭═══ 💬 SUPPORT ═══⊷\n┃❃│ Owner: ${config.OWNER_NUMBER}\n┃❃│ Channel: Join for updates\n╰═════════════════⊷`);
});

// ==================== JOKE (offline list) ====================
cmd({
    pattern: "joke",
    desc: "😂 Random joke",
    category: "fun",
    react: "😂",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    const jokes = [
        "Why don't scientists trust atoms? Because they make up everything!",
        "I told my computer I needed a break, and it said no problem — it'll go to sleep.",
        "Why did the developer go broke? Because he used up all his cache!",
        "I would tell you a UDP joke, but you might not get it.",
        "Why do programmers prefer dark mode? Because light attracts bugs!",
        "How many programmers does it take to change a light bulb? None, that's a hardware problem.",
        "Why was the JavaScript developer sad? Because he didn't know how to 'null' his feelings.",
        "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'"
    ];
    reply(jokes[Math.floor(Math.random() * jokes.length)]);
});

// ==================== QUOTE ====================
cmd({
    pattern: "quote",
    desc: "💭 Random motivational quote",
    category: "fun",
    react: "💭",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    const quotes = [
        "The only way to do great work is to love what you do. — Steve Jobs",
        "Success is not final, failure is not fatal: it is the courage to continue that counts. — Winston Churchill",
        "Believe you can and you're halfway there. — Theodore Roosevelt",
        "The future belongs to those who believe in the beauty of their dreams. — Eleanor Roosevelt",
        "It does not matter how slowly you go as long as you do not stop. — Confucius",
        "Hardships often prepare ordinary people for an extraordinary destiny. — C.S. Lewis"
    ];
    reply(quotes[Math.floor(Math.random() * quotes.length)]);
});
