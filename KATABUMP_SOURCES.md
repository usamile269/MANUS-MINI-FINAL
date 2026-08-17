# External deployment sources

The official KataBump upload guide says web uploads require a ZIP under 100 MB, the archive must include `package.json`, it must be unarchived on the server, and the entrypoint is configured in the Startup tab: https://docs.katabump.com/launch-your-bot/upload-via-web

The official environment-variable guide says Node.js projects are installed from a root `package.json`, and the JS entrypoint is configured in Startup settings: https://docs.katabump.com/launch-your-bot/environment-variables

The official FAQ recommends Node.js 18.x or 20.x LTS, requires `package.json` and an entrypoint, and documents MongoDB Atlas as an external database option: https://docs.katabump.com/faq
