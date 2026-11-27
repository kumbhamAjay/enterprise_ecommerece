import Stripe from "stripe";
import { HttpError } from "../utils/httpError";

let client: Stripe | undefined;

// Lazy: the app runs without Stripe keys; only payment endpoints say "not configured" (503).
export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new HttpError(503, "Payments are not configured");
    client = new Stripe(key);
  }
  return client;
}
export const setStripeClient = (c: unknown) => { client = c as Stripe | undefined; }; // tests inject a fake

// Verifying a signature is local HMAC math: it needs the webhook secret, not an API key or the network.
const verifier = new Stripe("sk_test_signature_verification_only");
export function verifyWebhook(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, "Webhooks are not configured");
  return verifier.webhooks.constructEvent(rawBody, signature, secret); // throws on a missing/forged/stale signature
}
