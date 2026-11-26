import { safe } from "../config/redis";

// Access tokens are stateless JWTs, so without help they stay valid until they expire. When a user's sessions are revoked
// (password change/reset, token reuse detected) we store ONE timestamp per user; any access token issued before it is rejected.
// The key lives as long as an access token can (15 min), so it cleans itself up.
const TTL_SEC = 16 * 60;
const key = (userId: string) => `revoked:${userId}`;

export const revokeAccessTokens = (userId: string) => safe((r) => r.set(key(userId), Math.floor(Date.now() / 1000), "EX", TTL_SEC));

// Strict "<": a token issued in the same second as the revocation (e.g. the login right after a password reset) stays valid.
// Fail open when Redis is down: a revocation can be missed for up to 15 minutes, but the site stays up.
export async function isRevoked(userId: string, issuedAtSec: number): Promise<boolean> {
  const v = await safe((r) => r.get(key(userId)));
  return v != null && issuedAtSec < Number(v);
}
