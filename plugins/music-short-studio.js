'use strict';

// Ahmad Mini Music Short Studio
// Social-only source path: TikTok/Instagram discovery and extraction.
// Separate from .play, .video and .poetry.
const { cmd } = require('../ahmad-core');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { heavyQueue } = require('../lib/queue');

const ROOT = path.join(os.tmpdir(), 'ahmad-mini-music');
const MAX_SECONDS = 35;
const MAX_SOURCE_BYTES = 45 * 1024 * 1024;
const RESULT_TTL = 5 * 60 * 1000;
const searchCache = new Map();
const usedSources = new Map();
const activeKeys = new Set();

function safeName(s) { return String(s || '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 70) || 'music'; }
function cleanupDir(dir) { return fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
function remember(map, key, value, ttl) { map.set(key, { value, expires: Date.now() + ttl }); }
function getRemembered(map, key) {
    const hit = map.get(key);
    if (!hit || hit.expires < Date.now()) { if (hit) map.delete(key); return null; }
    return hit.value;
}
function hash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12); }

function socialUrlFromQuery(query) {
    const match = String(query || '').match(/https?:\/\/(?:www\.)?(?:tiktok\.com\/@[^\s]+|instagram\.com\/(?:reel|p)\/[^\s]+)/i);
    return match ? match[0].replace(/[),.!?]+$/, '') : null;
}

function extractSocialLinks(html) {
    const text = String(html || '').replace(/&amp;/g, '&').replace(/\\u002F/g, '/');
    const candidates = [];
    const direct = text.match(/https?:\/\/(?:www\.)?(?:tiktok\.com\/[^"'<>\s]+|instagram\.com\/(?:reel|p)\/[^"'<>\s]+)/gi) || [];
    candidates.push(...direct);
    for (const match of text.matchAll(/uddg=([^&"'<>\s]+)/gi)) {
        try { candidates.push(decodeURIComponent(match[1])); } catch {}
    }
    return [...new Set(candidates.map(x => x.replace(/[),.!?]+$/, '')))]
        .filter(x => /tiktok\.com|instagram\.com/i.test(x));
}

async function discoverSocialLinks(query) {
    const encoded = encodeURIComponent(`${query} viral short`);
    const searches = [
        `https://html.duckduckgo.com/html/?q=site%3Atiktok.com%2F%40+${encoded}`,
        `https://html.duckduckgo.com/html/?q=site%3Ainstagram.com%2Freel+${encoded}`
    ];
    const pages = await Promise.allSettled(searches.map(url => axios.get(url, {
        timeout: 9000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AhmadMiniBot/1.0)' }
    })));
    return pages.flatMap(x => x.status === 'fulfilled' ? extractSocialLinks(x.value.data) : []);
}

async function findShort(query) {
    const q = String(query || '').trim();
    if (!q) throw new Error('Send a TikTok/Instagram link, song, poet, artist, or mood.');
    const key = q.toLowerCase();
    const cached = getRemembered(searchCache, key);
    if (cached) return cached;
    const direct = socialUrlFromQuery(q);
    const links = direct ? [direct] : await discoverSocialLinks(q);
    const normalizedLinks = links.map(url => url.replace(/\\u0026/g, '&')).filter(url => /tiktok\.com|instagram\.com/i.test(url));
    if (!normalizedLinks.length) throw new Error('No public TikTok/Instagram short found. Try a different song or mood.');
    const fresh = normalizedLinks.filter(url => !getRemembered(usedSources, url));
    const pool = fresh.length ? fresh : normalizedLinks;
    const selectedUrl = pool[Math.floor(Math.random() * pool.length)];
    remember(usedSources, selectedUrl, true, 30 * 60 * 1000);
    const out = { url: selectedUrl, title: q, author: '' };
    remember(searchCache, key, out, RESULT_TTL);
    return out;
}

function runProcess(command, args, timeoutMs = 90000) {
    return new Promise((resolve, reject) => {
        const p = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        p.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-5000); });
        const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('media processing timed out')); }, timeoutMs);
        p.on('error', e => { clearTimeout(timer); reject(e); });
        p.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(stderr || `process exited ${code}`)); });
    });
}

