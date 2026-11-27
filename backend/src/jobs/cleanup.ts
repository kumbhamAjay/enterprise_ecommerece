import { pool } from "../config/db";
import { SECRET_TEMPLATES } from "../modules/notifications/email.templates";

// Daily housekeeping: remove data that has outlived its purpose (and shrink what we hold about people).
export async function runCleanup() {
  const run = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rowCount ?? 0;
  return {
    refreshTokens: await run(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '30 days'`),
    oneTimeTokens: await run(`DELETE FROM one_time_tokens WHERE expires_at < now() - interval '7 days'`),
    idempotencyKeys: await run(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '3 days'`),
    stripeEvents: await run(`DELETE FROM stripe_events WHERE received_at < now() - interval '30 days'`),
    emailsDeleted: await run(`DELETE FROM email_log WHERE status = 'SENT' AND created_at < now() - interval '30 days'`),
    // a failed password-reset email still carries its link: wipe it after a day instead of keeping it for a month
    emailSecretsWiped: await run(`UPDATE email_log SET payload = '{}'::jsonb WHERE template = ANY($1) AND payload <> '{}'::jsonb AND created_at < now() - interval '1 day'`, [SECRET_TEMPLATES]),
  };
}
