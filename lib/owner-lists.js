// Shared owner-managed allow-list state.
// This module is intentionally small so owner commands and the main dispatcher
// use the same Set instance without importing the owner plugin from main.js.
const whitelist = new Set();

function normalizeAllowedJid(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.endsWith('@g.us') || raw.endsWith('@s.whatsapp.net') || raw.endsWith('@lid') || raw.endsWith('@newsletter')) {
        return raw;
    }
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? `${digits}@s.whatsapp.net` : raw;
}

function isWhitelisted(...values) {
    return values.some(value => {
        const normalized = normalizeAllowedJid(value);
        return normalized && whitelist.has(normalized);
    });
}

module.exports = { whitelist, normalizeAllowedJid, isWhitelisted };
