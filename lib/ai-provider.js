// ============================================================================
// lib/ai-provider.js — single shared "ask an AI" entry point.
// ----------------------------------------------------------------------------
// Previously this exact Groq -> OpenRouter -> (caller's own old proxy)
// logic was copy-pasted into plugins/ai-cmds.js AND plugins/ahmad-ai-batch1.js
// separately. Pulled out here so there's one place to update keys/models/
// order, and so the new .aiby DM auto-reply feature (main.js) can reuse the
// exact same reliable chain instead of a third copy.
//
// Text AI does not require a Railway secret: it uses the public Pollinations
// text endpoint by default, with optional Groq acceleration when configured.
// The legacy Pollinations POST endpoint was smoke-tested without a key on
// 2026-10-15; it may still rate-limit or change independently of this repo.
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
        // SPEED (2026-10-13): gpt-oss-120b is a 120B giant — slow. llama-3.1-8b-instant
        // is Groq's fastest production model; same API, much lower latency.
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 512
    }, {
        headers: { Authorization: `Bearer ${config.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 8000
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

async function groqReplyFast(prompt) {
    return groqReply(prompt);
}

// Keyless legacy POST endpoint. Its GET variant now returns 402, so keep this
// to one bounded request rather than spending another timeout on a dead path.
async function pollinationsReply(prompt) {
    const res = await fastAxios.post('https://text.pollinations.ai/openai', {
        model: 'openai-fast',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512
    }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
    });
    const answer = res.data?.choices?.[0]?.message?.content?.trim();
    if (!answer || looksLikeErrorPayload(answer)) throw new Error('Pollinations: no usable answer');
    return answer;
}

async function smartAI(prompt) {
    // Missing Railway GROQ_API_KEY is normal: skip Groq and use the keyless
    // provider immediately. If Groq is configured but fails, fall back quickly.
    if (config.GROQ_API_KEY) {
        try {
            return await groqReplyFast(prompt);
        } catch (e) {
            console.warn('[AI-PROVIDER] Groq failed; using keyless fallback:', e.message);
        }
    }
    return pollinationsReply(prompt);
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
