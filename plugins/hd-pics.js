const { cmd } = require('../lib/command');
const axios = require('axios');

// Scrape Pinterest for real HD pics — improved HD reliability
async function getPinterestPic(query) {
    try {
        const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                'Accept': 'text/html',
            },
            timeout: 15000,
        });
        // Try originals first (full HD), then 736x (high quality)
        let matches = data.match(/https:\/\/i\.pinimg\.com\/originals\/[a-f0-9\/]+\.(jpg|jpeg|png)/gi) || [];
        if (!matches.length) {
            // Fallback: 736x URLs, upgrade to originals
            const m736 = data.match(/https:\/\/i\.pinimg\.com\/736x\/[a-f0-9\/]+\.(jpg|jpeg|png)/gi) || [];
            matches = m736.map(u => u.replace('/736x/', '/originals/'));
        }
        if (!matches.length) {
            // Last resort: any pinimg URL, try originals version
            const any = data.match(/https:\/\/i\.pinimg\.com\/[a-z0-9]+\/[a-f0-9\/]+\.(jpg|jpeg|png)/gi) || [];
            matches = any.map(u => u.replace(/\/i\.pinimg\.com\/[a-z0-9]+\//, '/i.pinimg.com/originals/'));
        }
        const unique = [...new Set(matches)];
        if (!unique.length) return null;
        // Pick random
        const picUrl = unique[Math.floor(Math.random() * unique.length)];
        const res = await axios.get(picUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const buf = Buffer.from(res.data);
        // Reject tiny images (likely thumbnails, not HD)
        if (buf.length < 50000) {
            console.log(`[HD-PICS] too small (${buf.length}b), skipping`);
            return null;
        }
        return buf;
    } catch (e) {
        console.log(`[HD-PICS] Pinterest fail for "${query}": ${e.message}`);
        return null;
    }
}

const categories = [
    { pattern: 'attitude', query: 'attitude boy style HD', desc: 'Attitude HD pics', emoji: '😎' },
    { pattern: 'aesthetic', query: 'aesthetic wallpaper HD', desc: 'Aesthetic HD pics', emoji: '🌸' },
    { pattern: 'girls', query: 'stylish girl aesthetic HD', desc: 'Girls HD pics', emoji: '👧' },
    { pattern: 'islamic', query: 'islamic mosque beautiful HD', desc: 'Islamic HD pics', emoji: '🕌' },
    // 🆕 2026-10-13: Girls/Boys DP set (Mazari-MD parity)
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
        if (!img) return reply('❌ Pic nahi mili, dobara try karo!');
        const jid = mek.key.remoteJid || m.key.remoteJid;
        await conn.sendMessage(jid, {
            image: img,
            caption: `${cat.emoji} *${cat.pattern.toUpperCase()}* HD\n\nPowered by 亗 AHMAD-MD`
        }, { quoted: mek });
    });
}

console.log('[HD-PICS] loaded: attitude, aesthetic, girls, islamic, girldp, boydp, girlavatar, girlportrait, girlaesthetic, boyattitude, girlwallpaper, boywallpaper, girlfashion');
