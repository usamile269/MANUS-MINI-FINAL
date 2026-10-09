// ============================================================================
// lib/ai-provider.js — single shared "ask an AI" entry point.
// ----------------------------------------------------------------------------
// Previously this exact Groq -> OpenRouter -> (caller's own old proxy)
// logic was copy-pasted into plugins/ai-cmds.js AND plugins/ahmad-ai-batch1.js
// separately. Pulled out here so there's one place to update keys/models/
// order, and so the new .aiby DM auto-reply feature (main.js) can reuse the
// exact same reliable chain instead of a third copy.
//
// FIX (2026-10-09): the hardcoded GROQ_API_KEY in config.js is DEAD
// (Groq returns 401 "Invalid API Key") and OPENROUTER_API_KEY is empty, so
// every AI command (.ai / .gpt / .deepseek / .gemini) was failing with
// "Error found. Please try later." Added pollinationsReply() — a KEYLESS
// fallback (Pollinations text API, no key needed) — wired in as the last
// step of smartAI() so ALL commands recover automatically even when every
// key is dead or missing.
// ============================================================================

const axios = require('axios');
const http = require('http');
const https = require('https');
const config = require('../config');

// 🆕 SPEED FIX (Bunty: "speed maintain/tez karay wo add"): a plain axios
// call opens a fresh TCP+TLS connection every single request. keepAlive
// agents reuse the same connection across calls to the same host, which
// shaves real time off every Groq/OpenRouter request (most noticeable when
// the bot is getting hit with several AI commands close together).
const keepAliveHttp = new http.Agent({ keepAlive: true, maxSockets: 50 });
const keepAliveHttps = new https.Agent({ keepAlive: true, maxSockets: 50 });
const fastAxios = axios.create({ httpAgent: keepAliveHttp, httpsAgent: keepAliveHttps });

async function groqReply(prompt) {
    if (!config.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
    const res = await fastAxios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1024
    }, {
        headers: { Authorization: `Bearer ${config.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 15000
    });
    const answer = res.data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error('Groq: no reply');
    return answer;
}

async function openRouterReply(prompt) {
    if (!config.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');
    const res = await fastAxios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }]
    }, {
        headers: {
            Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ahmad-mini.bot',
            'X-Title': 'Ahmad Mini'
        },
        timeout: 15000
    });
    const answer = res.data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error('OpenRouter: no reply');
    return answer;
}

// Detects a raw upstream error payload (e.g. Pollinations rate-limit JSON)
// getting passed through as if it were a real answer — used by the old
// free-proxy fallbacks that live outside this file.
function looksLikeErrorPayload(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    if (!t.startsWith('{')) return false;
    try {
        const parsed = JSON.parse(t);
        return !!(parsed.error || parsed.status === 429 || parsed.deprecation_notice);
    } catch {
        return /"error"\s*:|queue full|pollinations\.ai/i.test(t);
    }
}

// 🆕 CIRCUIT BREAKER (2026-10-09): the hardcoded Groq key is dead (401).
// Retrying it on every single AI command wastes ~300ms per call for a
// request that can never succeed. After 2 consecutive 401s, skip Groq
// entirely for 10 minutes. Recovers automatically: breaker resets on any
// success and expires on its own, so a newly-added valid key starts working
// with no code change.
let groqDeadUntil = 0;
let groqAuthFailCount = 0;

async function groqReplyFast(prompt) {
    if (Date.now() < groqDeadUntil) throw new Error('Groq skipped (circuit open: known dead key)');
    try {
        const answer = await groqReply(prompt);
        groqAuthFailCount = 0;
        return answer;
    } catch (e) {
        const status = e.response?.status;
        if (status === 401 || /invalid_api_key/i.test(e.message || '')) {
            groqAuthFailCount++;
            if (groqAuthFailCount >= 2) groqDeadUntil = Date.now() + 10 * 60 * 1000;
        }
        throw e;
    }
}
// so AI commands keep working even when Groq/OpenRouter keys are dead or
// missing. Tries the OpenAI-compatible POST first (structured reply),
// then the plain GET endpoint.
// 🆕 KEYLESS FALLBACK (2026-10-09): Pollinations text API needs NO api key,
// so AI commands keep working even when Groq/OpenRouter keys are dead or
// missing. Tries the OpenAI-compatible POST first (structured reply),
// then the plain GET endpoint.
async function pollinationsReply(prompt) {
    try {
        const res = await fastAxios.post('https://text.pollinations.ai/openai', {
            model: 'openai',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1024
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 25000
        });
        const answer = res.data?.choices?.[0]?.message?.content?.trim();
        if (answer && !looksLikeErrorPayload(answer)) return answer;
    } catch (e) {
        console.log('[AI-PROVIDER] Pollinations POST failed, trying plain GET:', e.message);
    }
    const res = await fastAxios.get('https://text.pollinations.ai/' + encodeURIComponent(prompt), {
        timeout: 25000, responseType: 'text'
    });
    const answer = String(res.data || '').trim();
    if (!answer || looksLikeErrorPayload(answer)) throw new Error('Pollinations: no usable answer');
    return answer;
}

// 🆕 SPEED FIX (Bunty: "speed maintain/tez karay wo add"): RACES Groq and
// OpenRouter at the same time instead of trying them one after another —
// whichever answers first wins, so a slow-but-not-dead provider never adds
// its own latency on top of the other. Only falls through to sequential
// (old behavior) if one of the two keys isn't configured at all.
//
// 🆕 RELIABILITY FIX (2026-10-09): if every keyed provider fails (dead keys,
// missing keys, rate limits), falls through to the keyless Pollinations
// fallback instead of throwing — so .ai/.gpt/.deepseek/.gemini keep working.
async function smartAI(prompt) {
    if (config.GROQ_API_KEY && config.OPENROUTER_API_KEY) {
        try {
            return await Promise.any([groqReplyFast(prompt), openRouterReply(prompt)]);
        } catch (e) {
            console.log('[AI-PROVIDER] Groq+OpenRouter race failed:',
                e.errors?.map(x => x.message).join('; ') || e.message);
        }
    } else {
        try {
            return await groqReplyFast(prompt);
        } catch (e) {
            console.log('[AI-PROVIDER] Groq failed/skipped, trying OpenRouter:', e.message);
        }
        try {
            return await openRouterReply(prompt);
        } catch (e) {
            console.log('[AI-PROVIDER] OpenRouter failed:', e.message);
        }
    }
    console.log('[AI-PROVIDER] Keyed providers failed, trying keyless Pollinations fallback');
    return await pollinationsReply(prompt);
}

// 🆕 (.aibyahmad voice on): transcribe an incoming WhatsApp voice note via
// Groq's Whisper endpoint, then it gets treated as normal text for smartAI.
async function transcribeVoiceNote(audioBuffer) {
    if (!config.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-large-v3');
    const res = await fastAxios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
        headers: { Authorization: `Bearer ${config.GROQ_API_KEY}`, ...form.getHeaders() },
        timeout: 30000
    });
    return res.data?.text || null;
}

module.exports = { groqReply, openRouterReply, smartAI, pollinationsReply, looksLikeErrorPayload, transcribeVoiceNote };