async function downloadSocialAudio(url, dir) {
    let audioUrl = null;
    if (/tiktok\.com/i.test(url)) {
        const res = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`, { timeout: 12000 });
        audioUrl = res.data?.data?.music;
    } else if (/instagram\.com/i.test(url)) {
        const methods = [
            async () => {
                const res = await axios.get(`https://api.vreden.my.id/api/igdl?url=${encodeURIComponent(url)}`, { timeout: 12000 });
                return res.data?.result?.data?.[0]?.url || res.data?.result?.[0]?.url;
            },
            async () => {
                const res = await axios.get(`https://api.vreden.my.id/api/igdownload?url=${encodeURIComponent(url)}`, { timeout: 12000 });
                return res.data?.result?.[0]?.url;
            },
            async () => {
                const res = await axios.post('https://api.cobalt.tools/', { url, downloadMode: 'audio' }, {
                    headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, timeout: 12000
                });
                return res.data?.url;
            }
        ];
        const results = await Promise.allSettled(methods.map(fn => fn()));
        audioUrl = results.find(x => x.status === 'fulfilled' && x.value)?.value;
    }
    if (!audioUrl) throw new Error('TikTok/Instagram source did not return audio');
    const response = await axios.get(audioUrl, {
        responseType: 'arraybuffer', timeout: 30000,
        maxContentLength: MAX_SOURCE_BYTES, maxBodyLength: MAX_SOURCE_BYTES,
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const input = path.join(dir, 'social-source.bin');
    await fsp.writeFile(input, Buffer.from(response.data));
    return input;
}

async function downloadAndRender(source, mode, query) {
    const dir = path.join(ROOT, `${Date.now()}-${hash(source.url + mode + query)}`);
    await fsp.mkdir(dir, { recursive: true });
    const output = path.join(dir, `${safeName(mode)}.mp3`);
    try {
        const downloaded = await downloadSocialAudio(source.url, dir);
        const modeArgs = {
            lofiwave: ['-af', 'lowpass=f=4200,highpass=f=90,aecho=0.8:0.7:65:0.22,volume=0.88'],
            reverbdrop: ['-af', 'aecho=0.8:0.72:75:0.32,acompressor=threshold=-18dB:ratio=2:attack=20:release=250,volume=0.9'],
            slowmood: ['-filter_complex', '[0:a]asetrate=44100*0.92,aresample=44100,atempo=1.087[sl];[sl]afade=t=in:st=0:d=0.15,afade=t=out:st=33:d=1,volume=0.9[out]', '-map', '[out]'],
            desivibe: ['-af', 'lowpass=f=6500,aecho=0.8:0.7:90:0.20,acompressor=threshold=-20dB:ratio=2,volume=0.88'],
            moodclip: ['-af', 'acompressor=threshold=-20dB:ratio=2.2:attack=15:release=180,afade=t=in:st=0:d=0.15,volume=0.9']
        }[mode] || [];
        await runProcess(ffmpegPath, ['-y', '-i', downloaded, '-t', String(MAX_SECONDS), '-vn', '-map_metadata', '-1', ...modeArgs, '-c:a', 'libmp3lame', '-b:a', '128k', output], 90000);
        const stat = await fsp.stat(output);
        if (!stat.size || stat.size > 12 * 1024 * 1024) throw new Error('output size exceeded safe limit');
        return { output, title: source.title, author: source.author, sourceUrl: source.url };
    } catch (e) {
        await cleanupDir(dir);
        throw e;
    }
}

const MODE_INFO = {
    lofiwave: { aliases: ['lofi', 'lofiaudio'], title: 'LOFI WAVE', emoji: '🌙', hint: 'soft lofi edit' },
    reverbdrop: { aliases: ['reverb', 'echodrop'], title: 'REVERB DROP', emoji: '🪐', hint: 'cinematic reverb edit' },
    slowmood: { aliases: ['slowvibe', 'slowedmood'], title: 'SLOW MOOD', emoji: '🕯️', hint: 'gentle slowed edit' },
    desivibe: { aliases: ['desiwave', 'pakvibe'], title: 'DESI VIBE', emoji: '🌷', hint: 'warm desi cinematic edit' },
    moodclip: { aliases: ['moodshort', 'shortsoul'], title: 'MOOD CLIP', emoji: '✨', hint: 'fresh random short edit' }
};

for (const [mode, info] of Object.entries(MODE_INFO)) {
    cmd({ pattern: mode, alias: info.aliases, desc: `Create a ${info.hint} from TikTok/Instagram`, category: 'download', react: info.emoji }, async (conn, mek, m, { from, args, reply }) => {
        const query = (args || []).join(' ').trim();
        if (!query) return reply(`> ${info.emoji} *${info.title}*\n> Send a TikTok/Instagram link, song, poet, artist, or mood.\n> Example: .${mode} Pakistani sad song`);
        const key = `${mode}:${query.toLowerCase()}`;
        if (activeKeys.has(key)) return reply('> ⏳ This edit is already being prepared. Please wait for the current one.');
        activeKeys.add(key);
        let result;
        try {
            result = await heavyQueue.run(async () => {
                await reply(`> ${info.emoji} *${info.title}*\n> Finding a fresh TikTok/Instagram short for: *${query}*…`);
                const source = await findShort(query);
                const rendered = await downloadAndRender(source, mode, query);
                await conn.sendMessage(from, { audio: fs.readFileSync(rendered.output), mimetype: 'audio/mpeg', ptt: false }, { quoted: mek });
                return rendered;
            }, position => reply(`> ⏳ Music Studio queue position: ${position}`));
            return reply(`> ✅ *${info.title} ready*\n> ${result.title}\n> ${MAX_SECONDS}s max short edit • TikTok/Instagram source • use authorised/public content only.`);
        } catch (e) {
            console.error(`[${mode}]`, e.message);
            return reply(`> ❌ ${info.title} failed: ${e.message}\n> Try another mood or send a direct TikTok/Instagram link.`);
        } finally {
            activeKeys.delete(key);
            if (result?.output) await cleanupDir(path.dirname(result.output));
        }
    });
}

module.exports = { findShort, downloadAndRender };
