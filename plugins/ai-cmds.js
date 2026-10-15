const { cmd } = require('../ahmad-core');
const axios = require('axios');
const config = require('../config');
const { randomFooter } = require('../lib/menu-styles');
const { looksLikeIdentityQuestion, identityAnswer, withLanguageMatch } = require('../lib/ai-persona');
const { smartAI } = require('../lib/ai-provider');
const { plainAIResponse } = require('../lib/plain-ai-response');

const FOOTER = '> ' + randomFooter();

// smartAI() prefers optional Groq and falls back to Pollinations when needed.

// Conversational AI answers stay natural plain text. Decorative layouts
// remain available to utility/search commands elsewhere in this plugin.
function aiReply(_model, response) {
    return plainAIResponse(response);
}

// 🆕 (Bunty: "GPT ko sabse heavy banao, har language use kare, koi Ahmad/
// Bunty ke baray mein pouchay to number ke sath batain") — real per-chat
// conversation memory now, instead of the dead unused stub this used to be.
// Free proxy APIs only take a single flat prompt string (no separate
// message-array like real chat APIs), so recent turns get folded into the
// prompt text itself — capped at the last 3 exchanges so the prompt doesn't
// balloon in size or cost extra latency.
const chatHistory = {}; // from -> [{u, a}, ...] capped at 3

function buildPromptWithMemory(from, q) {
    const hist = chatHistory[from] || [];
    const historyText = hist.map(h => `User: ${h.u}\nAssistant: ${h.a}`).join('\n');
    const base = withLanguageMatch(q);
    return historyText ? `Previous conversation:\n${historyText}\n\nNew message — ${base}` : base;
}

function saveToHistory(from, q, answer) {
    if (!chatHistory[from]) chatHistory[from] = [];
    chatHistory[from].push({ u: q, a: answer });
    if (chatHistory[from].length > 3) chatHistory[from].shift();
}

// 1. gpt / ai — flagship AI command
cmd({ pattern: 'gpt', alias: ['chatgpt'], desc: 'Fast AI chat (remembers recent context, replies in your language)', category: 'ai', react: '🤖' },
async (conn, mek, m, { reply, args, quoted, from }) => {
    const q = args.join(' ') || quoted?.text;
    if (!q) return reply(`❌ Usage: .gpt <your question>\n📝 Example: .gpt What is AI?`);

    // Identity questions ("who is Ahmad/Bunty") are answered directly —
    // guaranteed correct, not dependent on a free AI proxy following
    // instructions reliably.
    if (looksLikeIdentityQuestion(q)) {
        return reply(aiReply('GPT', identityAnswer(q)));
    }

    try {
        await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
        const prompt = buildPromptWithMemory(from, q);
        const answer = await smartAI(prompt);
        saveToHistory(from, q, answer);
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
        return reply(aiReply('GPT', answer));
    } catch (e) {
        console.warn('[GPT] AI request failed:', e.message);
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
        return reply('❌ GPT service is busy; please try again shortly.');
    }
});

// 2. deepseek
cmd({ pattern: 'deepseek', alias: ['ds'], desc: 'Fast AI chat', category: 'ai', react: '🧠' },
async (conn, mek, m, { reply, args, quoted, from }) => {
    const q = args.join(' ') || quoted?.text;
    if (!q) return reply(`❌ Usage: .deepseek <your question>`);
    if (looksLikeIdentityQuestion(q)) return reply(aiReply('DEEPSEEK AI', identityAnswer(q)));
    try {
        await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
        const prompt = withLanguageMatch(q);
        const answer = await smartAI(prompt);
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
        return reply(aiReply('DEEPSEEK AI', answer));
    } catch {
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
        return reply('❌ DeepSeek service is busy; please try again shortly.');
    }
});

// 3. gemini
cmd({ pattern: 'gemini', alias: ['gem', 'google-ai'], desc: 'Fast AI chat', category: 'ai', react: '💫' },
async (conn, mek, m, { reply, args, quoted, from }) => {
    const q = args.join(' ') || quoted?.text;
    if (!q) return reply(`❌ Usage: .gemini <your question>`);
    if (looksLikeIdentityQuestion(q)) return reply(aiReply('GEMINI', identityAnswer(q)));
    try {
        await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
        const prompt = withLanguageMatch(q);
        const answer = await smartAI(prompt);
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
        return reply(aiReply('GEMINI 1.5', answer));
    } catch {
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
        return reply('❌ Gemini service is busy; please try again shortly.');
    }
});

// 4. imagine / ai image
cmd({ pattern: 'gsearch', alias: ['google', 'search'], desc: 'Search the web', category: 'ai', react: '🔍' },
async (conn, mek, m, { reply, args, from }) => {
    const q = args.join(' ');
    if (!q) return reply('❌ Usage: .gsearch <query>\n📝 Example: .gsearch best food in Pakistan');
    try {
        await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
        // Direct HTML search fallback; the old Google worker is DNS-dead.
        const res = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
            timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = String(res.data || '');
        const results = [...html.matchAll(/<a[^>]+class=\"result__a\"[^>]+href=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/a>/gi)]
            .slice(0, 5).map(m => ({ link: m[1], title: m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&') }));
        if (!results.length) throw new Error('No results');
        const lines = results.map((r,i) => `${i+1}. ${r.title}\n┃❃│    🔗 ${r.link}`);
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
        // Try preview image
        let imgSent = false;
        try {
            const ires = await axios.get(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iar=images&iax=images&ia=images`, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const im = String(ires.data||'').match(/"image":"(https?:[^"]+)"/i);
            if (im) { await conn.sendMessage(from, { image: { url: im[1].replace(/\\u002F/g,'/') }, caption: `\u0001F50D *${q}*` }, { quoted: mek }); imgSent = true; }
        } catch(e) {}
        reply(`╭═══ 🔍 GOOGLE SEARCH ═══⊷\n┃❃│ 🔎 Query: ${q}\n┃❃╭──────────────\n┃❃│ ${lines.join('\n┃❃│ ')}\n┃❃╰───────────────\n╰═════════════════⊷${imgSent?'\n📷 Preview above!':''}\n\n${FOOTER}`);
    } catch {
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
        reply(`❌ Search failed. Try: https://google.com/search?q=${encodeURIComponent(q)}`);
    }
});

// 6. currency
