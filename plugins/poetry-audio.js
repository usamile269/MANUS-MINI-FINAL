const { cmd } = require('../ahmad-core');
const axios = require('axios');
const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomFooter, toSansBoldItalic } = require('../lib/menu-styles');
const config = require('../config');
const { heavyQueue } = require('../lib/queue');

const BIN = path.join(__dirname, '..', 'bin', 'poetry-yt-dlp');
const MAX_BYTES = 35 * 1024 * 1024;
const POETRY_CLIP_SECONDS = 18;

function run(cmd, args, timeout = 90000) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        p.stdout.on('data', d => { out += d.toString(); });
        p.stderr.on('data', d => { err += d.toString(); });
        const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('download timeout')); }, timeout);
        p.on('error', reject);
        p.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) reject(new Error(err.slice(-500) || `process exited ${code}`));
            else resolve(out.trim());
        });
    });
}

async function ensureYtDlp() {
    if (fs.existsSync(BIN)) return BIN;
    fs.mkdirSync(path.dirname(BIN), { recursive: true });
    const response = await axios.get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', { responseType: 'stream', timeout: 60000 });
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(BIN);
        response.data.pipe(writer);
        writer.on('finish', resolve); writer.on('error', reject); response.data.on('error', reject);
    });
    fs.chmodSync(BIN, 0o755);
    return BIN;
}

