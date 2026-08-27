const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'movie-drama.js'), 'utf8');

assert.match(source, /const yts = require\('yt-search'\);/);
assert.match(source, /const \{ pipeline \} = require\('stream\/promises'\);/);
assert.match(source, /async function searchDramaYouTube\(query\)/);
assert.match(source, /if \(direct\) return \[\{ url: query, title: query \}\];/);
assert.match(source, /const preferred = videos\.filter\(video => Number\(video\.seconds\) <= DRAMA_PREFERRED_SECONDS\);/);
assert.match(source, /jawad-tech\.vercel\.app\/download\/ytdl/);
assert.match(source, /adeel-xtech-apis\.vercel\.app\/api\/ytmp4/);
assert.match(source, /await pipeline\(response\.data, fs\.createWriteStream\(output\)\);/);
assert.match(source, /const media = await downloadDramaFromYouTube\(query, dir\);/);
assert.match(source, /document: fs\.createReadStream\(media\.file\)/);
assert.match(source, /Direct yt-dlp remains the last fallback/);
assert.ok(source.indexOf('const candidates = await searchDramaYouTube(query);') < source.indexOf('const bin = await ensureDramaYtDlp();'), 'provider fallback must precede yt-dlp bootstrap');

console.log('drama command regression: PASS');
