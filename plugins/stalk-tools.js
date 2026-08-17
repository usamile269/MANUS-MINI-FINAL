// ============================================================================
// plugins/stalk-tools.js — OSINT-style lookup commands, ported from AURA_MD
// (drenox.js) into ahmad-mini's plugin format.
//
// Ported: ghstalk (GitHub), igstalk (Instagram), tiktokstalk (TikTok), ffstalk
// (Free Fire game ID).
//
// Change from the AURA_MD original: AURA_MD's tiktokstalk went through a
// Cloudflare-turnstile-bypass call against a random third-party site
// (anonymous-viewer.com) before hitting its actual API — fragile and not
// something worth carrying over. Swapped it for the same NexOracle endpoint
// AURA_MD's own tiktokstalk2 used, which ahmad-mini already relies on
// elsewhere (see plugins/apk.js, plugins/nexoracle-downloaders.js), so it's
// one less API surface to trust.
// ============================================================================

const { cmd } = require('../ahmad-core');
const axios = require('axios');
const { randomFooter } = require('../lib/menu-styles');

const NEX_BASE = 'https://api.nexoracle.com';
const NEX_KEY = 'free_key@maher_apis';
const FOOTER = () => `\n\n> ${randomFooter()}`;

function normalizeTikTokUsername(input) {
    return String(input || '').trim()
        .replace(/^https?:\/\/(?:www\.)?tiktok\.com\/@?/i, '')
        .replace(/^@/, '')
        .split(/[/?#\s]/)[0]
        .trim();
}

async function fetchTikTokWebProfile(username) {
    const { data: html } = await axios.get(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
        timeout: 20000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('TikTok profile payload missing');
    const payload = JSON.parse(match[1]);
    const detail = payload?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
    const user = detail?.user;
    const stats = detail?.statsV2 || detail?.stats || {};
    if (!user?.uniqueId) throw new Error('TikTok user not found');
    return { ...user, ...stats, heartCount: stats.heartCount ?? stats.heart, verified: Boolean(user.verified) };
}

// ==================== GITHUB STALK ====================
cmd({
    pattern: 'ghstalk',
    alias: ['githubstalk'],
    desc: '💻 Look up a GitHub user',
    category: 'osint',
    use: '.ghstalk <username>',
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    if (!q) return reply(`💻 *GitHub Stalk*\n\nExample: .ghstalk nexoracle${FOOTER()}`);
    try {
        const { data } = await axios.get(`${NEX_BASE}/stalking/github-user`, {
            params: { apikey: NEX_KEY, user: q },
            timeout: 20000
        });
        const u = data.result;
        if (!u) return reply(`❌ User not found${FOOTER()}`);

        const caption = `╭━━〔 💻 GITHUB STALK 〕━━┈⊷
┃
┃ 👤 Username: ${u.login || 'N/A'}
┃ 📝 Name: ${u.name || 'N/A'}
┃ 👥 Followers: ${u.followers ?? 'N/A'}
┃ 👤 Following: ${u.following ?? 'N/A'}
┃ 📦 Repos: ${u.public_repos ?? 'N/A'}
┃ 📄 Bio: ${u.bio || 'N/A'}
┃ 🏢 Company: ${u.company || 'N/A'}
┃ 📍 Location: ${u.location || 'N/A'}
┃ 🔗 Profile: ${u.html_url || 'N/A'}
┃
╰━━━━━━━━━━━━━━━┈⊷${FOOTER()}`;

        if (u.avatar_url) {
            await conn.sendMessage(from, { image: { url: u.avatar_url }, caption }, { quoted: mek });
        } else {
            reply(caption);
        }
    } catch (e) {
        console.log('[GHSTALK] error:', e.message);
        reply(`❌ User not found or API error${FOOTER()}`);
    }
});

// ==================== INSTAGRAM STALK ====================
cmd({
    pattern: 'igstalk',
    alias: ['instastalk'],
    desc: '📸 Look up an Instagram profile',
    category: 'osint',
    use: '.igstalk <username>',
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    if (!q) return reply(`📸 *Instagram Stalk*\n\nExample: .igstalk username${FOOTER()}`);
    try {
        const { data } = await axios.get('https://api.popcat.xyz/instagram', {
            params: { user: q },
            timeout: 20000
        });
        if (!data || !data.username) return reply(`❌ User not found${FOOTER()}`);

        const caption = `╭━━〔 📸 INSTAGRAM STALK 〕━━┈⊷
┃
┃ 👤 Username: ${data.username}
┃ 📝 Name: ${data.full_name || 'N/A'}
┃ 👥 Followers: ${data.followers ?? 'N/A'}
┃ 👤 Following: ${data.following ?? 'N/A'}
┃ 📸 Posts: ${data.posts ?? 'N/A'}
┃ 📄 Bio: ${data.biography || 'N/A'}
┃
╰━━━━━━━━━━━━━━━┈⊷${FOOTER()}`;

        if (data.profile_pic) {
            await conn.sendMessage(from, { image: { url: data.profile_pic }, caption }, { quoted: mek });
        } else {
            reply(caption);
        }
    } catch (e) {
        console.log('[IGSTALK] error:', e.message);
        reply(`❌ User not found or API error${FOOTER()}`);
    }
});

// ==================== TIKTOK STALK ====================
// Public, no-key implementation. TikTok's official Display API requires an
// OAuth user access token, so it is not suitable for a zero-variable bot.
// The public profile page contains the same public profile fields and avoids
// the old NexOracle/TikWM endpoints that were returning 404/Cloudflare 403.
cmd({
    pattern: 'tiktokstalk',
    alias: ['ttstalk'],
    desc: '🎵 Look up a public TikTok profile',
    category: 'osint',
    use: '.tiktokstalk <username or profile URL>',
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    const username = normalizeTikTokUsername(q);
    if (!username) return reply(`🎵 *TikTok Stalk*\n\nExample: .tiktokstalk bunty_081${FOOTER()}`);

    try {
        const u = await fetchTikTokWebProfile(username);
        const stats = u.stats || {};
        const caption = `╭━━〔 🎵 TIKTOK STALK 〕━━┈⊷
┃
┃ 👤 Username: ${u.uniqueId || username}
┃ 📝 Nickname: ${u.nickname || 'N/A'}
┃ 👥 Followers: ${u.followerCount ?? stats.followerCount ?? 'N/A'}
┃ 👤 Following: ${u.followingCount ?? stats.followingCount ?? 'N/A'}
┃ ❤️ Likes: ${u.heartCount ?? stats.heartCount ?? stats.heart ?? 'N/A'}
┃ 🎥 Videos: ${u.videoCount ?? stats.videoCount ?? 'N/A'}
┃ 📄 Bio: ${u.signature || 'N/A'}
┃ ✅ Verified: ${u.verified ? 'Yes' : 'No'}
┃
╰━━━━━━━━━━━━━━━┈⊷${FOOTER()}`;
        const avatar = u.avatarLarger || u.avatarMedium || u.avatarThumb;
        if (avatar) await conn.sendMessage(from, { image: { url: avatar }, caption }, { quoted: mek });
        else await conn.sendMessage(from, { text: caption }, { quoted: mek });
    } catch (e) {
        console.log('[TIKTOKSTALK] public profile failed:', e.message);
        await conn.sendMessage(from, { text: `❌ Public TikTok profile not found or temporarily unavailable.${FOOTER()}` }, { quoted: mek });
    }
});

// ==================== FREE FIRE STALK ====================
cmd({
    pattern: 'ffstalk',
    desc: '🎮 Look up a Free Fire player ID',
    category: 'osint',
    use: '.ffstalk <player id>',
    filename: __filename
}, async (conn, mek, m, { q, reply }) => {
    if (!q) return reply(`🎮 *Free Fire Stalk*\n\nExample: .ffstalk 1234567890${FOOTER()}`);
    try {
        const { data } = await axios.get(`https://api.lolhuman.xyz/api/freefire/${encodeURIComponent(q)}`, {
            params: { apikey: 'GataDios' },
            timeout: 20000
        });
        const r = data && data.result;
        if (!r) return reply(`❌ Player not found or invalid ID${FOOTER()}`);

        reply(`🎮 *FREE FIRE PROFILE*\n\nName: ${r.nickname || 'N/A'}\nID: ${q}\nRegion: ${r.region || 'N/A'}${FOOTER()}`);
    } catch (e) {
        console.log('[FFSTALK] error:', e.message);
        reply(`❌ Player not found or invalid ID${FOOTER()}\n\n⚠️ Note: this uses a shared free API key (lolhuman.xyz) that may be rate-limited or dead — if it keeps failing that's why.`);
    }
});