async function searchSocialPoetry(query) {
    const terms = encodeURIComponent(`${query} poetry edit music status`);
    const response = await axios.get(`https://www.bing.com/search?q=${terms}`, {
        timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = String(response.data || '').replace(/&amp;/g, '&');
    const urls = html.match(/https?:\/\/(?:www\.)?(?:tiktok\.com\/@[^"'<> ]+\/video\/\d+|instagram\.com\/(?:reel|p)\/[^?"'<> ]+)/gi) || [];
    const unique = [...new Set(urls.map(url => url.replace(/[&].*$/, '')))];
    if (!unique.length) return null;
    return { url: unique[Math.floor(Math.random() * unique.length)], title: `${query} social edit` };
}

async function searchPoetry(query) {
    // Fresh search every time. Prefer the short edited/status-style uploads
    // that commonly contain music and effects, instead of plain long recitations.
    try {
        const social = await searchSocialPoetry(query);
        if (social) return social;
    } catch (e) { console.log('[POETRY SEARCH] social search unavailable:', e.message); }
    const searches = [
        `${query} poetry edit background music tiktok instagram reel 15 seconds`,
        `${query} poetry status edit music tiktok instagram short`,
        `${query} poetry recitation whatsapp status short`
    ];
    const all = [];
    for (const search of searches) {
        try {
            const result = await yts(search);
            for (const video of (result.videos || [])) {
                if (video?.url && !all.some(x => x.url === video.url)) all.push(video);
            }
            if (all.length >= 12) break;
        } catch (e) { console.log('[POETRY SEARCH] variant failed:', e.message); }
    }
    const candidates = all.filter(v => Number(v.seconds || 0) >= 12 && Number(v.seconds || 0) <= 45);
    const pool = candidates.length ? candidates : all.filter(v => Number(v.seconds || 0) >= 12 && Number(v.seconds || 0) <= 180);
    if (!pool.length) throw new Error('No public edited poetry clip found');
    const scored = pool.map(video => {
        const title = String(video.title || '').toLowerCase();
        const seconds = Number(video.seconds || 0);
        const editScore = ['edit', 'status', 'music', 'tiktok', 'instagram', 'reel', 'shorts', 'background', 'whatsapp'].reduce((n, word) => n + (title.includes(word) ? 2 : 0), 0);
        const durationScore = seconds >= 15 && seconds <= 22 ? 8 : seconds <= 30 ? 3 : seconds <= 45 ? 0 : -5;
        return { video, score: editScore + durationScore };
    }).sort((a, b) => b.score - a.score).slice(0, 8);
    return scored[Math.floor(Math.random() * scored.length)].video;
}

async function jawadYouTubeMedia(url) {
    const response = await axios.get('https://jawad-tech.vercel.app/download/ytdl', { params: { url }, timeout: 15000 });
    const result = response.data?.result;
    if (!response.data?.status || !result?.mp4) throw new Error('JawadTech returned no media');
    return { mediaUrl: result.mp4, title: result.title || 'YouTube poetry', source: url };
}

async function adeelYouTubeMedia(url) {
    const response = await axios.get('https://adeel-xtech-apis.vercel.app/api/ytmp4', { params: { url }, timeout: 15000 });
    const result = response.data?.result;
    if (!response.data?.status || !result?.video_download) throw new Error('AdeelXTech returned no media');
    return { mediaUrl: result.video_download, title: result.title || 'YouTube poetry', source: url };
}

async function youtubeMediaWithFallback(url) {
    let lastError;
    for (const provider of [jawadYouTubeMedia, adeelYouTubeMedia]) {
        try { return await provider(url); } catch (e) { lastError = e; }
    }
    throw lastError || new Error('No YouTube media provider succeeded');
}

async function socialMedia(url) {
    if (!config.RAPID_API_KEY) throw new Error('social downloader key unavailable');
    const response = await axios.post('https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink', { url }, {
        timeout: 15000,
        maxContentLength: MAX_BYTES,
        headers: {
            'Content-Type': 'application/json',
            'X-RapidAPI-Host': 'social-download-all-in-one.p.rapidapi.com',
            'X-RapidAPI-Key': config.RAPID_API_KEY
        }
    });
    const data = response.data;
    const media = (data?.medias || data?.links || []).find(x => x.type === 'video' || x.ext === 'mp4' || x.quality === 'hd') || (data?.medias || data?.links || [])[0];
    const mediaUrl = media?.url || media?.link;
    if (!mediaUrl) throw new Error('No public media was found for this link');
    return { mediaUrl, title: data.title || data.desc || 'Poetry audio', source: url };
}

async function downloadToFile(url, outPath) {
    const response = await axios.get(url, { responseType: 'stream', timeout: 60000, maxContentLength: MAX_BYTES, maxBodyLength: MAX_BYTES, headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-' } });
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(outPath);
        let bytes = 0;
        response.data.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_BYTES) response.data.destroy(new Error('media too large')); });
        response.data.pipe(writer);
        writer.on('finish', resolve); writer.on('error', reject); response.data.on('error', reject);
    });
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10000) throw new Error('The media file is empty or invalid');
}

async function youtubeDownloadWithFallback(url, outPath) {
    let lastError;
    for (const provider of [jawadYouTubeMedia, adeelYouTubeMedia]) {
        try {
            const media = await provider(url);
            await downloadToFile(media.mediaUrl, outPath);
            return media;
        } catch (e) {
            lastError = e;
            try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
        }
    }
    throw lastError || new Error('No YouTube media stream was downloadable');
}

async function directYoutubePoetryDownload(url, outPath) {
    const bin = await ensureYtDlp();
    await run(bin, [url, '-f', '18/bestaudio/best', '--no-playlist', '--max-filesize', '35M', '--extractor-args', 'youtube:player_client=android,ios', '--force-ipv4', '--socket-timeout', '25', '--retries', '3', '--fragment-retries', '3', '-o', outPath], 120000);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 10000) throw new Error('yt-dlp produced no usable poetry media');
    return { title: 'YouTube poetry', source: url };
}

async function toAudio(input, output) {
    // Keep the complete mixed soundtrack from the source (voice, music, and
    // ambient sounds). Trim by exact audio timestamps rather than relying only
    // on container duration, then send standard MP3 for WhatsApp compatibility.
    await run(require('@ffmpeg-installer/ffmpeg').path, ['-y', '-i', input, '-map', '0:a:0', '-vn', '-af', `atrim=start=0:duration=${POETRY_CLIP_SECONDS},asetpts=N/SR/TB`, '-t', String(POETRY_CLIP_SECONDS), '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-avoid_negative_ts', 'make_zero', '-f', 'mp3', output], 90000);
    if (!fs.existsSync(output) || fs.statSync(output).size < 2000) throw new Error('Audio extraction failed');
}

