const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
assert.match(source, /const aiCommand = \/\(\?:ai\|gpt\|chatgpt\|deepseek\|gemini\|ask\)\$\/i/);
assert.match(source, /aiCommand\s*\n\s*\? \{ text: String\(text\)\.trim\(\) \}/);
assert.match(source, /contextInfo: forwardCtx/);
assert.match(source, /text: toFancyBold\(text\)/);
assert.doesNotMatch(source, /aiCommand\s*\n\s*\? \{ text: toFancyBold/);
console.log('shared AI reply formatting regression: PASS');

