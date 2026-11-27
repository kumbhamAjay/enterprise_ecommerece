import { z } from "zod";

// bigint ids arrive from pg as strings, so ids stay strings end to end
export const idParam = z.string().regex(/^\d+$/, "Invalid id");
