import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/httpError";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ success: false, errors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message, ...err.extra });
  }
  // Postgres constraint errors -> meaningful client errors (the DB is the source of truth for integrity)
  const code = (err as { code?: string }).code;
  if (code === "23505") return res.status(409).json({ success: false, message: "Already exists" });
  if (code === "23503") return res.status(409).json({ success: false, message: "Related record is missing or still in use" });
  if (code === "23514") return res.status(400).json({ success: false, message: "Value violates a database rule" });
  console.error(err); // never leak internals to the client
  res.status(500).json({ success: false, message: "Internal server error" });
};
