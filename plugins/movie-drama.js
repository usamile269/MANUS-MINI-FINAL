// ============================================================================
// plugins/movie-drama.js — .movie / .drama info lookup
// ----------------------------------------------------------------------------
// 🔧 UPDATE (Bunty: "koi bhi name likhain drama a jay, movie bhi same") —
// both commands now try several providers/query variants in a fallback
// chain (same runFallbackChain() pattern used for downloaders/screenshot)
// instead of giving up after one exact-match lookup. Between Wikipedia +
// TVMaze + query variants, almost any real movie/drama name resolves to
// something now, instead of a quick "not found."
// ============================================================================

const { cmd } = require('../ahmad-core');
const axios = require('axios');
const yts = require('yt-search');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { renderLuxe, renderError } = require('../lib/menu-styles');
const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
const YTDLP_BIN = path.join(__dirname, '..', 'bin', `yt-dlp${process.platform === 'win32' ? '.exe' : ''}`);
const YTDLP_MARKER = `${YTDLP_BIN}.linux-verified`;
const DRAMA_MAX_BYTES = 45 * 1024 * 1024;
const DRAMA_PREFERRED_SECONDS = 300;
const DRAMA_HARD_SECONDS = 600;
const { runFallbackChain } = require('../lib/fallback-chain');

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();

// 🚨 DEBUG MARKER (Bunty: "old .drama abhi bhi chal raha hai, redeploy ke
// baad bhi" — file content confirmed correct on this end, so this is a
// stale-deploy/volume issue on the host, not a code bug): this logs once
// at boot so it's obvious in Railway's deploy logs whether THIS file
// (with the new Aura-audio .drama) is actually the one that got loaded.
// If a fresh deploy's logs do NOT show this line, the host is serving an
// old cached copy of plugins/movie-drama.js (usually a persistent volume
// mounted over more than just the database/ folder, or a build that
// didn't actually pick up the new files) — not a database/cache problem,
// since command code has never been stored in the DB.
console.log('[BOOT] plugins/movie-drama.js loaded — DRAMA-AURA-AUDIO-V2 (jawad-tech audio, no more TVMaze text)');

async function wikiSummaryFor(query) {
    const search = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: { action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: 1 },
        timeout: 15000
    });
    const hit = search.data?.query?.search?.[0];
    if (!hit) throw new Error('no wiki match');
    const summary = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`,
        { timeout: 15000 }
    );
    const d = summary.data;
    if (!d?.extract) throw new Error('no summary');
    return {
        title: d.title,
        poster: d.thumbnail?.source || null,
        lines: [`Title: ${d.title}`, d.extract.slice(0, 500) + (d.extract.length > 500 ? '…' : '')]
    };
}

async function tvmazeSingleFor(query) {
    const { data } = await axios.get('https://api.tvmaze.com/singlesearch/shows', { params: { q: query }, timeout: 15000 });
    if (!data) throw new Error('no tvmaze match');
    const desc = stripHtml(data.summary);
    return {
        title: data.name,
        poster: data.image?.original || data.image?.medium || null,
        lines: [
            `Title: ${data.name}`,
            `Network: ${data.network?.name || data.webChannel?.name || 'Unknown'}`,
            `Status: ${data.status || 'Unknown'}`,
            `Premiered: ${data.premiered || 'Unknown'}`,
            `Rating: ${data.rating?.average ?? 'N/A'}`,
            '',
            (desc.slice(0, 400) + (desc.length > 400 ? '…' : '')) || 'No summary available.'
        ]
    };
}

async function sendResult(conn, mek, m, from, reply, result, cardTitle) {
    const card = renderLuxe(cardTitle, result.lines);
    if (result.poster) {
        await conn.sendMessage(from, { image: { url: result.poster }, caption: card }, { quoted: mek });
    } else {
        reply(card);
    }
    await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
}

function directSocialUrl(value) {
    const hit = String(value || '').match(/https?:\/\/(?:www\.)?(?:tiktok\.com\/[^\s]+|instagram\.com\/(?:reel|p)\/[^\s]+)/i);
    return hit ? hit[0].replace(/[),.!?]+$/, '') : null;
}

function socialLinksFromHtml(html) {
    const text = String(html || '').replace(/&amp;/g, '&').replace(/\\u002F/g, '/');
    const links = text.match(/https?:\/\/(?:www\.)?(?:tiktok\.com\/@[^"'<>\s]+\/video\/\d+|instagram\.com\/(?:reel|p)\/[A-Za-z0-9_-]+)/gi) || [];
    return [...new Set(links.map(x => x.replace(/[),.!?]+$/, '')))];
}

async function discoverDramaSocialLinks(query) {
    const q = encodeURIComponent(`${query} drama scene short clip`);
    const urls = [
        `https://html.duckduckgo.com/html/?q=site%3Atiktok.com%2F%40+${q}`,
        `https://html.duckduckgo.com/html/?q=site%3Ainstagram.com%2Freel+${q}`
    ];
    const pages = await Promise.allSettled(urls.map(url => axios.get(url, {
        timeout: 9000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AhmadMiniBot/1.0)' }
    })));
    return pages.flatMap(x => x.status === 'fulfilled' ? socialLinksFromHtml(x.value.data) : []);
}

