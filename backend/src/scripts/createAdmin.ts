// Usage: npm run create-admin -- <email> <password> <ADMIN|SUPER_ADMIN> [firstName] [lastName]
// Creates the user (or updates the password of an existing one), marks the email verified, and grants the role. Safe to re-run.
import "dotenv/config";
import bcrypt from "bcrypt";
import { pool } from "../config/db";

(async () => {
  const [emailArg, password, role = "ADMIN", firstName = "Admin", lastName = ""] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();
  if (!email || !password) throw new Error("Usage: npm run create-admin -- <email> <password> <ADMIN|SUPER_ADMIN> [firstName] [lastName]");
  if (!["ADMIN", "SUPER_ADMIN"].includes(role)) throw new Error("Role must be ADMIN or SUPER_ADMIN");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");

  const hash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, email_verified_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true, email_verified_at = COALESCE(users.email_verified_at, now()), updated_at = now()
       RETURNING id, (xmax = 0) AS created`,
      [firstName, lastName || null, email, hash],
    );
    const userId = rows[0].id;
    // customers can shop too, so admins keep the CUSTOMER role and get the admin role on top
    await client.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = ANY($2) ON CONFLICT DO NOTHING`, [userId, ["CUSTOMER", role]]);
    await client.query("COMMIT");
    console.log(`${rows[0].created ? "created" : "updated"} ${email} with roles CUSTOMER + ${role}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
