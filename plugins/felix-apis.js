const { cmd } = require('../ahmad-core');
const axios = require('axios');
const config = require('../config');
const { randomFooter } = require('../lib/menu-styles');
const { looksLikeIdentityQuestion, identityAnswer } = require('../lib/ai-persona');
const { smartAI, pollinationsReply, looksLikeErrorPayload } = require('../lib/ai-provider');
const { plainAIResponse } = require('../lib/plain-ai-response');

const BASE = "https://felix-rdx-unlimited-free-apis.vercel.app/api/v1/api";

async function fetchBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.tiktok.com/'
        }
    });
    return Buffer.from(res.data);
}

const channelContext = {
    forwardingScore: 999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: "120363415558267602@newsletter",
        newsletterName: config.CHANNEL_METADATA_NAME,
        serverMessageId: 2,
    },
};

// ==================== RANDOM QUOTE (API) ====================
cmd({
    pattern: "rquote",
    desc: "💭 Random quote from API",
    category: "fun",
    react: "💭",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        const res = await axios.get(`${BASE}/randomquotes`, { timeout: 15000 });
        if (res.data && res.data.quotes) {
            reply(`╭═══ 💭 QUOTE ═══⊷\n┃❃│ ${res.data.quotes}\n╰═════════════════⊷\n\n> ${randomFooter()}`);
        } else {
            reply("❌ Failed to fetch quote.");
        }
    } catch (e) {
        reply("❌ Error found. Please try later.");
    }
});

// ==================== COSPLAY IMAGE ====================
cmd({
    pattern: "cosplay",
    desc: "🎭 Random cosplay image",
    category: "fun",
    react: "🎭",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        await conn.sendMessage(from, {
            image: { url: `${BASE}/cosplay` },
            caption: `╭═══ 🎭 COSPLAY ═══⊷\n╰═════════════════⊷\n\n> ${randomFooter()}`,
            contextInfo: channelContext
        }, { quoted: mek });
    } catch (e) {
        reply("❌ Error found. Please try later.");
    }
});

// ==================== RANDOM IMAGE ====================
cmd({
    pattern: "randomimg",
    alias: ["randimg"],
    desc: "🖼️ Random image",
    category: "fun",
    react: "🖼️",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        const res = await axios.get(`${BASE}/randomimage`, { timeout: 15000 });
        if (res.data && res.data.status && res.data.responce) {
            await conn.sendMessage(from, {
                image: { url: res.data.responce },
                caption: `╭═══ 🖼️ RANDOM IMAGE ═══⊷\n╰═════════════════⊷\n\n> ${randomFooter()}`,
                contextInfo: channelContext
            }, { quoted: mek });
        } else {
            reply("❌ Failed to fetch image.");
        }
    } catch (e) {
        reply("❌ Error found. Please try later.");
    }
});

