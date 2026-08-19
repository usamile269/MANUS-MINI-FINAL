'use strict';

// Ahmad Mini Music Short Studio
// Separate from .play, .video and .poetry: bounded downloads, short output,
// automatic cleanup, and no permanent media library.
const { cmd } = require('../ahmad-core');
const yts = require('yt-search');
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

async function findShort(query) {
    const q = String(query || '').trim();
    if (!q) throw new Error('Tell me a song, poet, artist, or mood.');
    const key = q.toLowerCase();
    const cached = getRemembered(searchCache, key);
    if (cached) return cached;
    const searches = [
        `${q} short audio`,
        `${q} lofi short`,
        `${q} viral edit`
    ];
    const all = [];
    for (const term of searches) {
        const result = await yts(term);
        for (const v of (result.videos || []).slice(0, 5)) {
            if (!v.url || !v.seconds || v.seconds > 12 * 60) continue;
            if (!all.some(x => x.url === v.url)) all.push(v);
        }
        if (all.length >= 8) break;
    }
    if (!all.length) throw new Error('No short public result found. Try another name or mood.');
    const fresh = all.filter(v => !getRemembered(usedSources, v.url));
    const pool = fresh.length ? fresh : all;
    const selected = pool[Math.floor(Math.random() * pool.length)];
    remember(usedSources, selected.url, true, 30 * 60 * 1000);
    const out = { url: selected.url, title: selected.title || q, author: selected.author?.name || '', seconds: selected.seconds || 0 };
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

async function resolveYtDlp() {
    const local = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    if (fs.existsSync(local)) return local;
    return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

async function downloadAndRender(source, mode, query) {
    const dir = path.join(ROOT, `${Date.now()}-${hash(source.url + mode + query)}`);
    await fsp.mkdir(dir, { recursive: true });
    const input = path.join(dir, 'source.%(ext)s');
    const raw = path.join(dir, 'source.mp3');
    const output = path.join(dir, `${safeName(mode)}.mp3`);
    try {
        const ytdlp = await resolveYtDlp();
        await runProcess(ytdlp, [
            '--no-playlist', '--no-part', '--no-warnings', '--max-filesize', `${MAX_SOURCE_BYTES}`,
            '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '128K',
            '--ffmpeg-location', ffmpegPath, '-o', input, source.url
        ], 100000);
        const downloaded = fs.existsSync(raw) ? raw : (await fsp.readdir(dir)).map(x => path.join(dir, x)).find(x => /\.(mp3|m4a|webm|opus)$/i.test(x));
        if (!downloaded) throw new Error('audio source was not created');
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
        return { output, title: source.title, author: source.author };
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
    cmd({ pattern: mode, alias: info.aliases, desc: `Create a ${info.hint} from a public search`, category: 'download', react: info.emoji }, async (conn, mek, m, { from, args, reply }) => {
        const query = (args || []).join(' ').trim();
        if (!query) return reply(`> ${info.emoji} *${info.title}*\n> Send a song, poet, artist, or mood.\n> Example: .${mode} Pakistani sad song`);
        const key = `${mode}:${query.toLowerCase()}`;
        if (activeKeys.has(key)) return reply('> ⏳ This edit is already being prepared. Please wait for the current one.');
        activeKeys.add(key);
        let result;
        try {
            result = await heavyQueue.run(async () => {
                await reply(`> ${info.emoji} *${info.title}*\n> Finding a fresh short for: *${query}*…`);
                const source = await findShort(query);
                const rendered = await downloadAndRender(source, mode, query);
                await conn.sendMessage(from, { audio: fs.readFileSync(rendered.output), mimetype: 'audio/mpeg', ptt: false }, { quoted: mek });
                return rendered;
            }, position => reply(`> ⏳ Music Studio queue position: ${position}`));
            return reply(`> ✅ *${info.title} ready*\n> ${result.title}${result.author ? `\n> ${result.author}` : ''}\n> ${MAX_SECONDS}s max short edit • use authorised/public content only.`);
        } catch (e) {
            console.error(`[${mode}]`, e.message);
            return reply(`> ❌ ${info.title} failed: ${e.message}\n> Try a shorter name or a direct authorised link.`);
        } finally {
            activeKeys.delete(key);
            // Remove the temporary render after the send has completed.
            if (result?.output) await cleanupDir(path.dirname(result.output));
        }
    });
}

module.exports = { findShort, downloadAndRender };
