# Ahmad Mini multi-worker foundation

This layer is **opt-in**. With no `WORKER_MODE=cluster`, the existing bot remains in standalone mode and follows the current startup, pairing, command, and session paths.

## What this adds

- `cluster/worker-runtime.js`: stable number sharding and control-plane heartbeat.
- `cluster/control-plane.js`: worker registry, live capacity view, least-loaded assignment, and pairing-code proxy.
- `pair.html`: worker selector is hidden unless `PAIR_CONTROL_URL` is configured.
- `main.js`: cluster workers only auto-reconnect numbers owned by their shard and reject pairing requests routed to the wrong shard.

## Standalone mode (current behavior)

Do not set `WORKER_MODE`, or set:

```env
WORKER_MODE=standalone
```

No control-plane or Redis service is needed. This is the rollback switch.

## Cluster deployment

Use a separate control-plane service and multiple copies of the existing bot. MongoDB is required for the registry; do not use local JSON storage for a multi-worker deployment.

### Control plane environment

```env
NODE_ENV=production
CONTROL_PLANE_PORT=8090
CONTROL_PLANE_TOKEN=replace-with-a-long-random-secret
MONGODB_URI=mongodb+srv://...
```

Start it from the repository root:

```bash
node cluster/control-plane.js
```

Expose it over HTTPS. The pairing site must point `PAIR_CONTROL_URL` to this HTTPS URL before publishing the updated `pair.html`.

### Each worker environment

Every worker uses the existing `index.js` entry point and gets a unique index:

```env
WORKER_MODE=cluster
WORKER_ID=worker-01
WORKER_INDEX=0
WORKER_COUNT=100
WORKER_CAPACITY=20
WORKER_PUBLIC_URL=https://worker-01.example.com
CONTROL_PLANE_URL=https://control.example.com
CONTROL_PLANE_TOKEN=replace-with-the-same-secret
WORKER_API_KEY=worker-specific-api-key
PAIR_API_KEY=worker-specific-api-key
MONGODB_URI=mongodb+srv://...
```

For worker 02 use `WORKER_INDEX=1`, and so on. `WORKER_COUNT` and the index must be identical across all workers. The current shard function assigns each number deterministically, so a restart does not randomly move a number between workers.

If using 100 workers at 20 numbers each, the theoretical capacity is 2,000. For 3,000 numbers, use at least 150 workers at capacity 20, plus spare capacity. Treat these as planning figures, not a WhatsApp guarantee.

## Pairing flow

1. Pairing site calls `GET /workers` on the control plane.
2. It shows each live worker's `connected/capacity` count.
3. Auto assign chooses the stable shard first, then the least-loaded live worker if the shard is unavailable.
4. Control plane proxies `/code` to that worker.
5. The worker validates ownership before generating the code.

Set in `pair.html` only after control-plane deployment:

```js
const PAIR_CONTROL_URL = 'https://control.example.com';
```

Until that value is changed, the site continues using the existing backend URL and current pairing flow.

## Rollout and rollback

1. Deploy the control plane with **zero workers** and verify `/health` and `/workers`.
2. Deploy one worker with `WORKER_INDEX=0`, `WORKER_COUNT=1`, and 3–5 test numbers.
3. Run for at least one full reconnect cycle and verify `/workers` counts.
4. Add workers gradually; do not start every worker at once.
5. Publish the pairing page only after worker routing works.
6. If any issue appears, set every bot back to `WORKER_MODE=standalone` and restore `PAIR_CONTROL_URL=''`. Existing commands and current pairing route then remain the active path.

## Operational requirements

- Keep one assignment owner per number; never run the same session on two workers.
- Use HTTPS and long random tokens for control-plane and worker API calls.
- Use a real MongoDB deployment with indexes on `workerId` and `number`.
- Add monitoring for worker heartbeat age, RSS, reconnect loops, and pairing failures.
- Stagger worker restarts; reconnecting thousands of sessions simultaneously is unsafe and can trigger provider throttling.
- This scales connection management; it does not bypass WhatsApp limits or authorize bulk messaging.