// ==================== WAIFU ====================
cmd({
    pattern: "waifu",
    desc: "👘 Random waifu image",
    category: "fun",
    react: "👘",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    // 🚨 FIX (Spidy: ".waifu — Error found. Please try later."):
    // Multi-provider fallback with byte-download verification.
    // Previous issues: waifu.pics ENOTFOUND (intermittent), nekos.best 403
    // on Railway IPs, felix 402 dead. This tries each provider in order,
    // downloads actual image bytes (not just URL), verifies valid image
    // data, and sends Buffer to WhatsApp for maximum reliability.
    const UA = { 'User-Agent': 'AhmadMiniBot (https://github.com/usamile269/MANUS-MINI-FINAL)' };

    // Each provider: {name, apiUrl, extractUrl(json)->imageUrl}
    const providers = [
        {
            name: 'waifu.pics',
            apiUrl: 'https://api.waifu.pics/sfw/waifu',
            extract: (d) => d?.url
        },
        {
            name: 'nekos.best',
            apiUrl: 'https://nekos.best/api/v2/waifu',
            extract: (d) => d?.results?.[0]?.url
        },
        {
            name: 'waifu.im',
            apiUrl: 'https://api.waifu.im/search/?included_tags=waifu',
            extract: (d) => d?.images?.[0]?.url
        }
    ];

    // Verify buffer is actually an image (not HTML/JSON error page)
    function isValidImage(buf) {
        if (!buf || buf.length < 100) return false;
        // JPEG: FF D8 FF | PNG: 89 50 4E 47 | GIF: 47 49 46 | WebP: 52 49 46 46
        const h = buf.slice(0, 4);
        return (h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) ||
               (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47) ||
               (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) ||
               (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46);
    }

    let imageBuffer = null;
    const errors = [];

    for (const p of providers) {
        try {
            // Step 1: Get image URL from provider API
            const { data, status } = await axios.get(p.apiUrl, {
                timeout: 10000, family: 4, headers: UA,
                validateStatus: (s) => s === 200
            });
            const imgUrl = p.extract(data);
            if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) {
                throw new Error('no valid image URL in response');
            }
            // Step 2: Download actual image bytes
            const imgRes = await axios.get(imgUrl, {
                responseType: 'arraybuffer', timeout: 20000, family: 4,
                headers: UA, maxContentLength: 15 * 1024 * 1024
            });
            const buf = Buffer.from(imgRes.data);
            if (!isValidImage(buf)) throw new Error('downloaded data is not a valid image');
            imageBuffer = buf;
            console.log(`[WAIFU] success via ${p.name} (${(buf.length/1024).toFixed(0)}KB)`);
            break;
        } catch (e) {
            const msg = `${p.name}: ${e.message}`;
            errors.push(msg);
            console.log('[WAIFU] provider failed:', msg);
        }
    }

    if (!imageBuffer) {
        console.log('[WAIFU] all providers failed:', errors.join(' | '));
        return reply("❌ Waifu images temporarily unavailable. Please try again later! 🙏");
    }

    try {
        await conn.sendMessage(from, {
            image: imageBuffer,
            caption: `╭═══ 👘 WAIFU ═══⊷\n╰═════════════════⊷\n\n> ${randomFooter()}`,
            contextInfo: channelContext
        }, { quoted: mek });
    } catch (e) {
        console.log('[WAIFU] send failed:', e.message);
        reply("❌ Error sending image. Please try later.");
    }
});

// ==================== TEXT TO IMAGE (AI) ====================
// 🚨 FIX (".imagine error a raha" round 2): Pollinations migrated to a single
// unified endpoint (gen.pollinations.ai) — the old image.pollinations.ai host
// this used to hit alone has become slow/unreliable since the migration,
// which is exactly why every prompt was failing with the generic "Error
// found" message. Now tries the NEW host first, and only falls back to the
// old host if that fails, instead of relying on the old host alone.
function pollinationsUrls(query) {
    const seed = Math.floor(Math.random() * 1000000);
    const encoded = encodeURIComponent(query);
    return [
        `https://gen.pollinations.ai/image/${encoded}?width=1024&height=1024&seed=${seed}&nologo=true`,
        `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&seed=${seed}&nologo=true`
    ];
}

