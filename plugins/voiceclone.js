const { cmd } = require('../lib/command');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// User needs to set ELEVENLABS_API_KEY in config
// Free tier: https://elevenlabs.io (10k chars/month free)

cmd({
    pattern: "voiceclone",
    desc: "Clone a voice from replied audio + speak your text",
    category: "ai",
    use: ".voiceclone <text> (reply to a voice note)",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    try {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            return reply("Voice clone is not configured yet. Owner needs to set ELEVENLABS_API_KEY.");
        }
        if (!q) return reply("Usage: .voiceclone <text> (reply to a voice note)");
        
        const quoted = m.quoted;
        if (!quoted) return reply("Please reply to a voice note with your text.");
        
        const mime = (quoted.msg || quoted).mimetype || '';
        if (!mime.startsWith('audio/')) return reply("Please reply to a voice note/audio message.");
        
        await reply("Cloning voice... this may take a moment.");
        
        // Download the voice sample
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        const stream = await downloadContentFromMessage(quoted, 'audio');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > 10 * 1024 * 1024) throw new Error('Audio too large (max 10MB).');
        }
        
        // Step 1: Create a voice clone from the sample
        const FormData = require('form-data');
        const form = new FormData();
        form.append('name', `clone_${Date.now()}`);
        form.append('files', buffer, { filename: 'sample.mp3', contentType: 'audio/mpeg' });
        
        const voiceRes = await axios.post('https://api.elevenlabs.io/v1/voices/add', form, {
            headers: { ...form.getHeaders(), 'xi-api-key': apiKey },
            timeout: 60000
        });
        
        const voiceId = voiceRes.data.voice_id;
        if (!voiceId) throw new Error('Failed to clone voice.');
        
        // Step 2: Generate speech with the cloned voice
        const ttsRes = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            { text: q, model_id: 'eleven_monolingual_v1' },
            { headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' }, responseType: 'arraybuffer', timeout: 60000 }
        );
        
        const audioBuffer = Buffer.from(ttsRes.data);
        const tmpPath = path.join('/tmp', `vc_${Date.now()}.mp3`);
        fs.writeFileSync(tmpPath, audioBuffer);
        
        await conn.sendMessage(from, {
            audio: fs.readFileSync(tmpPath),
            mimetype: 'audio/mpeg',
            ptt: true
        }, { quoted: mek });
        
        fs.unlinkSync(tmpPath);
        
        // Cleanup: delete the temporary cloned voice
        try {
            await axios.delete(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
                headers: { 'xi-api-key': apiKey }
            });
        } catch {}
        
    } catch (e) {
        console.log('[VOICECLONE] error:', e.message);
        reply("Voice clone failed. Try again or check API key.");
    }
});
