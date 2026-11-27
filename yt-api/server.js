// ============================================================
// BUNTY YT API — Ahmad's own YouTube downloader API
// ------------------------------------------------------------
// Replaces dead third-party APIs (Adeel/Jawad). Runs yt-dlp on
// the server and returns direct media URLs in the SAME response
// shape the WhatsApp bot already expects from Adeel's API:
//   { status: true, result: { title, audio_download } }
//   { status: true, result: { title, video_download } }
//
// Endpoints:
//   GET /health
//   GET /api/ytmp3?url=<youtube url>
//   GET /api/ytmp4?url=<youtube url>      (alias of ytmp4v2)
//   GET /api/ytmp4v2?url=<youtube url>
//
// If a cookies.txt (Netscape format, exported from a logged-in
// YouTube session) is placed next to this file on the server,
// it is passed to yt-dlp automatically — that defeats YouTube's
// datacenter-IP bot-check. NEVER commit cookies.txt to git.
// ============================================================

const http = require('http');
const { spawn } = require('child_process');
const { createDecipheriv } = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');
const EXTRACT_TIMEOUT_MS = 60000;
const MAX_PARALLEL = 3;

let running = 0;
const waiters = [];
function acquire() {
    if (running < MAX_PARALLEL) { running++; return Promise.resolve(); }
    return new Promise(res => waiters.push(res));
}
function release() {
    const next = waiters.shift();
    if (next) { next(); } else { running--; }
}

function ytDlpArgs(url) {
    const args = [
        '-j', '--no-playlist', '--no-warnings',
        '--socket-timeout', '20', '--retries', '2',
        // Same client profile the bot uses: the android player API still
        // returns progressive media on datacenter IPs where the web page
        // request gets HTTP 429.
        '--extractor-args', 'youtube:player_client=android;player_skip=webpage,configs',
    ];
    if (fs.existsSync(COOKIES_PATH)) args.push('--cookies', COOKIES_PATH);
    args.push(url);
    return args;
}

function extract(url) {
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', ytDlpArgs(url), { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        const killer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('extraction timed out')); }, EXTRACT_TIMEOUT_MS);
        proc.stdout.on('data', d => { out += d; });
        proc.stderr.on('data', d => { err += d; });
        proc.on('error', e => { clearTimeout(killer); reject(new Error('yt-dlp unavailable: ' + e.message)); });
        proc.on('close', code => {
            clearTimeout(killer);
            if (code !== 0) {
                const line = (err.split('\n').filter(Boolean).pop() || 'extraction failed').slice(0, 200);
                return reject(new Error(line));
            }
            try { resolve(JSON.parse(out.trim().split('\n')[0])); }
            catch (e) { reject(new Error('bad yt-dlp output')); }
        });
    });
}

// ---- SaveTube fallback -------------------------------------------------
// Used when yt-dlp is blocked by YouTube's "Sign in to confirm you're not
// a bot" check (datacenter IPs). SaveTube's converter backend fetches the
// video itself and hands back a finished MP3/MP4 on its own CDN, so this
// server's IP reputation doesn't matter. Protocol: pick a random CDN,
// POST the URL to /v2/info (the AES-128-CBC encrypted reply carries a
// one-time key), then POST /download with that key to get the media URL.
const ST_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';
const ST_KEY = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
const ST_TIMEOUT_MS = 30000;

function stDecode(enc) {
    const data = Buffer.from(enc, 'base64');
    const iv = data.slice(0, 16);
    const decipher = createDecipheriv('aes-128-cbc', Buffer.from(ST_KEY, 'hex'), iv);
    return JSON.parse(Buffer.concat([decipher.update(data.slice(16)), decipher.final()]).toString());
}

async function stFetch(url, opts = {}) {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(ST_TIMEOUT_MS) });
    if (!r.ok) throw new Error('savetube http ' + r.status);
    return r.json();
}

async function savetubeDownload(videoUrl, isAudio) {
    const headers = { 'User-Agent': ST_UA, 'Referer': 'https://save-tube.com/', 'Content-Type': 'application/json' };
    const cdnResp = await stFetch('https://media.savetube.vip/api/random-cdn');
    const cdn = cdnResp && cdnResp.cdn;
    if (!cdn) throw new Error('savetube: no cdn');
    const infoResp = await stFetch('https://' + cdn + '/v2/info', {
        method: 'POST', headers, body: JSON.stringify({ url: videoUrl })
    });
    const info = stDecode(infoResp.data);
    const dl = await stFetch('https://' + cdn + '/download', {
        method: 'POST', headers,
        body: JSON.stringify({ downloadType: isAudio ? 'audio' : 'video', quality: isAudio ? '128' : '360', key: info.key })
    });
    const url = dl && dl.data && dl.data.downloadUrl;
    if (!url) throw new Error('savetube: no download url');
    return { title: info.title || null, url, quality: isAudio ? '128kbps' : '360p', ext: isAudio ? 'mp3' : 'mp4' };
}

