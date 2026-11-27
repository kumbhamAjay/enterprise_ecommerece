import { z } from "zod";

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

export const addressSchema = z.object({
  addressLine1: z.string().trim().min(1),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().min(1).max(100),
  isDefault: z.boolean().optional(),
});
export const updateAddressSchema = addressSchema.partial();

export const idParam = z.string().regex(/^\d+$/, "Invalid id");

export type AddressInput = z.infer<typeof addressSchema>;
