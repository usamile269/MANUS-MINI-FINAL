const jsondb = require('../lib/mongo');

// Single row, always keyed 'site'. Stored locally via jsondb — no MongoDB.
const SiteSettings = jsondb.model('SiteSettings');
const KEY = 'site';

const DEFAULTS = {
    botName: 'AHMAD-MINI',
    welcomeMsg: "Connected Successfully — you're all set!",
    welcomeVideo: '',
    channelLink: '',
    bgMusicUrl: '',
    heroTagline: 'WhatsApp Pairing',
    heroBrightness: 135,
    voiceVolume: 100,
    musicVolume: 100,
    musicUrl: '',
    // 🆕 FEATURE (Bunty: "songs popup trigger se admin panel se"): when on,
    // an attractive animated "🎵 Enable Sound" popup appears on page load
    // (only if bgMusicUrl is set) instead of the silent toggle button —
    // also doubles as the click-to-satisfy-browser-autoplay-restriction
    // gesture, so the song can actually start playing right away.
    audioPopupEnabled: false
};

async function getSiteSettings() {
    try {
        const doc = await SiteSettings.findOne({ key: KEY });
        return doc ? { ...DEFAULTS, ...doc.data } : { ...DEFAULTS };
    } catch (e) {
        return { ...DEFAULTS };
    }
}

async function setSiteSettings(update) {
    try {
        const current = await getSiteSettings();
        const merged = { ...current, ...update };
        const clamp = (value, min, max, fallback) => {
            const n = Number(value);
            return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
        };
        merged.heroBrightness = clamp(merged.heroBrightness, 30, 250, 135);
        merged.voiceVolume = clamp(merged.voiceVolume, 0, 100, 100);
        merged.musicVolume = clamp(merged.musicVolume, 0, 100, 100);
        if (Object.prototype.hasOwnProperty.call(update, 'musicUrl') && !Object.prototype.hasOwnProperty.call(update, 'bgMusicUrl')) merged.bgMusicUrl = String(update.musicUrl || '');
        if (Object.prototype.hasOwnProperty.call(update, 'bgMusicUrl') && !Object.prototype.hasOwnProperty.call(update, 'musicUrl')) merged.musicUrl = String(update.bgMusicUrl || '');
        await SiteSettings.findOneAndUpdate({ key: KEY }, { data: merged }, { upsert: true });
        return merged;
    } catch (e) {
        console.error('❌ Error saving site settings:', e.message);
        return null;
    }
}

module.exports = { getSiteSettings, setSiteSettings, DEFAULTS };
