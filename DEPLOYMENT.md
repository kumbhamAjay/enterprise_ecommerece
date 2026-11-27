# Running and deploying ShopEasy

## Everything in Docker (local)
```
docker compose up --build        # shop http://localhost:5001 · API docs http://localhost:5000/api/docs
docker compose down              # stop (data stays in the pgdata / redisdata volumes); add -v to wipe it
```
Five containers: `postgres` (schema loaded on first start from `backend/db/schema.sql`), `redis` (`noeviction`, required by BullMQ), `api`, `worker` (same image, `node dist/worker.js`), `web` (Next.js standalone).
Third-party keys come from `backend/.env`; the compose file overrides `DATABASE_URL`, `REDIS_URL`, `APP_URL`, so it never touches Supabase.
Create an admin: `docker compose exec api node dist/scripts/createAdmin.js <email> <password> SUPER_ADMIN`.

## Images
- Multi-stage builds: compile in one stage, ship only `dist/` + production dependencies. Runs as the non-root `node` user, `node` is PID 1 (receives SIGTERM, so shutdown is graceful).
- Layer order puts `package*.json` + `npm ci` before the source, so a code change doesn't reinstall dependencies.
- The frontend bakes the API address into its `/api` rewrite **at build time** (`--build-arg API_URL=...`).

## Health, logs, shutdown
- `GET /api/health`: liveness (process is up). `GET /api/ready`: readiness (database answers; Redis state is reported but never fails it, the app works without Redis). Use ready for load-balancer / orchestrator probes.
- Logs are JSON lines on stdout (pino): one per request with a request id (also the `X-Request-Id` response header; send your own to trace across services). `Authorization`, cookies, Stripe signatures and query strings are never logged. `LOG_LEVEL` controls verbosity. Collect with whatever the platform provides (stdout is the contract).
- SIGTERM: stop accepting connections, finish in-flight requests, close workers/Redis/pool, exit 0 (forced exit after 10 s).

## CI (`.github/workflows/ci.yml`)
Pull requests and pushes to `main`/`development`: backend typecheck + the full test suite against a fresh Postgres 16 and Redis 7 (schema from `db/schema.sql`); frontend typecheck + build; both Docker images build. No real secrets are needed or used.

## Production checklist
| Concern | Do |
|---|---|
| Secrets | Platform secret store, never the image or the repo. Required: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`. Features: Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), `RESEND_API_KEY` + `EMAIL_FROM` (verified domain), Cloudinary, `BULL_BOARD_PASSWORD`. Set `APP_URL` to the public shop URL (email links). |
| Database | Managed Postgres, `PG_POOL_MAX` x instances below the server's connection limit. Schema changes: `db/schema.sql` is idempotent (`IF NOT EXISTS`), run it before starting a new version. There is no migration tool yet: before real traffic adopt one (e.g. node-pg-migrate) so changes are versioned and reversible. |
| Redis | Two instances: cache (eviction allowed) and queues (`noeviction`). One instance with `noeviction` works for small scale. |
| Stripe | Point the webhook at `https://<api-host>/api/payments/webhook`; use its signing secret. |
| Scaling | `api` is stateless: run N copies behind a load balancer. Run workers separately (`RUN_WORKERS=false` on api). |
| HTTPS / proxy | Terminate TLS at the platform. The API trusts `X-Forwarded-For` from loopback only: if a proxy sits in front of the API, set `trust proxy` to that hop or rate limits will see the proxy's IP. |
| Monitoring | Alert on `/api/ready` failing, 5xx rate, p95 latency; `GET /api/admin/diagnostics` has pool, cache and event-loop numbers; add an error tracker (e.g. Sentry) next. |

## Deploy to Render (`render.yaml`)
Render reads `render.yaml` and creates: `shopeasy-api` (Docker, free), `shopeasy-web` (Docker, free), `shopeasy-redis` (Key Value, `noeviction`). The database stays on Supabase (a free Render Postgres is deleted after 30 days).

1. Push this branch / merge to the branch Render will watch, then Render dashboard -> **New -> Blueprint** -> pick the repo.
2. Render asks for the `sync: false` values. Paste them there (never in the repo): `DATABASE_URL` (Supabase pooler URL), `APP_URL`, Stripe keys, `RESEND_API_KEY`, `EMAIL_FROM`, `CLOUDINARY_URL`. `APP_URL` is the web service's URL (`https://shopeasy-web.onrender.com`; you can fill it after the first deploy, then redeploy the API).
3. Apply the schema to the production database once: run `backend/db/schema.sql` in the Supabase SQL editor (it is idempotent).
4. Stripe dashboard -> Webhooks -> endpoint `https://shopeasy-api.onrender.com/api/payments/webhook`; put its signing secret in `STRIPE_WEBHOOK_SECRET`.
5. Create the first admin: Render dashboard -> `shopeasy-api` -> Shell -> `node dist/scripts/createAdmin.js you@example.com 'a-strong-password' SUPER_ADMIN` (free instances may not have a Shell: then run `npm run create-admin -- ...` locally with the production `DATABASE_URL`).

Check after the first deploy: `https://<api>/api/ready` returns `{"db":"up","redis":"ready"}`; the shop loads; registering works (proves the web -> API proxy); log in twice from two devices and confirm one device's failed logins don't lock the other out (proves `TRUST_PROXY=2` gives each visitor their own rate-limit bucket; if they are shared, change the hop count).
Known free-tier behaviour: services sleep after ~15 minutes idle (first request ~50 s), and background jobs only run while the API is awake. Not tested on Render yet: this file was written from Render's docs, so expect to adjust on the first deploy. The frontend's API address is baked in at build time (Render passes env vars to Docker builds as build args); if the shop loads but `/api` calls fail, that is the first place to look.
