const { cmd } = require('../lib/command');
const axios = require('axios');

// Scrape Pinterest for real HD pics
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
        // Extract i.pinimg.com URLs (original quality)
        const matches = data.match(/https:\/\/i\.pinimg\.com\/originals\/[a-f0-9\/]+\.(jpg|jpeg|png)/gi) || [];
        const unique = [...new Set(matches)];
        if (!unique.length) return null;
        // Pick random
        const picUrl = unique[Math.floor(Math.random() * unique.length)];
        // Get HD version (originals are already HD)
        const res = await axios.get(picUrl, { responseType: 'arraybuffer', timeout: 30000 });
        return Buffer.from(res.data);
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

console.log('[HD-PICS] loaded: attitude, aesthetic, girls, islamic');
