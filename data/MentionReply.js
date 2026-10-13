// ============================================================================
// data/MentionReply.js — settings for the .mention feature (mention-responder).
// When someone mentions/tags the bot in a group, it auto-replies with a
// custom (or default) message. Toggle per botNumber.
// ============================================================================
const jsondb = require('../lib/mongo');

const MentionReply = jsondb.model('MentionReply');

const DEFAULT_TEXT = `ᴏɪɪ ᴄᴜᴛɪᴇᴇᴇ! 🌸🥹\nᴏᴡɴᴇʀ ꜰɪʟʜᴀᴀʟ ᴀᴠᴀɪʟᴀʙʟᴇ ɴᴀʜɪ ʜᴀɪɴ 😎\nᴍᴀɢᴀʀ ᴜɴᴋᴀ ʙᴏᴛ ʏᴀʜɪɴ ʜᴀɪ! 🧸\n亗 ᴀʜᴍᴀᴅ-ᴍᴅ ʜᴀᴢɪʀ ʜᴀɪ ᴊɪ! 🫶🏻💗`;

const DEFAULTS = {
    enabled: false,
    text: DEFAULT_TEXT
};

const settingsCache = new Map(); // botNumber -> { settings, ts }
const CACHE_TTL_MS = 15000;

async function getMentionReplySettings(botNumber) {
    try {
        const cached = settingsCache.get(botNumber);
        if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) return cached.settings;
        const doc = await MentionReply.findOne({ botNumber });
        const result = { ...DEFAULTS, ...(doc ? doc.toObject() : {}) };
        settingsCache.set(botNumber, { settings: result, ts: Date.now() });
        return result;
    } catch (e) {
        return { ...DEFAULTS };
    }
}

async function setMentionReplySettings(botNumber, update) {
    try {
        await MentionReply.findOneAndUpdate({ botNumber }, update, { upsert: true, new: true });
        const cached = settingsCache.get(botNumber);
        settingsCache.set(botNumber, { settings: { ...DEFAULTS, ...(cached ? cached.settings : {}), ...update }, ts: Date.now() });
        return true;
    } catch (e) {
        console.error('MentionReply save error:', e.message);
        return false;
    }
}

module.exports = { getMentionReplySettings, setMentionReplySettings, DEFAULT_TEXT };
