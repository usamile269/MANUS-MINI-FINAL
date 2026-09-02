const assert = require('node:assert/strict');
const Module = require('node:module');
const registrations = [];
const state = { mode: 'success', calls: 0 };
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
    if (request === '../ahmad-core') return { cmd: (meta, handler) => registrations.push({ meta, handler }) };
    if (request === 'axios') return { get: async () => ({ data: {} }) };
    if (request === '../lib/menu-styles') return {
        randomFooter: () => 'FOOTER',
        renderError: value => `ERROR: ${value}`
    };
    if (request === '../lib/ai-provider') return {
        smartAI: async prompt => {
            state.calls++;
            if (state.mode === 'failure') throw new Error('simulated provider failure');
            return `Answer for ${prompt}`;
        }
    };
    return originalLoad.call(this, request, parent, isMain);
};

require('../plugins/rbots-apis');
Module._load = originalLoad;

const registration = registrations.find(item => item.meta.pattern === 'gpt5');
assert.ok(registration, 'missing .gpt5 command');

async function invoke(args) {
    const replies = [];
    await registration.handler({}, {}, {}, {
        args,
        reply: value => { replies.push(value); return value; }
    });
    return replies;
}

(async () => {
    assert.deepEqual(await invoke(['how', 'are', 'you']), ['Answer for how are you\n\n> FOOTER']);
    assert.equal(state.calls, 1);
    state.mode = 'failure';
    assert.deepEqual(await invoke(['try', 'again']), ['ERROR: AI request failed. Try again later.']);
    assert.equal(state.calls, 2);
    assert.deepEqual(await invoke([]), ['ERROR: Give me something to ask. Use: .gpt5 <question>']);
    assert.equal(state.calls, 2);
    console.log('.gpt5 provider regression: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

process.on('exit', () => { Module._load = originalLoad; });
