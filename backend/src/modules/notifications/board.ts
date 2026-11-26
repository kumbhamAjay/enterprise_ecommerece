import { timingSafeEqual } from "node:crypto";
import type { Express, RequestHandler } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { EMAIL_QUEUE, MAINTENANCE_QUEUE, getQueue } from "../../config/queue";

// Bull Board is a browser UI (no way to attach our JWT header), so it sits behind HTTP basic auth: user "admin", password
// BULL_BOARD_PASSWORD. Not configured = the route answers 404, so it is off by default. Built on first use (lazy).
const BASE = "/api/admin/queues";
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function mountBullBoard(app: Express) {
  let router: RequestHandler | undefined;
  const guard: RequestHandler = (req, res, next) => {
    const password = process.env.BULL_BOARD_PASSWORD;
    if (!password) return void res.status(404).json({ success: false, message: "Not found" });
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    const [user, pass = ""] = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(/:(.*)/s) : [];
    if (user === "admin" && same(pass, password)) return next();
    res.setHeader("WWW-Authenticate", 'Basic realm="ShopEasy queues"').status(401).send("Authentication required");
  };
  app.use(BASE, guard, (req, res, next) => {
    if (!router) {
      const adapter = new ExpressAdapter();
      adapter.setBasePath(BASE);
      createBullBoard({ queues: [new BullMQAdapter(getQueue(EMAIL_QUEUE)), new BullMQAdapter(getQueue(MAINTENANCE_QUEUE))], serverAdapter: adapter });
      router = adapter.getRouter() as unknown as RequestHandler;
    }
    router(req, res, next);
  });
}
