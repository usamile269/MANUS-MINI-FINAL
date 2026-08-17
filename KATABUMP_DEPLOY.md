# MANUS MINI FINAL — KataBump Deployment

This package is prepared for KataBump’s Node.js web upload workflow. Upload the ZIP from the control panel’s **Files** tab, unarchive it in the server root, and ensure `package.json`, `package-lock.json`, and `index.js` are directly in that root rather than inside an extra nested folder.

## Startup settings

Set the JavaScript entrypoint to `index.js`. The package also contains `start.sh`, which runs `node index.js` if the panel provides a custom startup command. Use Node.js **20.x LTS** or **18.x LTS**. KataBump should install dependencies automatically from `package.json`; the included lockfile is present for reproducibility.

## Runtime checks

The HTTP health endpoint is `/health`. The bot binds to the panel-provided `PORT` automatically and returns a JSON health response after the latest build is running. The bot uses MongoDB Atlas for persistence and Baileys for WhatsApp sessions. Keep the process running continuously and inspect the console for the restored-session message.

## Deployment notes

Do not upload `.git`, `node_modules`, test files, or temporary files. Keep the ZIP under KataBump’s 100 MB web-upload limit. If a deployment fails, confirm that the archive was unarchived and that `package.json` is at the server root, then restart after dependency installation completes.

The commands preserved in this build include the working `.play` path, the optimized `.video` path, the rebuilt `.sim` parser, the public TikTok profile implementation, and the audited AI/provider fallbacks.
