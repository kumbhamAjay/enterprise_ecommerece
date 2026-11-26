import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { openapi } from "./docs/openapi";
import authRoutes from "./modules/auth/auth.routes";
import userRoutes from "./modules/users/user.routes";
import categoryRoutes from "./modules/categories/category.routes";
import manufacturerRoutes from "./modules/manufacturers/manufacturer.routes";
import productRoutes from "./modules/products/product.routes";
import inventoryRoutes from "./modules/inventory/inventory.routes";
import cartRoutes from "./modules/cart/cart.routes";
import { adminOrderRoutes, checkoutRoutes, orderRoutes } from "./modules/orders/order.routes";
import { adminPaymentRoutes, paymentRoutes } from "./modules/payments/payment.routes";
import { adminCacheRoutes } from "./modules/cache/cache.routes";
import { adminUploadRoutes } from "./modules/uploads/upload.routes";
import { adminEmailRoutes } from "./modules/notifications/email.routes";
import { mountBullBoard } from "./modules/notifications/board";
import { cacheContext } from "./utils/cache";
import { webhook } from "./modules/payments/payment.controller";
import { errorHandler } from "./middlewares/errorHandler";

const app = express();
// Browser traffic reaches Express through the Next.js proxy on the same machine: trust X-Forwarded-For from loopback ONLY,
// so req.ip is the real client (rate limits) and nobody else can spoof it.
app.set("trust proxy", "loopback");

app.use(cors());
// Stripe signs the RAW body, so this route must see the bytes before express.json() parses (and changes) them.
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), webhook);
app.use(express.json());
app.use(cacheContext);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Enterprise Ecommerce API is running",
  });
});

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi));
app.get("/api/openapi.json", (_req, res) => res.json(openapi));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/manufacturers", manufacturerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin/orders", adminOrderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin/payments", adminPaymentRoutes);
app.use("/api/admin/cache", adminCacheRoutes);
app.use("/api/admin/uploads", adminUploadRoutes);
app.use("/api/admin/emails", adminEmailRoutes);
mountBullBoard(app);
app.use(errorHandler);

export default app;
