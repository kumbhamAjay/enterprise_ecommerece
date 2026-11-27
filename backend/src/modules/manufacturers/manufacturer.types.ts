import { z } from "zod";

export const manufacturerSchema = z.object({ name: z.string().trim().min(1).max(150) });
