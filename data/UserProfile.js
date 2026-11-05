// ============================================================================
// data/UserProfile.js — per-person profile for .aiauto personalization.
// One small doc per WhatsApp sender (keyed by number digits): name + free
// text "about" details. The AI uses it to reply like a real friend who
// remembers you — name, facts, and (via the in-memory chat history in
// main.js) recent conversation. No per-message DB writes: the profile is
// read once per DM (15s cache, same pattern as data/AIAutoReply.js) and
// written only when the person changes it with .setname/.setabout.
// `.forgetme` deletes the doc entirely.
// ============================================================================
const jsondb = require('../lib/mongo');

const UserProfile = jsondb.model('UserProfile');

const profileCache = new Map(); // number -> { profile, ts }
const CACHE_TTL_MS = 15000;

function normalizeNumber(raw) {
    return String(raw || '').replace(/[^0-9]/g, '');
}

async function getUserProfile(rawNumber) {
    const number = normalizeNumber(rawNumber);
    if (!number) return null;
    const cached = profileCache.get(number);
    try {
        if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) return cached.profile;
        const doc = await UserProfile.findOne({ number });
        const profile = doc ? doc.toObject() : null;
        profileCache.set(number, { profile, ts: Date.now() });
        return profile;
    } catch (e) {
        return cached?.profile || null;
    }
}

async function setUserProfile(rawNumber, update) {
    const number = normalizeNumber(rawNumber);
    if (!number) return false;
    try {
        await UserProfile.findOneAndUpdate({ number }, { ...update, number, updatedAt: new Date() }, { upsert: true, new: true });
        const cached = profileCache.get(number);
        profileCache.set(number, { profile: { ...(cached ? cached.profile : {}), ...update, number }, ts: Date.now() });
        return true;
    } catch (e) {
        console.error('[UserProfile] Save failed:', e.message);
        return false;
    }
}

async function deleteUserProfile(rawNumber) {
    const number = normalizeNumber(rawNumber);
    if (!number) return false;
    try {
        await UserProfile.deleteOne({ number });
        profileCache.delete(number);
        return true;
    } catch (e) {
        console.error('[UserProfile] Delete failed:', e.message);
        return false;
    }
}

module.exports = { getUserProfile, setUserProfile, deleteUserProfile, normalizeNumber };
