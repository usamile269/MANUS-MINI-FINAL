# Ahmad Mini — `.video` Stability Log

> **Status: VERIFIED WORKING / NO-TOUCH PROTECTED**

This record documents the verified `.video` implementation so future maintenance does not accidentally replace or weaken its working download path.

## Protected scope

The protected command is defined in `plugins/downloaders.js`:

```text
.video
.ytmp4
.yta
.ytv
```

The `.play` and `.poetry` implementations are separate and must not be modified as part of future `.video` maintenance.

## Verified root cause

The previous implementation used `Promise.any()` to select the first provider URL and only fetched the media after that selection. When the selected CDN URL was expired, rate-limited, or returned an invalid response, the command stopped immediately and did not try the remaining providers. The user therefore received:

```text
❌ Download failed. Try a direct YouTube link or a shorter video.
```

## Permanent fix

The repaired `raceVideoMedia()` function performs provider resolution and the actual MP4 fetch inside the same provider attempt. Each provider is now independently responsible for returning a usable media buffer. If one provider fails during either URL resolution or media download, `Promise.any()` continues with the other providers.

Current provider order:

| Provider | Purpose | Failure behavior |
|---|---|---|
| JawadTech | Fast YouTube MP4 URL | Falls through if rate-limited, empty, expired, or media fetch fails |
| AdeelXTech | Secondary active YouTube MP4 provider | Used automatically when the first provider fails |
| EliteProTech | Additional fallback | Used when earlier providers fail |

The media fetch remains bounded by the existing `MAX_QUICKAPI_VIDEO_BYTES` limit and validates the response as HTTP 200/206 with a minimum payload size. The command still sends the actual MP4 buffer to WhatsApp, preserving the previously working delivery behavior.

## Verification evidence

The active AdeelXTech endpoint returned a valid response for a public YouTube URL, including a `video_download` URL. The returned CDN URL was fetched successfully with:

```text
HTTP: 206
Content-Type: video/mp4
Payload: 11,829,048 bytes
MP4 signature: ftypmp42
```

Repository validation passed:

```text
node --check plugins/downloaders.js       PASS
npm run check                              PASS
74/74 plugin files loaded successfully
117 relative require paths resolved
```

The protected media command files were not changed by the `.video` fallback repair except for the intended `plugins/downloaders.js` provider-fallback function.

## Deployment record

```text
Git commit: 70d5f6790306202a895906cbbd8e67a42f9511b2
Commit: Make video provider fallback reliable
Railway service: web-production-d0274.up.railway.app
Deployment health: healthy
```

The repair was committed and pushed to the GitHub production branch. MongoDB sessions, pairing data, mode settings, admin routes, `.play`, and `.poetry` were not deleted or modified by this repair.

## Future no-touch rule

Do not replace the current `.video` provider race with a single-provider implementation. Do not remove the fetch-time fallback. If a provider changes, update only its resolver or add a new provider to the same resolve-and-fetch cascade, then run the repository health check and verify an actual MP4 response before deployment.

A future change to `.video` must include a new entry in this log with the commit hash, provider response, MP4 validation result, and Railway health result.
