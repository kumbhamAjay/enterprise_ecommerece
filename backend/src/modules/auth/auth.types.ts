import { z } from "zod";

// Single source of truth: the API contract AND the TypeScript type come from here.
export const registerSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().trim().toLowerCase().max(255).pipe(z.email()),
  password: z.string().min(8).max(72), // bcrypt only uses the first 72 bytes
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(255).pipe(z.email()),
  password: z.string().min(8).max(72), // bcrypt only uses the first 72 bytes
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export type UserDTO = {
  id: string; // bigint comes back from pg as string
  firstName: string;
  lastName: string | null;
  email: string;
  role: string;
};

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });

const password = z.string().min(8).max(72);
export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase() });
export const resetPasswordSchema = z.object({ token: z.string().min(1), password });
export const tokenSchema = z.object({ token: z.string().min(1) });
