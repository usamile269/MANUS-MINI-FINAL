#!/usr/bin/env node
// ============================================================================
// scripts/check-plugins.js — pre-deploy health check
// ----------------------------------------------------------------------------
// Requested by Bunty after a real incident: data/GroupSettings.js had a
// broken require('./menu-styles') (wrong relative path — the file actually
// lives in ../lib/menu-styles). Because plugins load in a try/catch loop in
// main.js, this didn't crash the whole bot — it just silently killed EVERY
// command in plugins/warn-welcome-system.js and plugins/group-extra.js
// (.antilink, .warn, .kick, .rules, .welcome, .goodbye, etc all "vanished"
// with zero error visible from WhatsApp — only in the Railway/Panel console
// logs, which nobody checks unless something's already broken).
//
// Run this BEFORE every deploy:   node scripts/check-plugins.js
// Exit code 0 = all clear. Exit code 1 = something's broken, DO NOT deploy.
//
// Two checks, in order:
//   1. STATIC — scans every .js file in the project for require('./x') /
//      require('../x') calls and verifies the target file actually exists.
//      Catches typo'd/wrong paths instantly, no dependencies needed.
//   2. LIVE — actually requires() every file in plugins/ one at a time,
//      exactly like main.js's plugin loader does, and reports which ones
//      throw and why. This is the same check that would have caught the
//      GroupSettings.js bug immediately, before it ever reached production.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let hasErrors = false;

console.log('🔎 Ahmad-MD pre-deploy health check\n');

// ─────────────────────────────────────────────────────────────
// 1. STATIC CHECK — every require('./x') / require('../x') path resolves
// ─────────────────────────────────────────────────────────────
console.log('── Step 1: checking all relative require() paths ──');

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, files);
        else if (entry.name.endsWith('.js')) files.push(full);
    }
    return files;
}

const allJsFiles = walk(ROOT).filter(f => f !== __filename);
const requireRe = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
let staticBroken = 0;

for (const file of allJsFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    let match;
    while ((match = requireRe.exec(content))) {
        const relPath = match[1];
        const resolved = path.resolve(path.dirname(file), relPath);
        const candidates = [resolved, resolved + '.js', path.join(resolved, 'index.js')];
        if (!candidates.some(c => fs.existsSync(c))) {
            console.log(`  ❌ ${path.relative(ROOT, file)}`);
            console.log(`     require('${relPath}') → does not resolve to any file`);
            staticBroken++;
            hasErrors = true;
        }
    }
}

if (staticBroken === 0) {
    console.log(`  ✅ All relative require() paths resolve (${allJsFiles.length} files scanned)`);
} else {
    console.log(`  ⚠️  ${staticBroken} broken require path(s) found above`);
}

// ─────────────────────────────────────────────────────────────
// 2. LIVE CHECK — actually require() every plugin, same as main.js does
// ─────────────────────────────────────────────────────────────
console.log('\n── Step 2: actually loading every plugins/*.js file ──');

const pluginsDir = path.join(ROOT, 'plugins');
if (!fs.existsSync(pluginsDir)) {
    console.log('  ⚠️  plugins/ directory not found, skipping.');
} else {
    const pluginFiles = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
    let loadFailed = 0;
    for (const file of pluginFiles) {
        try {
            require(path.join(pluginsDir, file));
        } catch (e) {
            console.log(`  ❌ ${file}`);
            console.log(`     ${e.message}`);
            loadFailed++;
            hasErrors = true;
        }
    }
    if (loadFailed === 0) {
        console.log(`  ✅ All ${pluginFiles.length} plugin files loaded successfully`);
    } else {
        console.log(`  ⚠️  ${loadFailed} plugin file(s) failed to load — every command inside them is DEAD until fixed`);
    }
}

// ─────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
if (hasErrors) {
    console.log('❌ Health check FAILED — fix the errors above before deploying.');
    process.exit(1);
} else {
    console.log('✅ Health check PASSED — safe to deploy.');
    process.exit(0);
}