cmd({
    pattern: "imagine",
    alias: ["txt2img", "aiimg", "image", "photo"],
    desc: "🎨 Generate image from text",
    category: "fun",
    react: "🎨",
    use: ".imagine <description>",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        const query = args.join(" ");
        if (!query) return reply("❌ Use: .imagine <description>\nExample: .imagine naruto from naruto");

        await conn.sendMessage(from, { react: { text: "🎨", key: m.key } });

        const urls = pollinationsUrls(query);
        let imgBuffer = null;
        let lastErr = null;
        // Try each host in order — first one that returns real image bytes wins.
        for (const imgUrl of urls) {
            try {
                const imgRes = await axios.get(imgUrl, {
                    responseType: 'arraybuffer',
                    timeout: 90000,
                    // 🚨 FIX: bare axios requests (no User-Agent/Accept) get
                    // blocked/throttled by some hosts sitting in front of
                    // Pollinations — same root cause class as the earlier
                    // ".setbotaudio download" fix. Sending real browser-style
                    // headers here too.
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'image/*,*/*;q=0.8'
                    },
                    validateStatus: () => true // inspect non-2xx ourselves instead of throwing generically
                });
                if (imgRes.status < 200 || imgRes.status >= 300) {
                    lastErr = new Error(`HTTP ${imgRes.status} from ${new URL(imgUrl).hostname}`);
                    console.log(`[IMAGINE] ${lastErr.message}`);
                    continue;
                }
                const buf = Buffer.from(imgRes.data);
                // Guard against an error page/JSON body coming back with a
                // 200 status (Pollinations does this under load) — a real
                // image is always way bigger than a few hundred bytes.
                if (buf.length > 2000) { imgBuffer = buf; break; }
                lastErr = new Error(`Response too small (${buf.length} bytes) — not a real image`);
                console.log(`[IMAGINE] ${lastErr.message} from ${new URL(imgUrl).hostname}`);
            } catch (e) {
                lastErr = e;
                console.log(`[IMAGINE] request to ${imgUrl} failed:`, e.message);
            }
        }

        if (!imgBuffer) throw lastErr || new Error('No image returned');

        await conn.sendMessage(from, {
            image: imgBuffer,
            caption: `╭═══ 🎨 AI IMAGE ═══⊷\n┃❃│ Prompt: ${query}\n╰═════════════════⊷\n\n> ${randomFooter()}`,
            contextInfo: channelContext
        }, { quoted: mek });
    } catch (e) {
        console.log('[IMAGINE] failed:', e.message);
        reply("❌ Error found. Please try later (image generation can be slow).");
    }
});



// ==================== ANIME SEARCH ====================
cmd({
    pattern: "animesearch",
    alias: ["anime"],
    desc: "🍥 Search anime info",
    category: "search",
    react: "🍥",
    use: ".animesearch <anime name>",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        const query = args.join(" ");
        if (!query) return reply("❌ Use: .animesearch <anime name>");

        const res = await axios.get(`${BASE}/animesearch`, {
            params: { q: query },
            timeout: 20000
        });

        if (res.data && res.data.responce && res.data.responce.result && res.data.responce.result.length) {
            const anime = res.data.responce.result[0];
            const display = `╭═══ 🍥 ANIME ═══⊷\n┃❃│ Title: ${anime.title}\n┃❃│ Type: ${anime.type}\n┃❃│ Episodes: ${anime.episodes}\n┃❃│ Score: ${anime.score}\n┃❃│ ${anime.description}\n┃❃│ 🔗 ${anime.link}\n╰═════════════════⊷\n\n> ${randomFooter()}`;

            await conn.sendMessage(from, {
                image: { url: anime.imageUrl },
                caption: display,
                contextInfo: channelContext
            }, { quoted: mek });
        } else {
            reply("❌ Anime not found.");
        }
    } catch (e) {
        reply("❌ Error found. Please try later.");
    }
});

// ==================== YOUTUBE SEARCH ====================
// (Moved to downloaders.js — uses the reliable yt-search package instead of the felix API)

// ==================== LYRICS ====================
cmd({
    pattern: "lyrics",
    desc: "🎤 Get song lyrics",
    category: "search",
    react: "🎤",
    use: ".lyrics <song name>",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        const query = args.join(" ");
        if (!query) return reply("❌ Use: .lyrics <song name>");

        const res = await axios.get(`${BASE}/lyrics2`, {
            params: { q: query },
            timeout: 20000
        });

        if (res.data && res.data.length) {
            const song = res.data[0];
            const display = `╭═══ 🎤 LYRICS ═══⊷\n┃❃│ ${song.title} - ${song.artist}\n┃❃╰───────────────\n\n${song.lyric}\n\n> ${randomFooter()}`;
            reply(display.slice(0, 4000));
        } else {
            reply("❌ Lyrics not found.");
        }
    } catch (e) {
        reply("❌ Error found. Please try later.");
    }
});