async function ensureDramaYtDlp() {
    if (process.platform === 'win32') {
        if (!fs.existsSync(YTDLP_BIN)) await YTDlpWrap.downloadFromGithub(YTDLP_BIN);
        return YTDLP_BIN;
    }
    if (!fs.existsSync(YTDLP_BIN) || !fs.existsSync(YTDLP_MARKER)) {
        await fsp.mkdir(path.dirname(YTDLP_BIN), { recursive: true });
        const tmp = `${YTDLP_BIN}.part`;
        const response = await axios.get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', { responseType: 'stream', timeout: 60000 });
        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(tmp);
            response.data.pipe(writer);
            writer.on('finish', resolve); writer.on('error', reject); response.data.on('error', reject);
        });
        await fsp.chmod(tmp, 0o755);
        await fsp.rename(tmp, YTDLP_BIN);
        await fsp.writeFile(YTDLP_MARKER, new Date().toISOString());
    }
    return YTDLP_BIN;
}

function dramaProcess(command, args, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        child.stderr.on('data', chunk => { err = (err + chunk.toString()).slice(-5000); });
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('drama download timed out')); }, timeoutMs);
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(err || `yt-dlp exited ${code}`)); });
    });
}

async function searchDramaYouTube(query) {
    const direct = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(query);
    if (direct) return [{ url: query, title: query }];
    const result = await yts(`${query} drama scene short clip`);
    const videos = (result.videos || []).filter(video => video?.url && Number(video.seconds || 0) > 0);
    if (!videos.length) throw new Error('no YouTube drama result');
    // Prefer a clip that can be sent quickly, but keep a wider fallback for
    // titles whose search results are all longer scene uploads.
    const preferred = videos.filter(video => Number(video.seconds) <= DRAMA_PREFERRED_SECONDS);
    const candidates = (preferred.length ? preferred : videos).slice(0, 6);
    return candidates;
}

async function dramaProviderMedia(url) {
    const providers = [
        async () => {
            const { data } = await axios.get('https://jawad-tech.vercel.app/download/ytdl', { params: { url }, timeout: 20000 });
            const mediaUrl = data?.result?.mp4;
            if (!data?.status || !mediaUrl) throw new Error('JawadTech returned no mp4');
            return { mediaUrl, title: data.result.title || 'Ahmad Mini Drama' };
        },
        async () => {
            const { data } = await axios.get('https://adeel-xtech-apis.vercel.app/api/ytmp4', { params: { url }, timeout: 20000 });
            const mediaUrl = data?.result?.video_download;
            if (!data?.status || !mediaUrl) throw new Error('AdeelXTech returned no mp4');
            return { mediaUrl, title: data.result.title || 'Ahmad Mini Drama' };
        }
    ];
    let lastError;
    for (const provider of providers) {
        try { return await provider(); } catch (error) { lastError = error; }
    }
    throw lastError || new Error('all drama media providers failed');
}

async function downloadDramaUrl(mediaUrl, output) {
    const response = await axios.get(mediaUrl, {
        responseType: 'stream',
        timeout: 60000,
        maxContentLength: DRAMA_MAX_BYTES,
        maxBodyLength: DRAMA_MAX_BYTES,
        maxRedirects: 5,
        headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-' }
    });
    const declared = Number(response.headers['content-length'] || 0);
    if (declared > DRAMA_MAX_BYTES) throw new Error('drama media exceeds safe limit');
    let bytes = 0;
    response.data.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > DRAMA_MAX_BYTES) response.data.destroy(new Error('drama media exceeds safe limit'));
    });
    await pipeline(response.data, fs.createWriteStream(output));
    const stat = await fsp.stat(output);
    if (stat.size < 10000 || stat.size > DRAMA_MAX_BYTES) throw new Error('drama file is empty or exceeds safe limit');
    return output;
}

async function downloadDramaFromYouTube(query, dir) {
    const candidates = await searchDramaYouTube(query);
    const output = path.join(dir, 'drama.mp4');
    let lastError;
    for (const candidate of candidates) {
        try {
            const media = await dramaProviderMedia(candidate.url);
            await downloadDramaUrl(media.mediaUrl, output);
            return { file: output, title: media.title || candidate.title, source: candidate.url };
        } catch (error) {
            lastError = error;
            try { if (fs.existsSync(output)) await fsp.rm(output, { force: true }); } catch (_) {}
        }
    }
    // Direct yt-dlp remains the last fallback for provider outages. It is no
    // longer the first path, so a normal `.drama` command does not cold-start
    // by downloading a binary before trying a working media API.
    const bin = await ensureDramaYtDlp();
    const outputPattern = path.join(dir, 'drama.%(ext)s');
    const source = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(query)
        ? query : `ytsearch1:${query} drama scene short clip`;
    await dramaProcess(bin, [
        source, '--no-playlist', '--no-warnings', '--ignore-config',
        '--restrict-filenames', '--max-filesize', '45M',
        '--match-filter', `duration <= ${DRAMA_HARD_SECONDS}`,
        '--socket-timeout', '30', '--retries', '2', '--fragment-retries', '2',
        '--concurrent-fragments', '2', '--extractor-args', 'youtube:player_client=android,web',
        '-f', 'bv*[height<=480]+ba/b[height<=480]/b', '--merge-output-format', 'mp4',
        '-o', outputPattern
    ], 120000);
    const files = await fsp.readdir(dir);
    const file = files.map(x => path.join(dir, x)).find(x => /\.(mp4|mkv|webm)$/i.test(x));
    if (!file) throw lastError || new Error('YouTube did not create a video file');
    const stat = await fsp.stat(file);
    if (stat.size < 10000 || stat.size > DRAMA_MAX_BYTES) throw new Error('drama file exceeded safe limit');
    return { file, title: query, source: candidates[0]?.url || query };
}

