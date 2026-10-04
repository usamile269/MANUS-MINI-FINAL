// Lightweight per-process WhatsApp presence cache used by .gcinfo.
// Presence is ephemeral and intentionally not persisted.
const groups = new Map();
const PRESENCE_TTL_MS = 5 * 60 * 1000;

function normalize(jid) {
    return String(jid || '').replace(/:.*(?=@)/, '');
}

function recordPresence(groupId, presences = {}) {
    if (!String(groupId || '').endsWith('@g.us')) return;
    const now = Date.now();
    const group = groups.get(groupId) || new Map();
    for (const [jid, info] of Object.entries(presences || {})) {
        const id = normalize(jid);
        const state = info?.lastKnownPresence || info?.presence || 'unavailable';
        if (state === 'unavailable' || state === 'offline') group.delete(id);
        else group.set(id, { state, seenAt: now });
    }
    groups.set(groupId, group);
}

function getOnlineIds(groupId, participantIds = []) {
    const group = groups.get(groupId);
    if (!group) return { available: false, ids: [] };
    const now = Date.now();
    const allowed = new Set(participantIds.map(normalize));
    const ids = [];
    for (const [jid, entry] of group) {
        if (now - entry.seenAt > PRESENCE_TTL_MS) { group.delete(jid); continue; }
        if (allowed.has(jid) && ['available', 'composing', 'recording', 'paused'].includes(entry.state)) ids.push(jid);
    }
    return { available: true, ids };
}

module.exports = { recordPresence, getOnlineIds };
