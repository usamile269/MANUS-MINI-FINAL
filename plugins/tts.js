const { cmd } = require('../lib/command');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

cmd({
    pattern: "tts",
    desc: "Convert text to speech (free, no API key needed)",
    category: "utility",
    use: ".tts <text>",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    try {
        if (!q) return reply("Usage: .tts <text>\nExample: .tts Hello kaise ho");
        if (q.length > 200) return reply("Text too long (max 200 characters).");
        
        await reply("Generating voice...");
        
        // Google Translate TTS (free, no API key)
        const lang = /[\u0600-\u06FF]/.test(q) ? 'ur' : 'en';
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(q)}&tl=${lang}&client=tw-ob`;
        
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 30000
        });
        
        const tmpPath = path.join('/tmp', `tts_${Date.now()}.mp3`);
        fs.writeFileSync(tmpPath, Buffer.from(res.data));
        
        await conn.sendMessage(from, {
            audio: fs.readFileSync(tmpPath),
            mimetype: 'audio/mpeg',
            ptt: true
        }, { quoted: mek });
        
        fs.unlinkSync(tmpPath);
        
    } catch (e) {
        console.log('[TTS] error:', e.message);
        reply("Failed to generate voice. Try again.");
    }
});
