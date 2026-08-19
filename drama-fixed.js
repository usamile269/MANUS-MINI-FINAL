'use strict';

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
const yts = require('yt-search');
const { cmd } = require('../inconnuboy');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const YTDLP_BIN = path.join(BIN_DIR, `yt-dlp${process.platform === 'win32' ? '.exe' : ''}`);
const MAX_BYTES = 45 * 1024 * 1024;
const MAX_SECONDS = 180;
const DOWNLOAD_TIMEOUT_MS = 120000;
let binaryPromise;

function cleanTitle(value) {
    return String(value || 'Ahmad Mini Drama')
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90) || 'Ahmad Mini Drama';
}

function isYouTubeUrl(value) {
    try {
        const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
        return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
    } catch (_) {
        return false;
    }
}

async function ensureYtDlp() {
    if (fs.existsSync(YTDLP_BIN)) return YTDLP_BIN;
    if (!binaryPromise) {
        binaryPromise = (async () => {
            await fs.ensureDir(BIN_DIR);
            await YTDlpWrap.downloadFromGithub(YTDLP_BIN);
            await fs.chmod(YTDLP_BIN, 0o755);
            return YTDLP_BIN;
        })().catch(error => {
            binaryPromise = null;
            throw error;
        });
    }
    return binaryPromise;
}

function runYtDlp(bin, args, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let stdout = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('yt-dlp timed out'));
        }, timeoutMs);
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => {
            clearTimeout(timer);
            if (code === 0) return resolve({ stdout, stderr });
            reject(new Error((stderr || `yt-dlp exited with code ${code}`).trim().slice(-1200)));
        });
    });
}

async function findVideo(query) {
    if (isYouTubeUrl(query)) {
        return { url: query, title: 'YouTube Drama', thumbnail: '', author: { name: 'YouTube' }, timestamp: '' };
    }
    const result = await yts(`${query} drama scene short clip`);
    const video = result && result.videos && result.videos[0];
    if (!video || !video.url) throw new Error('No YouTube result found for that title');
    return video;
}

async function downloadDrama(videoUrl, outPath) {
    const bin = await ensureYtDlp();
    const args = [
        videoUrl,
        '--no-playlist',
        '--no-warnings',
        '--ignore-config',
        '--restrict-filenames',
        '--max-filesize', '45M',
        '--socket-timeout', '30',
        '--retries', '2',
        '--fragment-retries', '2',
        '--concurrent-fragments', '2',
        '--extractor-args', 'youtube:player_client=android,web',
        '-f', 'bv*[height<=480]+ba/b[height<=480]/b',
        '--merge-output-format', 'mp4',
        '--print', 'after_move:filepath',
        '-o', outPath
    ];
    const result = await runYtDlp(bin, args);
    const printedPath = result.stdout.split(/\r?\n/).map(x => x.trim()).filter(Boolean).pop();
    const actualPath = printedPath && fs.existsSync(printedPath) ? printedPath : outPath;
    if (!fs.existsSync(actualPath)) throw new Error('yt-dlp produced no file');
    const stat = await fs.stat(actualPath);
    if (stat.size < 10000) throw new Error('Downloaded file is empty');
    if (stat.size > MAX_BYTES) throw new Error('Drama file is larger than 45 MB');
    return actualPath;
}

cmd({
    pattern: 'drama',
    alias: ['ep', 'episode'],
    desc: 'Download a YouTube drama clip as an MP4 document',
    category: 'download',
    react: '📺',
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    if (!q) return reply('🎥 Give a YouTube title or URL.\n\nExample: .drama kabhi main kabhi tum ep5');

    let filePath = null;
    try {
        const video = await findVideo(q.trim());
        const title = cleanTitle(video.title);
        filePath = path.join(os.tmpdir(), `ahmad-drama-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);

        if (video.thumbnail) {
            await conn.sendMessage(from, {
                image: { url: video.thumbnail },
                caption: `🎬 *DRAMA DOWNLOADER*\n\n*Title:* ${title}\n*Channel:* ${video.author?.name || 'YouTube'}\n\nDownloading…`
            }, { quoted: mek }).catch(() => {});
        }

        const actualPath = await downloadDrama(video.url, filePath);
        await conn.sendMessage(from, {
            document: fs.createReadStream(actualPath),
            fileName: `${title}.mp4`,
            mimetype: 'video/mp4',
            caption: `🎬 *${title}*\n\n© AHMAD MINI`
        }, { quoted: mek });
        await conn.sendMessage(from, { react: { text: '✅', key: m.key } }).catch(() => {});
    } catch (error) {
        console.error('[DRAMA] download failed:', error.message);
        const blocked = /sign in|not a bot|captcha|403|timed out/i.test(error.message);
        await reply(blocked
            ? '⚠️ YouTube blocked this server request right now. Send a direct YouTube link or try again later.'
            : '❌ Drama download failed. Try another title or a shorter YouTube clip.');
        await conn.sendMessage(from, { react: { text: '❌', key: m.key } }).catch(() => {});
    } finally {
        if (filePath) await fs.remove(filePath).catch(() => {});
    }
});

module.exports = { findVideo, downloadDrama };
