import { z } from "zod";

export const ORDER_STATUSES = ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const addressSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(30).optional(),
});
export type Address = z.infer<typeof addressSchema>;

export const checkoutSchema = z.object({
  shippingAddress: addressSchema,
  billingAddress: addressSchema.optional(), // defaults to the shipping address
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// Clients send a unique key per checkout attempt; retrying the SAME attempt reuses it.
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_\-:.]{8,128}$/, "Idempotency-Key must be 8-128 characters (letters, digits, _ - : .)");

export const cancelSchema = z.object({ reason: z.string().trim().max(300).optional() });
export const statusSchema = z.object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().max(300).optional() });

export const listQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(), // admin: order number or customer email
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
