'use strict';

// Opt-in worker runtime. In standalone mode this module is inert.
const axios = require('axios');

const enabled = String(process.env.WORKER_MODE || 'standalone').toLowerCase() === 'cluster';
const workerId = process.env.WORKER_ID || `worker-${process.env.WORKER_INDEX || '0'}`;
const workerIndex = Math.max(0, Number.parseInt(process.env.WORKER_INDEX || '0', 10) || 0);
const workerCount = Math.max(1, Number.parseInt(process.env.WORKER_COUNT || '1', 10) || 1);
const capacity = Math.max(1, Number.parseInt(process.env.WORKER_CAPACITY || '20', 10) || 20);
const controlPlaneUrl = String(process.env.CONTROL_PLANE_URL || '').replace(/\/$/, '');
const controlPlaneToken = process.env.CONTROL_PLANE_TOKEN || '';
const publicUrl = String(process.env.WORKER_PUBLIC_URL || '').replace(/\/$/, '');
const workerApiKey = process.env.WORKER_API_KEY || process.env.PAIR_API_KEY || '';
let heartbeatTimer = null;

function hashNumber(number) {
    const digits = String(number || '').replace(/\D/g, '');
    let hash = 2166136261;
    for (const char of digits) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % workerCount;
}

function ownsNumber(number) {
    return !enabled || hashNumber(number) === workerIndex;
}

function authHeaders() {
    return controlPlaneToken ? { Authorization: `Bearer ${controlPlaneToken}` } : {};
}

async function register(getSnapshot) {
    if (!enabled || !controlPlaneUrl) return;
    await axios.post(`${controlPlaneUrl}/workers/register`, {
        workerId,
        workerIndex,
        workerCount,
        capacity,
        publicUrl,
        workerApiKey,
        ...getSnapshot()
    }, { timeout: 10000, headers: authHeaders() });
}

async function heartbeat(getSnapshot) {
    if (!enabled || !controlPlaneUrl) return;
    await axios.post(`${controlPlaneUrl}/workers/heartbeat`, {
        workerId,
        workerIndex,
        workerCount,
        capacity,
        publicUrl,
        ...getSnapshot()
    }, { timeout: 10000, headers: authHeaders() });
}

function start(getSnapshot) {
    if (!enabled) return;
    if (!controlPlaneUrl) {
        console.error('[WORKER] WORKER_MODE=cluster but CONTROL_PLANE_URL is missing; staying isolated.');
        return;
    }
    const safeSnapshot = () => {
        try { return getSnapshot() || {}; } catch (_) { return {}; }
    };
    register(safeSnapshot).catch(e => console.error('[WORKER] register failed:', e.message));
    heartbeatTimer = setInterval(() => {
        heartbeat(safeSnapshot).catch(e => console.error('[WORKER] heartbeat failed:', e.message));
    }, 15000);
    heartbeatTimer.unref?.();
}

function stop() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
}

function getInfo() {
    return { enabled, workerId, workerIndex, workerCount, capacity, controlPlaneUrl, publicUrl };
}

module.exports = { enabled, workerId, workerIndex, workerCount, capacity, ownsNumber, start, stop, getInfo, workerApiKey };
