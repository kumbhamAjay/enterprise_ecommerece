import type { Request, Response } from "express";
import * as authService from "./auth.service";
import { forgotPasswordSchema, loginSchema, refreshSchema, registerSchema, resetPasswordSchema, tokenSchema } from "./auth.types";

export async function register(req: Request, res: Response) {
  const input = registerSchema.parse(req.body); // ZodError -> 400 via errorHandler
  const user = await authService.register(input);
  res.status(201).json({ success: true, data: user });
}
export async function login(req: Request, res: Response) {
  const data = await authService.login(loginSchema.parse(req.body));
  res.json({ success: true, data });
}

// ponytail: tokens travel in the JSON body; move refresh token to an httpOnly cookie when a browser frontend exists
export async function refresh(req: Request, res: Response) {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json({ success: true, data: await authService.refresh(refreshToken) });
}

export async function logout(req: Request, res: Response) {
  await authService.logout(refreshSchema.parse(req.body).refreshToken);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json({ success: true, data: await authService.me(req.user!.sub) });
}

export async function forgotPassword(req: Request, res: Response) {
  await authService.forgotPassword(forgotPasswordSchema.parse(req.body).email);
  res.json({ success: true, message: "If that email exists, a reset link was sent" });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(token, password);
  res.json({ success: true, message: "Password updated. Please log in again." });
}

export async function verifyEmail(req: Request, res: Response) {
  await authService.verifyEmail(tokenSchema.parse(req.body).token);
  res.json({ success: true, message: "Email verified" });
}

export async function resendVerification(req: Request, res: Response) {
  await authService.resendVerification(req.user!.sub);
  res.json({ success: true, message: "Verification email sent" });
}
