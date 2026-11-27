import { z } from "zod";

export const ROLES = ["CUSTOMER", "ADMIN", "SUPER_ADMIN"] as const;
export const idParam = z.object({ id: z.string().regex(/^\d+$/) });
export const listQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const statusBody = z.object({ isActive: z.boolean() });
export const rolesBody = z.object({ roles: z.array(z.enum(ROLES)).min(1).max(3).transform((r) => [...new Set(r)]) });
