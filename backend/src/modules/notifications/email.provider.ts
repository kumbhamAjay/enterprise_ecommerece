import { sendMail } from "../../utils/mailer";

// permanent = retrying can never help (bad address, rejected content, bad API key); transient = try again later.
export class ProviderError extends Error {
  constructor(message: string, public permanent: boolean) { super(message); }
}
export type Outgoing = { to: string; subject: string; html: string; text: string; idempotencyKey: string };
export interface EmailProvider { name: string; send(m: Outgoing): Promise<{ id: string | null }> }

// Resend over plain HTTPS (no SDK needed). The Idempotency-Key header makes a duplicate request return the first result
// instead of sending twice, which backs up our own at-least-once-safe consumer.
const resend: EmailProvider = {
  name: "resend",
  async send(m) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json", "Idempotency-Key": m.idempotencyKey },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "ShopEasy <onboarding@resend.dev>", to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e) => { throw new ProviderError(`network error: ${e.message}`, false); });
    if (res.ok) return { id: ((await res.json()) as { id?: string }).id ?? null };
    const body = (await res.text()).slice(0, 300);
    // 4xx (except 409/429) = our request is wrong, retrying is pointless. 429, 409 (concurrent duplicate) and 5xx = try again.
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 409;
    throw new ProviderError(`Resend ${res.status}: ${body}`, permanent);
  },
};

// Development/test sink: prints to the console (or fills the test outbox).
const dev: EmailProvider = { name: "dev", async send(m) { await sendMail({ to: m.to, subject: m.subject, text: m.text }); return { id: null }; } };

let override: EmailProvider | undefined;
export const setEmailProvider = (p: EmailProvider | undefined) => { override = p; };
// Tests never use the real provider, even if a key is present in .env.
export const provider = (): EmailProvider => override ?? (process.env.NODE_ENV !== "test" && process.env.RESEND_API_KEY ? resend : dev);
