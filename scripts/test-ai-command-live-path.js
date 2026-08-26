const assert = require('node:assert/strict');
const Module = require('node:module');

const registrations = [];
const state = { mode: 'primary', fallbackCalls: 0 };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === '../ahmad-core') return { cmd: (meta, handler) => registrations.push({ meta, handler }) };
    if (request === 'axios') return { get: async () => ({ data: Buffer.from('unused') }) };
    if (request === '../config') return { BOT_NAME: 'MANUS MINI' };
    if (request === '../lib/menu-styles') return { randomFooter: () => 'SHOULD NOT APPEAR' };
    if (request === '../lib/ai-persona') return {
        looksLikeIdentityQuestion: value => value === 'who are you',
        identityAnswer: () => 'I am Ahmad Mini.',
    };
    if (request === '../lib/ai-provider') return {
        smartAI: async () => {
            if (state.mode === 'fallback') throw new Error('simulated primary failure');
            return 'Primary plain answer';
        },
        groqReply: async () => { state.fallbackCalls++; return 'Fallback plain answer'; },
        looksLikeErrorPayload: () => false
    };
    return originalLoad.call(this, request, parent, isMain);
};

require('../plugins/felix-apis');
Module._load = originalLoad;

const registration = registrations.find(item => item.meta.pattern === 'ai');
assert.ok(registration, 'missing active .ai command');

async function invoke(query) {
    const reactions = [];
    const replies = [];
    const conn = { sendMessage: async (_from, message) => { if (message.react) reactions.push(message.react.text); } };
    await registration.handler(conn, { key: 'message-key' }, { key: 'message-key' }, {
        from: 'chat@s.whatsapp.net', args: query.split(' '), reply: value => { replies.push(value); return value; }
    });
    return { reactions, replies };
}

(async () => {
    const identity = await invoke('who are you');
    assert.deepEqual(identity.replies, ['I am Ahmad Mini.']);
    assert.deepEqual(identity.reactions, []);

    const primary = await invoke('hello');
    assert.deepEqual(primary.replies, ['Primary plain answer']);
    assert.deepEqual(primary.reactions, ['🤖']);

    state.mode = 'fallback';
    const fallback = await invoke('hello');
    assert.deepEqual(fallback.replies, ['Fallback plain answer']);
    assert.deepEqual(fallback.reactions, ['🤖']);
    assert.equal(state.fallbackCalls, 1);

    for (const reply of [...identity.replies, ...primary.replies, ...fallback.replies]) {
        assert.doesNotMatch(reply, /[╭╰┃]|╭═══|OBSIDIAN LUXE/i);
    }
    console.log('active .ai runtime regression: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

