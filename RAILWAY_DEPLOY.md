# Railway deployment

This repository is configured to deploy with the included `Dockerfile` and `railway.json`. Railway can start the service without manually defining environment variables; `/health` is available immediately and the WhatsApp pairing route is served by the app.

## Important persistence note

Without `MONGODB_URI` or a Railway persistent volume, local JSON data and paired WhatsApp session data can be lost when Railway replaces the container. For a durable production bot, add a MongoDB connection string as a Railway variable or attach a persistent volume mounted at `/app/database`. This is a platform persistence requirement, not a startup requirement.

## Pairing

After deployment, use the app's pairing endpoint/page to connect the WhatsApp number. Keep `PAIR_API_KEY` empty only if the pairing endpoint is intentionally public; otherwise set it in Railway.