function pickAudio(formats) {
    const audioOnly = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
    audioOnly.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
    if (audioOnly.length) return audioOnly[0];
    const withAudio = formats.filter(f => f.acodec && f.acodec !== 'none');
    withAudio.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
    return withAudio[0] || null;
}

function pickVideo(formats) {
    const progressive = formats.filter(f =>
        f.acodec && f.acodec !== 'none' && f.vcodec && f.vcodec !== 'none' && f.url);
    // Prefer progressive MP4 at <=720p (plays everywhere, WhatsApp-friendly),
    // then any progressive MP4, then the best progressive format of any kind.
    const mp4 = progressive.filter(f => (f.ext === 'mp4'));
    const mp4Hd = mp4.filter(f => (f.height || 0) <= 720);
    mp4Hd.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));
    if (mp4Hd.length) return mp4Hd[0];
    mp4.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
    if (mp4.length) return mp4[0];
    progressive.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
    return progressive[0] || null;
}

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

const server = http.createServer(async (req, res) => {
    try {
        const u = new URL(req.url, 'http://localhost');
        const p = u.pathname;

        if (p === '/' || p === '/health') {
            return sendJson(res, 200, { ok: true, service: 'BUNTY YT API', cookies: fs.existsSync(COOKIES_PATH) });
        }

        const isAudio = p === '/api/ytmp3';
        const isVideo = p === '/api/ytmp4' || p === '/api/ytmp4v2';
        if (!isAudio && !isVideo) return sendJson(res, 404, { status: false, message: 'route not found' });

        const videoUrl = (u.searchParams.get('url') || '').trim();
        if (!/youtube\.com|youtu\.be/.test(videoUrl)) {
            return sendJson(res, 400, { status: false, message: 'a valid YouTube url is required' });
        }

        await acquire();
        try {
            // Video with no cookies file: yt-dlp is bot-checked on this
            // server's IP and only wastes time before failing, so try the
            // SaveTube converter first and keep yt-dlp as the fallback.
            // Audio keeps the original order (the .play path is unchanged).
            if (isVideo && !fs.existsSync(COOKIES_PATH)) {
                try {
                    const st = await savetubeDownload(videoUrl, false);
                    return sendJson(res, 200, { status: true, result: { title: st.title, quality: st.quality, ext: st.ext, via: 'savetube', video_download: st.url } });
                } catch (stErr) { /* SaveTube failed - fall through to yt-dlp */ }
            }
            let info = null, format = null, primaryErr = null;
            try {
                info = await extract(videoUrl);
                const formats = Array.isArray(info.formats) ? info.formats : [];
                format = isAudio ? pickAudio(formats) : pickVideo(formats);
            } catch (e) { primaryErr = e; }
            if (format && format.url) {
                if (isAudio) {
                    return sendJson(res, 200, {
                        status: true,
                        result: {
                            title: info.title || null,
                            audio_download: format.url,
                            quality: format.abr ? Math.round(format.abr) + 'kbps' : (format.format_note || null),
                            ext: format.ext || null
                        }
                    });
                }
                return sendJson(res, 200, {
                    status: true,
                    result: {
                        title: info.title || null,
                        video_download: format.url,
                        quality: format.height ? format.height + 'p' : (format.format_note || null),
                        ext: format.ext || null
                    }
                });
            }
            // yt-dlp failed (YouTube's bot-check blocks this server's IP) or
            // returned no usable format — fall back to the SaveTube converter
            // backend, which fetches via its own infrastructure and returns
            // a ready-to-download media URL on its CDN.
            try {
                const st = await savetubeDownload(videoUrl, isAudio);
                const result = { title: st.title, quality: st.quality, ext: st.ext, via: 'savetube' };
                if (isAudio) result.audio_download = st.url; else result.video_download = st.url;
                return sendJson(res, 200, { status: true, result });
            } catch (stErr) {
                const msg = primaryErr ? primaryErr.message : ('no ' + (isAudio ? 'audio' : 'video') + ' format found');
                return sendJson(res, 200, { status: false, message: msg });
            }
        } catch (e) {
            return sendJson(res, 200, { status: false, message: e.message });
        } finally {
            release();
        }
    } catch (e) {
        return sendJson(res, 500, { status: false, message: 'server error: ' + e.message });
    }
});

server.listen(PORT, () => console.log(`BUNTY YT API listening on :${PORT}`));
