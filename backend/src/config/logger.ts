import { randomUUID } from "node:crypto";
import pino from "pino";
import pinoHttp from "pino-http";

// Structured JSON logs (one object per line): machines can filter by level, status or requestId; humans use `| pino-pretty` in dev.
// Credentials never reach the log: the Authorization header, cookies and Stripe's signature are redacted.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["stripe-signature"]'],
});

// One line per request, with a request id that is also returned as X-Request-Id: a user reports the id, you find the exact logs.
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  autoLogging: { ignore: (req) => req.url === "/api/health" || req.url === "/api/ready" }, // orchestrator probes every few seconds: noise
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
  serializers: { req: (r) => ({ id: r.id, method: r.method, url: String(r.url).split("?")[0] }), res: (r) => ({ statusCode: r.statusCode }) }, // no query strings: they can carry tokens
});
