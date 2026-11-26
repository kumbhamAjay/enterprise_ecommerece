export type Mail = { to: string; subject: string; text: string };
export const outbox: Mail[] = []; // only filled under NODE_ENV=test, so tests can read links

// ponytail: dev mailer that prints; swap for Resend/Brevo in Module 8
export async function sendMail(m: Mail) {
  if (process.env.NODE_ENV === "test") outbox.push(m);
  else console.log(`[mail] to=${m.to} | ${m.subject}\n${m.text}`);
}
