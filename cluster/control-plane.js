'use strict';

// Run separately from the existing bot: node cluster/control-plane.js
// Requires MongoDB for safe multi-process assignment. It never changes the
// current bot when it is not started.
const express = require('express');
const axios = require('axios');
const storage = require('../lib/mongo');

const app = express();
app.use(express.json({ limit: '64kb' }));
const port = Number(process.env.CONTROL_PLANE_PORT || process.env.PORT || 8090);
const token = process.env.CONTROL_PLANE_TOKEN || '';
const ttlMs = Math.max(30000, Number(process.env.WORKER_TTL_MS || 45000));
const Worker = storage.model('WorkerRegistry');

function cleanNumber(value) { return String(value || '').replace(/\D/g, ''); }
function shardIndex(number, workerCount) {
    let hash = 2166136261;
    for (const char of cleanNumber(number)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % Math.max(1, workerCount);
}
function authorized(req) {
    if (!token) return true;
    const header = String(req.headers.authorization || '');
    return header === `Bearer ${token}`;
}
function workerIsLive(worker) {
    return worker && worker.status !== 'offline' && Date.now() - new Date(worker.lastHeartbeat || 0).getTime() < ttlMs;
}
async function liveWorkers() {
    const all = await Worker.find({});
    return all.filter(workerIsLive).map(w => ({
        workerId: w.workerId,
        workerIndex: Number(w.workerIndex) || 0,
        workerCount: Number(w.workerCount) || 1,
        status: 'online',
        capacity: Number(w.capacity) || 20,
        connected: Number(w.connected) || 0,
        available: Math.max(0, (Number(w.capacity) || 20) - (Number(w.connected) || 0)),
        publicUrl: w.publicUrl || null,
        lastHeartbeat: w.lastHeartbeat
    }));
}
function workerHeaders(worker) {
    return worker.workerApiKey ? { 'x-api-key': worker.workerApiKey } : {};
}

app.get('/health', async (_req, res) => {
    res.json({ ok: true, service: 'ahmad-control-plane', workers: (await liveWorkers()).length });
});

app.get('/workers', async (_req, res) => {
    try {
        const workers = await liveWorkers();
        res.set('Cache-Control', 'no-store');
        res.json({ clusterEnabled: true, totalWorkers: workers.length, workers });
    } catch (e) { res.status(503).json({ clusterEnabled: false, error: 'Worker registry unavailable' }); }
});

app.post('/workers/register', async (req, res) => {
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { workerId, workerIndex, workerCount, capacity, publicUrl, workerApiKey, connected = 0 } = req.body || {};
    if (!workerId) return res.status(400).json({ error: 'workerId required' });
    await Worker.findOneAndUpdate({ workerId: String(workerId) }, {
        workerId: String(workerId), workerIndex: Number(workerIndex) || 0,
        workerCount: Math.max(1, Number(workerCount) || 1), capacity: Math.max(1, Number(capacity) || 20),
        publicUrl: String(publicUrl || '').replace(/\/$/, ''), workerApiKey: String(workerApiKey || ''),
        connected: Math.max(0, Number(connected) || 0), status: 'online', lastHeartbeat: new Date().toISOString()
    }, { upsert: true });
    res.json({ ok: true, workerId });
});

app.post('/workers/heartbeat', async (req, res) => {
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { workerId, connected = 0, capacity, publicUrl, workerIndex, workerCount } = req.body || {};
    if (!workerId) return res.status(400).json({ error: 'workerId required' });
    await Worker.findOneAndUpdate({ workerId: String(workerId) }, {
        status: 'online', lastHeartbeat: new Date().toISOString(), connected: Math.max(0, Number(connected) || 0),
        ...(capacity ? { capacity: Math.max(1, Number(capacity)) } : {}),
        ...(publicUrl ? { publicUrl: String(publicUrl).replace(/\/$/, '') } : {}),
        ...(workerIndex !== undefined ? { workerIndex: Number(workerIndex) || 0 } : {}),
        ...(workerCount !== undefined ? { workerCount: Math.max(1, Number(workerCount) || 1) } : {})
    }, { upsert: true });
    res.json({ ok: true });
});

app.get('/status', async (_req, res) => {
    const workers = await liveWorkers();
    res.json({ totalWorkers: workers.length, totalCapacity: workers.reduce((n, w) => n + w.capacity, 0), connected: workers.reduce((n, w) => n + w.connected, 0), workers });
});

async function chooseWorker(number, requestedId) {
    const workers = await liveWorkers();
    if (requestedId) {
        const requested = workers.find(w => w.workerId === requestedId);
        if (requested && requested.available > 0) return requested;
    }
    // Prefer the stable hash shard when its worker is live and has room.
    const digits = cleanNumber(number);
    if (digits && workers.length) {
        const index = shardIndex(digits, Math.max(1, workers[0].workerCount));
        const shard = workers.find(w => w.workerIndex === index && w.available > 0);
        if (shard) return shard;
    }
    return workers.filter(w => w.available > 0).sort((a, b) => (a.connected / a.capacity) - (b.connected / b.capacity))[0] || null;
}

app.get('/code', async (req, res) => {
    const number = cleanNumber(req.query.number);
    if (!number) return res.status(400).json({ error: 'Number required' });
    const worker = await chooseWorker(number, req.query.workerId);
    if (!worker) return res.status(503).json({ status: 'no_worker_capacity', message: 'No online worker has an available slot.' });
    if (!worker.publicUrl) return res.status(503).json({ status: 'worker_not_routable', message: 'Selected worker has no public URL.' });
    try {
        const response = await axios.get(`${worker.publicUrl}/code`, {
            params: { number, _pairing_request: Date.now() }, headers: workerHeaders(worker), timeout: 30000, validateStatus: () => true
        });
        res.status(response.status).set('Cache-Control', 'no-store').json({ ...response.data, workerId: worker.workerId });
    } catch (e) { res.status(502).json({ status: 'worker_unreachable', workerId: worker.workerId, message: e.message }); }
});

app.listen(port, async () => {
    if (!storage.isMongoConfigured) console.error('[CONTROL] MONGODB_URI is required for safe multi-worker assignment.');
    else await storage.ensureConnected();
    console.log(`[CONTROL] listening on ${port}`);
});