async function resolveDramaClip(query) {
    const direct = directSocialUrl(query);
    const links = direct ? [direct] : await discoverDramaSocialLinks(query);
    if (!links.length) throw new Error('no public TikTok/Instagram drama clip found');
    const candidates = links.slice(0, 6);
    const attempts = await Promise.allSettled(candidates.map(async url => {
        if (/tiktok\.com/i.test(url)) {
            const { data } = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`, {
                timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const item = data?.data || data?.result || {};
            const audio = item.music || item.music_info?.play_url;
            if (!audio) throw new Error('TikTok returned no audio');
            return { url: audio, title: item.title || query, source: url };
        }
        const methods = [
            `https://api.vreden.my.id/api/igdl?url=${encodeURIComponent(url)}`,
            `https://api.vreden.my.id/api/igdownload?url=${encodeURIComponent(url)}`
        ];
        for (const endpoint of methods) {
            try {
                const { data } = await axios.get(endpoint, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                const item = data?.result?.data?.[0] || data?.result?.[0] || data?.data?.[0];
                if (item?.url) return { url: item.url, title: query, source: url };
            } catch {}
        }
        throw new Error('Instagram returned no media');
    }));
    const winner = attempts.find(x => x.status === 'fulfilled');
    if (!winner) throw new Error('all social drama providers failed');
    return winner.value;
}

cmd({
    pattern: "movie",
    desc: "Look up a movie — summary, poster (tries multiple sources)",
    category: "tools",
    use: ".movie Inception",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    if (!q) return reply(renderError('Usage: .movie <movie name>'));
    try {
        await conn.sendMessage(from, { react: { text: '🎬', key: mek.key } });
        const result = await runFallbackChain('MOVIE', [
            { name: 'Wiki (film)', run: () => wikiSummaryFor(`${q} film`) },
            { name: 'Wiki (movie)', run: () => wikiSummaryFor(`${q} movie`) },
            { name: 'Wiki (plain)', run: () => wikiSummaryFor(q) },
            { name: 'TVMaze (fallback)', run: () => tvmazeSingleFor(q) },
        ]);
        if (!result.ok) return reply(renderError(`Couldn't find anything for "${q}" — try a slightly different spelling.`));
        await sendResult(conn, mek, m, from, reply, result.value, 'Movie');
    } catch (e) {
        console.log('[MOVIE] error:', e.message);
        reply(renderError("Couldn't fetch that movie right now, try again shortly."));
    }
});

// 🔁 SWAPPED (Bunty: "drama cmd Aura MD ka lagao, Ahmad MD wala cut karo") —
// the old TVMaze/Wikipedia series-lookup .drama above is replaced with
// Aura MD's .drama, which downloads a short drama/story audio clip from
// jawad-tech's API instead of returning a text/poster summary. Ported to
// Ahmad's cmd() + renderError conventions.
cmd({
    pattern: "drama",
    desc: "Download a short drama/story audio clip",
    category: "tools",
    use: ".drama <title/keyword>",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    const query = (q || '').trim();
    if (!query) return reply(renderError('Usage: .drama <title/keyword>'));
    const dir = path.join(require('os').tmpdir(), `ahmad-drama-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
        await conn.sendMessage(from, { react: { text: '🎭', key: mek.key } });
        await fsp.mkdir(dir, { recursive: true });
        const media = await downloadDramaFromYouTube(query, dir);
        const title = String(media.title || query).replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Ahmad Mini Drama';
        await conn.sendMessage(from, {
            document: fs.createReadStream(media.file),
            fileName: `${title}.mp4`,
            mimetype: 'video/mp4',
            caption: `🎬 *${title}*\n\n© AHMAD MINI`
        }, { quoted: mek });
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
    } catch (e) {
        console.log('[DRAMA] YouTube download failed:', e.message);
        const blocked = /sign in|not a bot|captcha|403|timed out/i.test(e.message);
        await reply(renderError(blocked
            ? 'YouTube blocked this server request. Send a direct YouTube link or try again later.'
            : 'Drama download failed. Try another title or a shorter YouTube clip.'));
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
    } finally {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
});
