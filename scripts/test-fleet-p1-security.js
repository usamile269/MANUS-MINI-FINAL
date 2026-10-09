const assert = require('assert');
const fs = require('fs');

const config = fs.readFileSync('config.js', 'utf8');
const main = fs.readFileSync('main.js', 'utf8');

// --- 1. ADMIN_PANEL_KEY is env-first, hardcoded only as fallback ---
assert.match(config, /ADMIN_PANEL_KEY:\s*process\.env\.ADMIN_PANEL_KEY\s*\|\|/);
console.log('1. ADMIN_PANEL_KEY env-first: PASS');

// --- 2. Existing hardcoded fallbacks preserved (no breakage) ---
for (const key of ['MONGODB_URI', 'GROQ_API_KEY', 'CLOUDINARY_API_KEY', 'PAIR_API_KEY']) {
    assert.match(config, new RegExp(key + ':\\s*process\\.env\\.' + key + '\\s*\\|\\|'));
}
console.log('2. existing env-first fallbacks preserved: PASS');

// --- 3. Startup warning names secrets but never prints values ---
assert.match(config, /warnHardcodedSecrets/);
assert.match(config, /values are NEVER printed/i);
// warning must not interpolate any secret value
assert.doesNotMatch(config, /console\.warn\([^)]*config\.[A-Z_]+[^)]*\)/);
console.log('3. startup warning (names only, no values): PASS');

// --- 4. requireAdminOrApiKey exists and is strict ---
assert.match(main, /function requireAdminOrApiKey\(req, res, next\)/);
assert.match(main, /PAIR_API_KEY[\s\S]{0,120}ADMIN_PANEL_KEY/); // accepts either
assert.match(main, /requireAdminOrApiKey[\s\S]{0,300}status\(401\)/);
console.log('4. requireAdminOrApiKey strict 401: PASS');

// --- 5. Destructive routes are NOT public anymore ---
assert.match(main, /router\.get\('\/disconnect', requireAdminOrApiKey/);
assert.match(main, /router\.get\('\/connect-all', requireAdminOrApiKey/);
assert.doesNotMatch(main, /router\.get\('\/disconnect', requireApiKey,/);
assert.doesNotMatch(main, /router\.get\('\/connect-all', requireApiKey,/);
console.log('5. /disconnect + /connect-all secured: PASS');

// --- 6. Pairing flow unbroken: /code keeps requireApiKey (public when blank) + rate limit ---
assert.match(main, /router\.get\('\/code', requireApiKey, codeRateLimit,/);
console.log('6. /code pairing flow preserved + rate-limited: PASS');

// --- 7. Rate limiter exists with 429 ---
assert.match(main, /function rateLimit\(\{\s*windowMs,\s*max\s*\}\)/);
assert.match(main, /status\(429\)/);
assert.match(main, /codeRateLimit\s*=\s*rateLimit\(\{/);
assert.match(main, /adminRateLimit\s*=\s*rateLimit\(\{/);
console.log('7. rate limiter with 429: PASS');

// --- 8. Admin routes rate-limited, still key-protected ---
for (const r of ['/admin/site-settings', '/admin/verify-key', '/admin/overview']) {
    assert.match(main, new RegExp("router\\.post\\('" + r.replace(/\//g, '\\/') + "', adminRateLimit,"));
}
assert.match(main, /config\.ADMIN_PANEL_KEY/); // admin key checks intact
console.log('8. admin routes rate-limited + key checks intact: PASS');

console.log('\nfleet P1 security regression: ALL PASS');

// --- 9. OTP routes rate-limited (anti-spam), flow unbroken ---
assert.match(main, /router\.get\('\/update-config', otpRateLimit,/);
assert.match(main, /router\.get\('\/verify-otp', otpRateLimit,/);
assert.match(main, /otpRateLimit\s*=\s*rateLimit\(\{\s*windowMs:\s*60\s*\*\s*1000,\s*max:\s*5\s*\}\)/);
console.log('9. OTP routes rate-limited, flow preserved: PASS');
