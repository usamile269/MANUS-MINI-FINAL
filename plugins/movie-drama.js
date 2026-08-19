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
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { renderLuxe, renderError } = require('../lib/menu-styles');
const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
const YTDLP_BIN = path.join(__dirname, '..', 'bin', `yt-dlp${process.platform === 'win32' ? '.exe' : ''}`);
const YTDLP_MARKER = `${YTDLP_BIN}.linux-verified`;
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

async function downloadDramaFromYouTube(query, dir) {
    const bin = await ensureDramaYtDlp();
    const output = path.join(dir, 'drama.%(ext)s');
    const source = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(query)
        ? query : `ytsearch1:${query} drama scene short clip`;
    await dramaProcess(bin, [source, '--no-playlist', '--no-warnings', '--max-filesize', '45M', '--match-filter', 'duration <= 180', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '128K', '-o', output], 120000);
    const files = await fsp.readdir(dir);
    const file = files.map(x => path.join(dir, x)).find(x => /\.mp3$/i.test(x));
    if (!file) throw new Error('YouTube did not create an audio file');
    return file;
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
    try {
        await conn.sendMessage(from, { react: { text: '🎭', key: mek.key } });
        const dir = path.join(require('os').tmpdir(), `ahmad-drama-${Date.now()}`);
        await fsp.mkdir(dir, { recursive: true });
        let clip;
        try {
            const localFile = await downloadDramaFromYouTube(query, dir);
            const bytes = await fsp.readFile(localFile);
            if (!bytes.length || bytes.length > 45 * 1024 * 1024) throw new Error('drama file exceeded safe limit');
            clip = { buffer: bytes, title: query };
        } finally {
            await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
        await conn.sendMessage(from, {
            audio: clip.buffer,
            mimetype: 'audio/mpeg',
            fileName: `${clip.title || query}.mp3`
        }, { quoted: mek });
        await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
    } catch (e) {
        console.log('[DRAMA] social provider error:', e.message);
        reply(renderError('YouTube drama clip fetch failed. Try a different title or send a direct YouTube link.'));
    }
});
