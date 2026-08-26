const assert = require('node:assert/strict');
const Module = require('node:module');

const registrations = [];
const state = { smartMode: 'success', axiosCalls: 0, groqCalls: 0 };
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
    if (request === '../ahmad-core') return { cmd: (meta, handler) => registrations.push({ meta, handler }) };
    if (request === 'axios') return { get: async () => { state.axiosCalls++; return { data: { response: 'DeepSeek fallback answer' } }; } };
    if (request === '../config') return {};
    if (request === '../lib/menu-styles') return { randomFooter: () => 'SHOULD NOT APPEAR' };
    if (request === '../lib/ai-persona') return {
        looksLikeIdentityQuestion: () => false,
        identityAnswer: () => 'identity',
        withLanguageMatch: value => value
    };
    if (request === '../lib/ai-provider') return {
        smartAI: async () => {
            if (state.smartMode === 'failure') throw new Error('simulated provider failure');
            return 'Primary AI answer';
        },
        groqReply: async () => { state.groqCalls++; return 'Groq fallback answer'; },
        looksLikeErrorPayload: () => false
    };
    return originalLoad.call(this, request, parent, isMain);
};

require('../plugins/ai-cmds');
Module._load = originalLoad;

function handlerFor(pattern) {
    const registration = registrations.find(item => item.meta.pattern === pattern);
    assert.ok(registration, `missing ${pattern} command`);
    return registration.handler;
}

async function invoke(handler) {
    const reactions = [];
    const replies = [];
    const conn = { sendMessage: async (_from, message) => { if (message.react) reactions.push(message.react.text); } };
    await handler(conn, { key: 'message-key' }, { key: 'message-key' }, {
        reply: value => { replies.push(value); return value; },
        args: ['hello'], quoted: null, from: 'chat@s.whatsapp.net'
    });
    return { reactions, replies };
}

(async () => {
    const gpt = await invoke(handlerFor('gpt'));
    assert.deepEqual(gpt.reactions, ['⏳', '✅']);
    assert.deepEqual(gpt.replies, ['Primary AI answer']);

    state.smartMode = 'failure';
    const deepseek = await invoke(handlerFor('deepseek'));
    assert.deepEqual(deepseek.reactions, ['⏳', '✅']);
    assert.deepEqual(deepseek.replies, ['DeepSeek fallback answer']);
    assert.equal(state.axiosCalls, 1);

    const gemini = await invoke(handlerFor('gemini'));
    assert.deepEqual(gemini.reactions, ['⏳', '✅']);
    assert.deepEqual(gemini.replies, ['Groq fallback answer']);
    assert.equal(state.groqCalls, 1);

    for (const reply of [...gpt.replies, ...deepseek.replies, ...gemini.replies]) {
        assert.doesNotMatch(reply, /[╭╰┃]|GPT|OBSIDIAN|AHMAD MINI/i);
    }
    console.log('AI command runtime regression: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

