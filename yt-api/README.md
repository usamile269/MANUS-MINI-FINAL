# BUNTY YT API

Ahmad's own YouTube downloader API for the Ahmad Mini WhatsApp bot — built
because the third-party APIs it used (Adeel, Jawad) died. Runs `yt-dlp` on
the server and returns direct media URLs in the same response shape as
Adeel's API, so the bot needs only a base-URL change.

## Endpoints

- `GET /health` → `{ ok: true, service: "BUNTY YT API" }`
- `GET /api/ytmp3?url=<youtube url>` → `{ status: true, result: { title, audio_download, quality, ext } }`
- `GET /api/ytmp4v2?url=<youtube url>` → `{ status: true, result: { title, video_download, quality, ext } }`
  (`/api/ytmp4` is an alias.)

## Deploy (Railway)

1. Create a service from this repo/folder (root directory = this folder if
   it lives inside a bigger repo).
2. Railway builds the included `Dockerfile` (Node + yt-dlp + ffmpeg).
3. Add a public domain; no env vars are required (`PORT` is provided).

## Cookies (optional, fixes YouTube bot-check)

If YouTube starts blocking the host's IP ("Sign in to confirm you're not a
bot"), export a `cookies.txt` (Netscape format) from a logged-in YouTube
session in a browser and place it next to `server.js` **on the server only**.
It is picked up automatically on the next request. Never commit it to git —
it is already in `.gitignore`.