function cleanName(value) { return String(value || 'Poetry').replace(/[\r\n]/g, ' ').slice(0, 80); }

cmd({ pattern: 'poetry', alias: ['poetryaudio', 'shayari'], desc: 'Send real poetry audio from public clips', category: 'download', react: '🎙️' },
async (conn, mek, m, { from, args, q, reply }) => {
    const query = (q || args.join(' ')).trim();
    if (!query) return reply('🎙️ Usage: .poetry Ahmad Faraz\n🔗 Or send a direct TikTok, YouTube, or Instagram link.');
    const work = `/tmp/poetry_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const input = `${work}.source`;
    const output = `${work}.mp3`;
    let sourceTitle = query;
    let sourceUrl = query;
    try {
        await conn.sendMessage(from, { react: { text: '🎙️', key: mek.key } });
        await heavyQueue.run(async () => {
            fs.mkdirSync('/tmp', { recursive: true });
            if (/^https?:\/\//i.test(query)) {
                sourceUrl = query;
                try {
                    const social = await socialMedia(query);
                    sourceTitle = social.title;
                    await downloadToFile(social.mediaUrl, input);
                } catch (apiError) {
                    // Some providers reject YouTube URLs with 451/403 even
                    // when the public clip is available. For YouTube only,
                    // use the bundled yt-dlp fallback; TikTok/Instagram still
                    // fail cleanly instead of pretending to have audio.
                    if (!/youtube\.com|youtu\.be/i.test(query)) throw apiError;
                    try {
                        const yt = await directYoutubePoetryDownload(query, input);
                        sourceTitle = yt.title;
                    } catch (directError) {
                        console.log('[POETRY] direct yt-dlp failed, trying media APIs:', directError.message);
                        const yt = await youtubeDownloadWithFallback(query, input);
                        sourceTitle = yt.title;
                    }
                }
            } else {
                const video = await searchPoetry(query);
                sourceTitle = video.title;
                sourceUrl = video.url;
                try {
                    const social = await socialMedia(video.url);
                    sourceTitle = social.title || sourceTitle;
                    await downloadToFile(social.mediaUrl, input);
                } catch (apiError) {
                    try {
                        const yt = await directYoutubePoetryDownload(video.url, input);
                        sourceTitle = yt.title || sourceTitle;
                    } catch (directError) {
                        if (!/youtube\.com|youtu\.be/i.test(video.url)) throw directError;
                        console.log('[POETRY] direct yt-dlp failed, trying YouTube media APIs:', directError.message);
                        const yt = await youtubeDownloadWithFallback(video.url, input);
                        sourceTitle = yt.title || sourceTitle;
                    }
                }
            }
            await toAudio(input, output);
            const audio = fs.readFileSync(output);
            const B = toSansBoldItalic;
            await conn.sendMessage(from, {
                audio,
                mimetype: 'audio/mpeg',
                ptt: false,
                fileName: 'ahmad-mini-poetry.mp3',
                caption: `🎙️ ${B('REAL POETRY AUDIO')}\n⏱️ ${B(`${POETRY_CLIP_SECONDS}-second short clip`)}\n📝 ${cleanName(sourceTitle)}\n🔗 ${sourceUrl}\n\n> ${randomFooter()}`
            }, { quoted: mek });
        }, async () => {
            await conn.sendMessage(from, { text: '⏳ Your poetry audio is in the queue. I will send the real source audio as soon as it is ready.' }, { quoted: mek });
        });
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
    } catch (e) {
        console.error('[POETRY AUDIO]', e.message);
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
        return reply('❌ No public real poetry audio was found. Try another poet name or send a direct TikTok, YouTube, or Instagram link.');
    } finally {
        for (const file of [input, output]) { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {} }
    }
});
