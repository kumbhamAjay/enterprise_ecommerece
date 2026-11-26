import "dotenv/config";
import app from "./app";
import { testDatabaseConnection } from "./config/db";
import { expireStale } from "./modules/inventory/inventory.service";
import { expireStale as expireOrders } from "./modules/orders/order.service";
import { reconcile } from "./modules/payments/payment.service";
import { getRedis } from "./config/redis";
import { withLock } from "./utils/lock";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await testDatabaseConnection();
    getRedis(); // start connecting now; the app works (uncached) even if Redis is unreachable

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Release stock held by abandoned reservations. ponytail: in-process timer; use a BullMQ repeatable job in Module 8.
    setInterval(() => expireStale().catch((e) => console.error("reservation sweep failed:", e)), 60_000).unref();
    // Unpaid orders lapse together with their stock hold.
    // Payment reconciliation: catches lost webhooks, abandoned payments and failed refunds. Only runs when Stripe is configured.
    if (process.env.STRIPE_SECRET_KEY) setInterval(() => withLock("reconcile", 4 * 60_000, reconcile).catch((e) => console.error("reconcile failed:", e)), 5 * 60_000).unref(); // lock: several instances, one reconciler
    setInterval(() => expireOrders().catch((e) => console.error("order sweep failed:", e)), 60_000).unref();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
