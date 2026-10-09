const { cmd } = require('../ahmad-core');
const axios = require('axios');
const config = require('../config');
const { randomFooter } = require('../lib/menu-styles');
const { looksLikeIdentityQuestion, identityAnswer, withLanguageMatch } = require('../lib/ai-persona');
const { smartAI, pollinationsReply, looksLikeErrorPayload } = require('../lib/ai-provider');
const { plainAIResponse } = require('../lib/plain-ai-response');

const FOOTER = '> ' + randomFooter();

// 🚨 FIX (2026-10-09): the old "fallback" just re-called groqReply() with the
// SAME dead Groq key (401 Invalid API Key), so it was never a real fallback —
// every AI command died here. Now uses the KEYLESS Pollinations fallback from
// lib/ai-provider.js, which needs no API key at all.
async function reliableAIFallback(q) {
    const answer = await pollinationsReply(q);
    if (!answer || looksLikeErrorPayload(answer)) throw new Error('Pollinations fallback returned no usable answer');
    return answer;
}
// (Groq/OpenRouter chain now lives in lib/ai-provider.js — smartAI() below
// tries both before anyone falls back to the old proxy chain here.)

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
cmd({ pattern: 'gpt', alias: ['chatgpt'], desc: 'Chat with GPT AI (remembers recent context, replies in your language)', category: 'ai', react: '🤖' },
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
        try {
            const answer = await smartAI(prompt);
            saveToHistory(from, q, answer);
            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
            return reply(aiReply('GPT', answer));
        } catch (e) {
            console.log('[GPT] Groq failed/skipped, trying old chain:', e.message);
        }
        // The old workers.dev GPT proxy is dead; use the proven no-key fallback directly.
        const answer = await reliableAIFallback(prompt);
        if (!answer) throw new Error('No reply');
        saveToHistory(from, q, answer);
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
        reply(aiReply('GPT', answer));
    } catch {
        try {
            const answer = await reliableAIFallback(withLanguageMatch(q));
            if (!answer) throw new Error('No reply');
            saveToHistory(from, q, answer);
            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
            return reply(aiReply('GPT', answer));
        } catch {}
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
        reply('❌ GPT failed, try again!');
    }
});

// 2. deepseek
cmd({ pattern: 'deepseek', alias: ['ds'], desc: 'Chat with DeepSeek AI', category: 'ai', react: '🧠' },
async (conn, mek, m, { reply, args, quoted, from }) => {
    const q = args.join(' ') || quoted?.text;
    if (!q) return reply(`❌ Usage: .deepseek <your question>`);
    if (looksLikeIdentityQuestion(q)) return reply(aiReply('DEEPSEEK AI', identityAnswer(q)));
    try {
        await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
        const prompt = withLanguageMatch(q);
        try {
            const answer = await smartAI(prompt);
            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
            return reply(aiReply('DEEPSEEK AI', answer));
        } catch (e) {
            console.log('[DEEPSEEK] Groq failed, trying old chain:', e.message);
        }
        // The old workers.dev proxy is DNS-dead; use the keyless fallback directly.
        const answer = await pollinationsReply(prompt);
        if (!answer || looksLikeErrorPayload(answer)) throw new Error('No reply');
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
        reply(aiReply('DEEPSEEK AI', answer));
    } catch {
        try {
            const answer = await reliableAIFallback(withLanguageMatch(q));
            if (answer) {
                await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
                return reply(aiReply('AI (Fallback)', answer));
            }
        } catch {}
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
        reply('❌ DeepSeek failed, try again!');
    }
});

// 3. gemini
cmd({ pattern: 'gemini', alias: ['gem', 'google-ai'], desc: 'Chat with Gemini AI', category: 'ai', react: '💫' },
async (conn, mek, m, { reply, args, quoted, from }) => {
    const q = args.join(' ') || quoted?.text;
    if (!q) return reply(`❌ Usage: .gemini <your question>`);
    if (looksLikeIdentityQuestion(q)) return reply(aiReply('GEMINI', identityAnswer(q)));
    try {
        await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
        const prompt = withLanguageMatch(q);
        try {
            const answer = await smartAI(prompt);
            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
            return reply(aiReply('GEMINI 1.5', answer));
        } catch (e) {
            console.log('[GEMINI] Groq failed, trying old chain:', e.message);
        }
        // The old workers.dev Gemini proxy is dead; use the proven fallback directly.
        const answer = await reliableAIFallback(prompt);
        if (!answer) throw new Error('No reply');
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
        reply(aiReply('GEMINI 1.5', answer));
    } catch {
        try {
            const answer = await reliableAIFallback(withLanguageMatch(q));
            if (answer) {
                await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
                return reply(aiReply('AI (Fallback)', answer));
            }
        } catch {}
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
        reply('❌ Gemini failed, try again!');
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
        reply(`╭═══ 🔍 GOOGLE SEARCH ═══⊷\n┃❃│ 🔎 Query: ${q}\n┃❃╭──────────────\n┃❃│ ${lines.join('\n┃❃│ ')}\n┃❃╰───────────────\n╰═════════════════⊷\n\n${FOOTER}`);
    } catch {
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
        reply(`❌ Search failed. Try: https://google.com/search?q=${encodeURIComponent(q)}`);
    }
});

// 6. currency
