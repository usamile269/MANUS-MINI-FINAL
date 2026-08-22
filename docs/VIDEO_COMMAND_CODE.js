/*
 * Ahmad Mini — VERIFIED WORKING .video CODE
 *
 * Source of truth in production:
 *   plugins/downloaders.js
 *
 * This standalone file is a reference export of the provider fallback and
 * command handler. It depends on the existing helpers/imports in downloaders.js.
 * Do not paste it as a second plugin registration.
 */

async function raceVideoMedia(videoUrl) {
    // Resolve and fetch within the same attempt. If the first provider returns
    // an expired or rate-limited media URL, the next provider must still run.
    const providers = [
        { name: 'JawadTech', resolve: async () => (await getJawadTechResult(videoUrl)).mp4 },
        { name: 'AdeelXTech', resolve: async () => getAdeelXtechVideoLink(videoUrl) },
        { name: 'EliteProTech', resolve: async () => getEliteProTechVideoLink(videoUrl) }
    ];
    const attempts = providers.map(async ({ name, resolve }) => {
        const link = await resolve();
        if (!link) throw new Error(`${name}: no usable link`);
        try {
            return await fetchMediaBuffer(link, MAX_QUICKAPI_VIDEO_BYTES, 60000);
        } catch (error) {
            throw new Error(`${name}: ${error.message}`);
        }
    });
    try { return await Promise.any(attempts); }
    catch (error) {
        throw new Error((error.errors || []).map(item => item.message).join(' | ') || 'All video providers failed');
    }
}

cmd({
    pattern: 'ytmp4',
    alias: ['video', 'yta', 'ytv'],
    desc: 'Download YouTube as MP4',
    category: 'download',
    react: '🎬'
}, async (conn, mek, m, { reply, args, from }) => {
    const query = args.join(' ').trim();
    if (!query) return reply(dlBox('YOUTUBE MP4', [
        '❌ Video name or YouTube link required',
        '📝 .video <name or link>'
    ], '🎬'));
    if (!YTDlpWrapLib) return reply('❌ yt-dlp is unavailable on this server.');

    let outPath;
    try {
        await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
        const started = Date.now();
        const video = await ytSearch(query);

        try {
            await heavyQueue.run(async () => {
                const buffer = await raceVideoMedia(video.url);
                await sendWithRetry(conn, from, {
                    video: buffer,
                    mimetype: 'video/mp4',
                    caption: dlBox('YOUTUBE MP4', [
                        `🎬 ${video.title?.slice(0, 60)}`,
                        '✅ Downloaded'
                    ], '🎬'),
                    contextInfo: chanCtx()
                }, { quoted: fakevCard });
                await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
            }, async position => {
                await replyWithRetry(conn, from, mek, `⏳ Download queue position: #${position}`);
            });
            console.log(`[YTMP4] shared provider completed in ${Date.now() - started}ms`);
            return;
        } catch (e) {
            console.log('[YTMP4] shared provider failed:', e.message);
        }

        outPath = path.join('/tmp', `ytvideo_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
        await heavyQueue.run(async () => {
            await dlVideo(video.url, outPath);
            if (!fs.existsSync(outPath)) throw new Error('No video file produced');
            if (fs.statSync(outPath).size > 100 * 1024 * 1024) {
                throw new Error('Video too large (100 MB limit)');
            }
            await sendWithRetry(conn, from, {
                video: fs.readFileSync(outPath),
                mimetype: 'video/mp4',
                caption: dlBox('YOUTUBE MP4', [
                    `🎬 ${video.title?.slice(0, 60)}`,
                    '✅ Downloaded'
                ], '🎬'),
                contextInfo: chanCtx()
            }, { quoted: fakevCard });
            try { fs.unlinkSync(outPath); } catch {}
            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
        }, async position => {
            await replyWithRetry(conn, from, mek, `⏳ Download queue position: #${position}`);
        });
    } catch (e) {
        try { if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
        await conn.sendMessage(from, { react: { text: '❌', key: mek.key } }).catch(() => {});
        console.log('[YTMP4 FINAL ERROR]', e.message);
        if (String(e.message).startsWith('YTSEARCH_FAILED')) {
            return replyWithRetry(conn, from, mek,
                '❌ YouTube search failed. Paste a direct YouTube link and try again.');
        }
        return replyWithRetry(conn, from, mek,
            /too large/i.test(e.message)
                ? '❌ Video is over the 100MB limit.'
                : '❌ Download failed. Try a direct YouTube link or a shorter video.');
    }
});