// ==================== TIKTOK SEARCH/DOWNLOAD ====================
cmd({
    pattern: "tiktoksearch",
    alias: ["ttsearch"],
    desc: "🎬 Search & download TikTok video by keyword",
    category: "download",
    react: "🎬",
    use: ".tiktoksearch <search query>",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        const query = args.join(" ");
        if (!query) return reply("❌ Use: .tiktok <search query>");

        await conn.sendMessage(from, { react: { text: "⏳", key: m.key } });

        // tikwm.com is used here instead of the old felix API (which frequently goes down)
        const res = await axios.get("https://tikwm.com/api/feed/search", {
            params: { keywords: query, count: 1 },
            timeout: 25000
        });

        const video = res.data && res.data.data && res.data.data.videos && res.data.data.videos[0];
        if (video) {
            const rawUrl = video.play || video.hdplay;
            const videoUrl = rawUrl.startsWith("http") ? rawUrl : `https://tikwm.com${rawUrl}`;
            // Fetch the actual bytes (with proper headers) instead of handing WhatsApp a raw URL —
            // sending just { url } made WhatsApp render a black screen with duration but no playable stream.
            const videoBuffer = await fetchBuffer(videoUrl);
            await conn.sendMessage(from, {
                video: videoBuffer,
                mimetype: "video/mp4",
                caption: `╭═══ 🎬 TIKTOK ═══⊷\n┃❃│ ${video.title || "No title"}\n┃❃│ 👤 ${video.author?.nickname || "Unknown"}\n┃❃│ ❤️ ${video.digg_count || 0} | 👁️ ${video.play_count || 0}\n╰═════════════════⊷\n\n> ${randomFooter()}`,
                contextInfo: channelContext
            }, { quoted: mek });
            await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
        } else {
            reply("❌ No TikTok results found.");
        }
    } catch (e) {
        console.log("TIKTOK SEARCH ERROR:", e.message);
        reply("❌ Error found. Please try later.");
    }
});

// ==================== PINTEREST SEARCH ====================
// 🚨 REMOVED (duplicate command bug — Bunty: "aur bhi bugs dekho"): this
// used the SAME pattern "pinterest" as plugins/downloaders.js's .pinsearch
// command (alias: pins/pinterestsearch/pinterest). Since plugin files load
// alphabetically and felix-apis.js loads after downloaders.js, THIS
// simpler, single-random-image version was silently winning and running
// for .pinterest — while the better version in downloaders.js (multi-image,
// 3-provider fallback, built specifically because Bunty complained "only
// one pic aati hai") sat there as unreachable dead code. Removed here so
// the better one in downloaders.js actually runs.

// ==================== AI CHAT ====================
cmd({
    pattern: "ai",
    alias: ["ask"],
    desc: "🤖 Chat with AI",
    category: "main",
    react: "🤖",
    use: ".ai <your message>",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        const query = args.join(" ");
        if (!query) return reply("❌ Use: .ai <your question>");

        // Identity questions answered directly — guaranteed correct,
        // doesn't depend on the free API following instructions reliably.
        if (looksLikeIdentityQuestion(query)) {
            return reply(plainAIResponse(identityAnswer(query)));
        }

        await conn.sendMessage(from, { react: { text: "🤖", key: m.key } });

        const prompt = `Be friendly, helpful, and knowledgeable — answer thoroughly. Always reply in the SAME language and script the user wrote in (English, Roman Urdu, or Urdu script).\n\nUser: ${query}`;
        try {
            const answer = await smartAI(prompt);
            return reply(plainAIResponse(answer));
        } catch (e) {
            console.log('[AI] shared race failed, using direct verified Groq fallback:', e.message);
        }
        const answer = await pollinationsReply(prompt);
        if (!answer || looksLikeErrorPayload(answer)) throw new Error('AI failed to respond');
        return reply(plainAIResponse(answer));
    } catch (e) {
        reply("❌ Error found. Please try later.");
    }
});
