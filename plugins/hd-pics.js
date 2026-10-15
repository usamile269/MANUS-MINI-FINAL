const { cmd } = require('../lib/command');
const axios = require('axios');

// Multiple sources for HD pics with fallbacks
async function getPinterestPic(query) {
    // Pinterest Resource API (JSON) — more reliable than HTML scraping
    const resourceUrl = 'https://www.pinterest.com/resource/BaseSearchResource/get/';
    const data = {
        options: { query: query, scope: 'pins', page_size: 25 },
        context: {}
    };
    const params = new URLSearchParams({
        source_url: `/search/pins/?q=${encodeURIComponent(query)}`,
        data: JSON.stringify(data),
        _: Date.now().toString()
    });

    const { data: res } = await axios.get(`${resourceUrl}?${params}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
        },
        timeout: 20000,
    });

    const pins = res?.resource_response?.data?.results || [];
    const urls = [];
    for (const pin of pins) {
        const img = pin?.images?.orig || pin?.images?.['736x'];
        if (img?.url) urls.push(img.url);
    }
    if (!urls.length) throw new Error('No Pinterest results');

    // Pick random, download, validate size
    const shuffled = urls.sort(() => Math.random() - 0.5);
    for (const picUrl of shuffled.slice(0, 5)) {
        try {
            const imgRes = await axios.get(picUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: { 'Referer': 'https://www.pinterest.com/' }
            });
            const buf = Buffer.from(imgRes.data);
            if (buf.length > 50000) return buf; // At least 50KB = real photo
        } catch (e) { continue; }
    }
    throw new Error('No valid image downloaded');
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
