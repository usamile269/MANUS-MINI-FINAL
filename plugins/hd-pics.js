const { cmd } = require('../lib/command');
const axios = require('axios');

// Multiple sources for HD pics with fallbacks
async function getPinterestPic(query) {
    // Try Pinterest with different approaches
    const attempts = [
        // Attempt 1: Standard Pinterest search
        async () => {
            const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
            const { data } = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                timeout: 15000,
            });
            return data;
        },
        // Attempt 2: Pinterest with mobile UA
        async () => {
            const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
            const { data } = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
                    'Accept': 'text/html',
                },
                timeout: 15000,
            });
            return data;
        }
    ];

    for (const attempt of attempts) {
        try {
            const data = await attempt();
            // Extract all pinimg URLs
            const allUrls = data.match(/https:\/\/i\.pinimg\.com\/[a-z0-9]+\/[a-f0-9\/]+\.(jpg|jpeg|png|webp)/gi) || [];
            // Prefer originals, then 736x
            let hdUrls = allUrls.filter(u => u.includes('/originals/'));
            if (!hdUrls.length) {
                hdUrls = allUrls.filter(u => u.includes('/736x/')).map(u => u.replace('/736x/', '/originals/'));
            }
            if (!hdUrls.length && allUrls.length) {
                hdUrls = allUrls.map(u => u.replace(/\/i\.pinimg\.com\/[a-z0-9]+\//, '/i.pinimg.com/originals/'));
            }
            const unique = [...new Set(hdUrls)];
            if (unique.length) {
                const picUrl = unique[Math.floor(Math.random() * unique.length)];
                const res = await axios.get(picUrl, { 
                    responseType: 'arraybuffer', 
                    timeout: 30000,
                    headers: { 'Referer': 'https://www.pinterest.com/' }
                });
                const buf = Buffer.from(res.data);
                if (buf.length > 30000) return buf; // At least 30KB
            }
        } catch (e) {
            console.log(`[HD-PICS] attempt failed: ${e.message}`);
            continue;
        }
    }
    return null;
}

const categories = [
    { pattern: 'attitude', query: 'attitude boy style HD', desc: 'Attitude HD pics', emoji: '😎' },
    { pattern: 'aesthetic', query: 'aesthetic wallpaper HD', desc: 'Aesthetic HD pics', emoji: '🌸' },
    { pattern: 'girls', query: 'stylish girl aesthetic HD', desc: 'Girls HD pics', emoji: '👧' },
    { pattern: 'islamic', query: 'islamic mosque beautiful HD', desc: 'Islamic HD pics', emoji: '🕌' },
    { pattern: 'girldp', query: 'beautiful girl dp profile picture HD', desc: 'Girl DP HD pics', emoji: '👩' },
    { pattern: 'boydp', query: 'handsome boy dp profile picture HD', desc: 'Boy DP HD pics', emoji: '👦' },
    { pattern: 'girlavatar', query: 'girl avatar cute HD', desc: 'Girl avatar HD pics', emoji: '👧' },
    { pattern: 'girlportrait', query: 'girl portrait photography HD', desc: 'Girl portrait HD pics', emoji: '📸' },
    { pattern: 'girlaesthetic', query: 'girl aesthetic wallpaper HD', desc: 'Girl aesthetic HD pics', emoji: '🌷' },
    { pattern: 'boyattitude', query: 'boy attitude dp HD', desc: 'Boy attitude HD pics', emoji: '😈' },
    { pattern: 'girlwallpaper', query: 'girl wallpaper HD mobile', desc: 'Girl wallpaper HD', emoji: '🖼️' },
    { pattern: 'boywallpaper', query: 'boy wallpaper HD mobile', desc: 'Boy wallpaper HD', emoji: '🖼️' },
    { pattern: 'girlfashion', query: 'girl fashion style HD', desc: 'Girl fashion HD pics', emoji: '💃' },
];

for (const cat of categories) {
    cmd({
        pattern: cat.pattern,
        desc: cat.desc,
        category: 'image',
        react: cat.emoji,
    }, async (conn, mek, m, { reply }) => {
        await reply(`⏳ ${cat.emoji} HD pic la raha hun...`);
        const img = await getPinterestPic(cat.query);
        if (!img) return reply('❌ No pic found, try again!');
        const jid = mek.key.remoteJid || m.key.remoteJid;
        await conn.sendMessage(jid, {
            image: img,
            caption: `${cat.emoji} *${cat.pattern.toUpperCase()}* HD\n\nPowered by 亗 AHMAD-MD`
        }, { quoted: mek });
    });
}

console.log('[HD-PICS] loaded: attitude, aesthetic, girls, islamic, girldp, boydp, girlavatar, girlportrait, girlaesthetic, boyattitude, girlwallpaper, boywallpaper, girlfashion');
