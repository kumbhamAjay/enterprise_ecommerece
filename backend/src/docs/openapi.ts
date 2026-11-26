import { z } from "zod";
import * as auth from "../modules/auth/auth.types";
import * as user from "../modules/users/user.types";
import * as category from "../modules/categories/category.types";
import * as manufacturer from "../modules/manufacturers/manufacturer.types";
import * as product from "../modules/products/product.types";
import * as inventory from "../modules/inventory/inventory.types";
import * as cart from "../modules/cart/cart.types";
import * as order from "../modules/orders/order.types";

// Request bodies come straight from the zod schemas, so docs and validation can't drift apart.
const json = (s: z.ZodType) => {
  const { $schema, ...schema } = z.toJSONSchema(s, { io: "output", unrepresentable: "any" }); // OpenAPI 3.0 has no $schema
  return schema;
};
const body = (s: z.ZodType) => ({ required: true, content: { "application/json": { schema: json(s) } } });

const err = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
const ok = (description = "Success") => ({ description });
const secured = [{ bearerAuth: [] }];
const idParam = [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^\\d+$" } }];

type Op = { tag: string; summary: string; body?: z.ZodType; auth?: boolean; admin?: boolean; params?: object[]; res: Record<string, object> };
const op = ({ tag, summary, body: b, auth: adminOnly, admin, params, res }: Op) => {
  const a = adminOnly || admin;
  return {
  tags: [tag],
  summary: admin ? `${summary} (admin)` : summary,
  ...(a && { security: secured }),
  ...(params && { parameters: params }),
  ...(b && { requestBody: body(b) }),
  responses: { ...res, ...(b && { 400: err("Validation error") }), ...(a && { 401: err("Missing or invalid access token") }), ...(admin && { 403: err("Admin role required") }) },
  };
};

// Query params come from the zod list schema too.
const queryParams = (s: z.ZodType) => {
  const { properties = {} } = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as { properties?: Record<string, object> };
  return Object.entries(properties).map(([name, schema]) => ({ name, in: "query", required: false, schema }));
};

const crud = (tag: string, base: string, schema: z.ZodType, patchSchema: z.ZodType, label: string) => ({
  [`/api/${base}`]: {
    get: op({ tag, summary: `List ${label}s`, res: { 200: ok() } }),
    post: op({ tag, summary: `Create ${label}`, body: schema, admin: true, res: { 201: ok(), 409: err("Already exists") } }),
  },
  [`/api/${base}/{id}`]: {
    get: op({ tag, summary: `Get ${label}`, params: idParam, res: { 200: ok(), 404: err("Not found") } }),
    patch: op({ tag, summary: `Update ${label}`, body: patchSchema, admin: true, params: idParam, res: { 200: ok(), 404: err("Not found"), 409: err("Conflict") } }),
    delete: op({ tag, summary: `Delete ${label}`, admin: true, params: idParam, res: { 204: ok(), 404: err("Not found"), 409: err("Still in use") } }),
  },
});

const catalogPaths = {
  ...crud("Manufacturers", "manufacturers", manufacturer.manufacturerSchema, manufacturer.manufacturerSchema, "manufacturer"),
  ...crud("Categories", "categories", category.categorySchema, category.updateCategorySchema, "category"),
  "/api/products": {
    get: {
      ...op({ tag: "Products", summary: "Search / filter / sort / paginate (category filter includes subcategories; q uses full-text search)", res: { 200: ok("{ data: [...], meta: { page, limit, total, totalPages } }") } }),
      parameters: queryParams(product.listQuerySchema),
    },
    post: op({ tag: "Products", summary: "Create product (with categories and images)", body: product.createProductSchema, admin: true, res: { 201: ok(), 409: err("SKU or slug already exists") } }),
  },
  "/api/products/import": { post: op({ tag: "Products", summary: "Bulk import from DummyJSON (idempotent UPSERT)", body: product.importSchema, admin: true, res: { 200: ok("{ inserted, updated }"), 502: err("Source unavailable"), 503: err("Source rate limiting") } }) },
  "/api/products/{id}": {
    get: op({ tag: "Products", summary: "Product detail (manufacturer, categories, images)", params: idParam, res: { 200: ok(), 404: err("Not found or inactive") } }),
    patch: op({ tag: "Products", summary: "Update product; categoryIds replaces the whole set", body: product.updateProductSchema, admin: true, params: idParam, res: { 200: ok(), 404: err("Not found") } }),
    delete: op({ tag: "Products", summary: "Deactivate product (soft delete)", admin: true, params: idParam, res: { 204: ok(), 404: err("Not found") } }),
  },
  "/api/products/{id}/images": { post: op({ tag: "Products", summary: "Add an image", body: product.imageSchema, admin: true, params: idParam, res: { 201: ok(), 404: err("Not found") } }) },
  "/api/products/{id}/images/{imageId}": {
    delete: op({ tag: "Products", summary: "Delete an image", admin: true, params: [...idParam, { ...idParam[0], name: "imageId" }], res: { 204: ok(), 404: err("Not found") } }),
  },
};

const pid = [{ ...idParam[0], name: "productId" }];
const idemKey = { name: "Idempotency-Key", in: "header", required: true, description: "Unique per checkout attempt (8-128 chars). Retrying the same attempt with the same key returns the original order instead of creating a second one.", schema: { type: "string", example: "7b8f2c1e-4a9d-4f63-9c1a-0d2e5a6b7c8d" } };
const orderPaths = {
  "/api/checkout/preview": {
    get: op({ tag: "Orders", summary: "Totals for the current cart: subtotal, shipping (free from $100), total, issues", auth: true, res: { 200: ok() } }),
  },
  "/api/checkout": {
    post: op({ tag: "Orders", summary: "Place an order from the cart: ONE transaction reserves stock, snapshots prices, creates the order and empties the cart. Idempotent.", body: order.checkoutSchema, auth: true, params: [idemKey], res: { 201: ok("Order created (status PENDING_PAYMENT)"), 200: ok("Replay of an earlier identical request (header Idempotent-Replay: true)"), 409: err("Empty bag / out of stock (body includes productId)"), 422: err("Idempotency-Key reused with a different request") } }),
  },
  "/api/orders": {
    get: { ...op({ tag: "Orders", summary: "My orders, newest first", auth: true, res: { 200: ok("{ data, meta }") } }), parameters: queryParams(order.listQuerySchema.omit({ q: true })) },
  },
  "/api/orders/{id}": {
    get: op({ tag: "Orders", summary: "One order with items, addresses and status history (owner or admin)", auth: true, params: idParam, res: { 200: ok(), 404: err("Not found") } }),
  },
  "/api/orders/{id}/cancel": {
    post: op({ tag: "Orders", summary: "Cancel an unpaid order (releases stock) or refund a paid one before it is prepared (returns stock). Idempotent.", body: order.cancelSchema, auth: true, params: idParam, res: { 200: ok(), 404: err("Not found"), 409: err("Too late to cancel") } }),
  },
  "/api/admin/orders": {
    get: { ...op({ tag: "Orders", summary: "All orders; q matches order number or customer email", admin: true, res: { 200: ok("{ data, meta }") } }), parameters: queryParams(order.listQuerySchema) },
  },
  "/api/admin/orders/{id}": {
    get: op({ tag: "Orders", summary: "Any order", admin: true, params: idParam, res: { 200: ok(), 404: err("Not found") } }),
  },
  "/api/admin/orders/{id}/status": {
    post: op({ tag: "Orders", summary: "Move an order along its lifecycle (PAID, PROCESSING, SHIPPED, DELIVERED, REFUNDED). PAID sells the held stock; REFUNDED before shipping restocks.", body: order.statusSchema, admin: true, params: idParam, res: { 200: ok(), 404: err("Not found"), 409: err("Transition not allowed / stock hold expired") } }),
  },
};

const emailPaths = {
  "/api/admin/emails": {
    get: { ...op({ tag: "Emails", summary: "Email log (the outbox): every email we intended to send, with status, attempts and last error", admin: true, res: { 200: ok("{ data, meta }") } }),
      parameters: [{ name: "status", in: "query", required: false, schema: { type: "string", enum: ["PENDING", "SENT", "FAILED"] } }, { name: "page", in: "query", required: false, schema: { type: "integer" } }, { name: "limit", in: "query", required: false, schema: { type: "integer" } }] },
  },
  "/api/admin/emails/stats": {
    get: op({ tag: "Emails", summary: "Counts per status, live queue counts, delivery mode (queue/inline) and provider", admin: true, res: { 200: ok() } }),
  },
  "/api/admin/emails/{id}/retry": {
    post: op({ tag: "Emails", summary: "Give a FAILED email a fresh set of attempts", admin: true, params: idParam, res: { 200: ok(), 404: err("No failed email with that id") } }),
  },
  "/api/admin/queues": {
    get: { tags: ["Emails"], summary: "Bull Board queue dashboard (HTML). HTTP basic auth: user admin, password BULL_BOARD_PASSWORD. 404 when not configured.", responses: { 200: ok("HTML dashboard"), 401: err("Basic auth required"), 404: err("Not configured") } },
  },
};

const uploadPaths = {
  "/api/admin/uploads/sign": {
    post: op({ tag: "Uploads", summary: "Short-lived signature for a direct browser -> Cloudinary image upload (folder and allowed formats are fixed by the signature). The API secret never leaves the server.", admin: true, res: { 200: ok("{ cloudName, apiKey, timestamp, signature, folder, allowedFormats, uploadUrl }"), 503: err("Cloudinary not configured") } }),
  },
  "/api/admin/uploads/discard": {
    post: op({ tag: "Uploads", summary: "Delete an uploaded asset that was never saved to a product (only inside shopeasy/products/)", body: z.object({ publicId: z.string() }), admin: true, res: { 204: ok("Deleted (best-effort)") } }),
  },
};

const cachePaths = {
  "/api/admin/cache": {
    get: op({ tag: "Cache", summary: "Redis status and cache statistics (hits, misses, coalesced, bypass, hit rate, catalog version)", admin: true, res: { 200: ok() } }),
  },
  "/api/admin/cache/flush": {
    post: op({ tag: "Cache", summary: "Emergency flush: bump the catalog version so every cached catalog entry is orphaned at once (O(1))", admin: true, res: { 200: ok("{ catalogVersion }") } }),
  },
};

const paymentPaths = {
  "/api/payments/orders/{id}/intent": {
    post: op({ tag: "Payments", summary: "Create (or reuse) the Stripe PaymentIntent for an unpaid order. The amount comes from the order, never the client. Returns { clientSecret, publishableKey } for Stripe's Payment Element.", auth: true, params: idParam, res: { 200: ok("{ clientSecret, publishableKey, amountCents, currency }"), 404: err("Not your order"), 409: err("Not payable (paid / cancelled / expired)"), 503: err("Stripe not configured") } }),
  },
  "/api/payments/orders/{id}/sync": {
    post: op({ tag: "Payments", summary: "After the browser reports a payment, ask Stripe directly and settle the order (idempotent; the webhook usually arrives first)", auth: true, params: idParam, res: { 200: ok("The order, with payments") } }),
  },
  "/api/payments/webhook": {
    post: { tags: ["Payments"], summary: "Stripe webhook (signature verified over the raw body). Deduplicated by event id; any processing failure returns 500 so Stripe redelivers.", parameters: [{ name: "Stripe-Signature", in: "header", required: true, schema: { type: "string" } }], responses: { 200: ok("{ received, result: processed | duplicate | ignored }"), 400: err("Missing or invalid signature"), 500: err("Not processed; Stripe will retry"), 503: err("Webhook secret not configured") } },
  },
  "/api/admin/payments/reconcile": {
    post: op({ tag: "Payments", summary: "Reconciliation: settle payments whose webhook was lost, close abandoned PaymentIntents, retry pending refunds. Safe to run any time.", admin: true, res: { 200: ok("{ checked, applied, canceled, refundsDone }") } }),
  },
};

const cartPaths = {
  "/api/cart": {
    get: op({ tag: "Cart", summary: "Your cart: live prices, availability per line, issues, exact subtotal (strings)", auth: true, res: { 200: ok("{ items, itemCount, subtotal, currency, hasIssues }") } }),
    delete: op({ tag: "Cart", summary: "Empty the cart", auth: true, res: { 200: ok() } }),
  },
  "/api/cart/items": {
    post: op({ tag: "Cart", summary: "Add to cart (increments an existing line). Validates stock; does NOT reserve it.", body: cart.addItemSchema, auth: true, res: { 201: ok("The updated cart"), 404: err("Product not found or inactive"), 409: err("Not enough stock / line limit") } }),
  },
  "/api/cart/items/{productId}": {
    patch: op({ tag: "Cart", summary: "Set a line's quantity", body: cart.setQuantitySchema, auth: true, params: pid, res: { 200: ok(), 404: err("Not in cart"), 409: err("Not enough stock") } }),
    delete: op({ tag: "Cart", summary: "Remove a line (idempotent)", auth: true, params: pid, res: { 200: ok() } }),
  },
  "/api/cart/merge": {
    post: op({ tag: "Cart", summary: "Merge a guest cart after login: larger quantity wins (safe to retry), unavailable items skipped, quantities clamped to stock", body: cart.mergeSchema, auth: true, res: { 200: ok("{ cart, skipped, adjusted }") } }),
  },
};

const catalogInventory = {
  "/api/inventory/reservations": {
    post: op({ tag: "Inventory", summary: "Hold stock for the signed-in user (all-or-nothing; atomic, never oversells). Expires after 15 min.", body: inventory.reserveSchema, auth: true, res: { 201: ok("Array of reservations"), 404: err("Product not found or inactive"), 409: err("Not enough stock") } }),
  },
  "/api/inventory/reservations/{id}": {
    delete: op({ tag: "Inventory", summary: "Release a reservation (idempotent; owner or admin)", auth: true, params: idParam, res: { 200: ok("{ id, status }"), 404: err("Not found") } }),
  },
  "/api/inventory": {
    get: { ...op({ tag: "Inventory", summary: "Stock levels, scarcest first; lowStock=true filters to items at/below their threshold", admin: true, res: { 200: ok("{ data, meta }") } }), parameters: queryParams(inventory.listQuerySchema) },
  },
  "/api/inventory/{productId}": {
    get: op({ tag: "Inventory", summary: "Stock for one product", admin: true, params: [{ ...idParam[0], name: "productId" }], res: { 200: ok(), 404: err("Not found") } }),
    patch: op({ tag: "Inventory", summary: "Set the low-stock alert threshold", body: inventory.thresholdSchema, admin: true, params: [{ ...idParam[0], name: "productId" }], res: { 200: ok(), 404: err("Not found") } }),
  },
  "/api/inventory/{productId}/adjust": {
    post: op({ tag: "Inventory", summary: "Add/remove stock (RESTOCK, RETURN add; DAMAGED removes; CORRECTION either). Can’t drop below reserved.", body: inventory.adjustSchema, admin: true, params: [{ ...idParam[0], name: "productId" }], res: { 200: ok(), 404: err("Not found"), 409: err("Units are reserved") } }),
  },
  "/api/inventory/{productId}/stock": {
    put: op({ tag: "Inventory", summary: "Stocktake: set exact on-hand quantity (row-locked)", body: inventory.setStockSchema, admin: true, params: [{ ...idParam[0], name: "productId" }], res: { 200: ok(), 404: err("Not found"), 409: err("Below reserved") } }),
  },
  "/api/inventory/{productId}/history": {
    get: { ...op({ tag: "Inventory", summary: "Stock movement ledger, newest first", admin: true, params: [{ ...idParam[0], name: "productId" }], res: { 200: ok("{ data, meta }") } }), parameters: [{ ...idParam[0], name: "productId" }, ...queryParams(inventory.historyQuerySchema)] },
  },
};

export const openapi = {
  openapi: "3.0.3",
  info: { title: "ShopEasy API", version: "1.0.0" },
  tags: [{ name: "Auth" }, { name: "Users" }, { name: "Manufacturers" }, { name: "Categories" }, { name: "Products" }, { name: "Inventory" }, { name: "Cart" }, { name: "Orders" }, { name: "Payments" }, { name: "Cache" }, { name: "Uploads" }, { name: "Emails" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: {
        type: "object",
        properties: { success: { type: "boolean", example: false }, message: { type: "string" } },
      },
    },
  },
  paths: {
    ...catalogPaths,
    ...catalogInventory,
    ...cartPaths,
    ...orderPaths,
    ...paymentPaths,
    ...cachePaths,
    ...uploadPaths,
    ...emailPaths,
    "/api/auth/register": { post: op({ tag: "Auth", summary: "Register a customer", body: auth.registerSchema, res: { 201: ok("User created (role CUSTOMER)"), 409: err("Email already registered") } }) },
    "/api/auth/login": { post: op({ tag: "Auth", summary: "Log in; returns access + refresh tokens", body: auth.loginSchema, res: { 200: ok(), 401: err("Invalid credentials") } }) },
    "/api/auth/refresh": { post: op({ tag: "Auth", summary: "Rotate refresh token (single-use; reuse revokes all sessions)", body: auth.refreshSchema, res: { 200: ok("New token pair"), 401: err("Invalid, expired or reused token") } }) },
    "/api/auth/logout": { post: op({ tag: "Auth", summary: "Revoke a refresh token", body: auth.refreshSchema, res: { 204: ok("Logged out") } }) },
    "/api/auth/me": { get: op({ tag: "Auth", summary: "Current user", auth: true, res: { 200: ok() } }) },
    "/api/auth/forgot-password": { post: op({ tag: "Auth", summary: "Email a reset link (same response whether or not the email exists)", body: auth.forgotPasswordSchema, res: { 200: ok() } }) },
    "/api/auth/reset-password": { post: op({ tag: "Auth", summary: "Set a new password with a reset token; revokes all sessions", body: auth.resetPasswordSchema, res: { 200: ok() } }) },
    "/api/auth/verify-email": { post: op({ tag: "Auth", summary: "Verify email with a single-use token", body: auth.tokenSchema, res: { 200: ok() } }) },
    "/api/auth/resend-verification": { post: op({ tag: "Auth", summary: "Send a new verification email", auth: true, res: { 200: ok(), 409: err("Already verified") } }) },

    "/api/users/me": { patch: op({ tag: "Users", summary: "Update profile", body: user.updateProfileSchema, auth: true, res: { 200: ok() } }) },
    "/api/users/me/password": { post: op({ tag: "Users", summary: "Change password; revokes all sessions", body: user.changePasswordSchema, auth: true, res: { 200: ok(), 400: err("Current password incorrect") } }) },
    "/api/users/me/addresses": {
      get: op({ tag: "Users", summary: "List addresses (default first)", auth: true, res: { 200: ok() } }),
      post: op({ tag: "Users", summary: "Add an address", body: user.addressSchema, auth: true, res: { 201: ok() } }),
    },
    "/api/users/me/addresses/{id}": {
      patch: op({ tag: "Users", summary: "Update an address", body: user.updateAddressSchema, auth: true, params: idParam, res: { 200: ok(), 404: err("Not found") } }),
      delete: op({ tag: "Users", summary: "Delete an address", auth: true, params: idParam, res: { 204: ok(), 404: err("Not found") } }),
    },
  },
};
