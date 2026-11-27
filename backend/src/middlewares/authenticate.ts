import type { RequestHandler } from "express";
import { HttpError } from "../utils/httpError";
import { verifyAccessToken, type AccessPayload } from "../utils/jwt";
import { isRevoked } from "../utils/revocation";

declare global {
  namespace Express {
    interface Request {
      user?: AccessPayload;
    }
  }
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !token) throw new HttpError(401, "Missing token");
  try {
    req.user = verifyAccessToken(token);
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
  // Sessions revoked after this token was issued (password change/reset, token reuse): reject immediately, not in 15 minutes
  if (await isRevoked(req.user.sub, req.user.iat ?? 0)) throw new HttpError(401, "Your session ended. Please sign in again.");
  next();
};

export const requireRole =
  (...roles: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user?.roles.some((r) => roles.includes(r))) throw new HttpError(403, "Forbidden");
    next();
  };
