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
            const info = await extract(videoUrl);
            const formats = Array.isArray(info.formats) ? info.formats : [];
            if (isAudio) {
                const f = pickAudio(formats);
                if (!f || !f.url) return sendJson(res, 200, { status: false, message: 'no audio format found' });
                return sendJson(res, 200, {
                    status: true,
                    result: {
                        title: info.title || null,
                        audio_download: f.url,
                        quality: f.abr ? Math.round(f.abr) + 'kbps' : (f.format_note || null),
                        ext: f.ext || null
                    }
                });
            }
            const f = pickVideo(formats);
            if (!f || !f.url) return sendJson(res, 200, { status: false, message: 'no video format found' });
            return sendJson(res, 200, {
                status: true,
                result: {
                    title: info.title || null,
                    video_download: f.url,
                    quality: f.height ? f.height + 'p' : (f.format_note || null),
                    ext: f.ext || null
                }
            });
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
