// Plain functions: (payload) -> { subject, html, text }. Everything user-controlled goes through esc().
export type Template =
  | "verify-email" | "password-reset" | "order-placed" | "order-paid" | "order-shipped" | "order-delivered"
  | "order-cancelled" | "order-refunded" | "low-stock";
export type Rendered = { subject: string; html: string; text: string };
type P = Record<string, any>;

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const base = () => (process.env.APP_URL ?? "http://localhost:5001").replace(/\/$/, "");
const money = (v: string | number) => `$${Number(v).toFixed(2)}`;
const orderLink = (p: P) => `${base()}/orders/${p.orderId}`;

function layout(preheader: string, heading: string, bodyHtml: string, cta?: { label: string; href: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#faf8f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14110f">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="padding:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:-0.5px">Shop<em style="color:#a67c3d">Easy</em></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e7e1d8;padding:36px 32px">
<h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:26px;line-height:1.2">${esc(heading)}</h1>
<div style="font-size:15px;line-height:1.7;color:#4b4540">${bodyHtml}</div>
${cta ? `<p style="margin:28px 0 0"><a href="${esc(cta.href)}" style="display:inline-block;background:#14110f;color:#faf8f5;text-decoration:none;padding:13px 26px;font-size:14px;letter-spacing:.3px;border-radius:3px">${esc(cta.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:20px 4px;font-size:12px;color:#8b837a">You received this because of activity on your ShopEasy account.</td></tr>
</table></td></tr></table></body></html>`;
}

const itemsTable = (items: P[] = []) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border-top:1px solid #e7e1d8">${items
    .map((i) => `<tr><td style="padding:11px 0;border-bottom:1px solid #e7e1d8">${esc(i.name)} <span style="color:#8b837a">× ${esc(i.quantity)}</span></td><td align="right" style="padding:11px 0;border-bottom:1px solid #e7e1d8">${money(i.lineTotal)}</td></tr>`)
    .join("")}</table>`;
const itemsText = (items: P[] = []) => items.map((i) => `  - ${i.name} x ${i.quantity}  ${money(i.lineTotal)}`).join("\n");
const hi = (p: P) => (p.firstName || p.name ? `Hi ${esc(p.firstName ?? String(p.name).split(" ")[0])},` : "Hello,");
const hiText = (p: P) => (p.firstName || p.name ? `Hi ${p.firstName ?? String(p.name).split(" ")[0]},` : "Hello,");

const T: Record<Template, (p: P) => Rendered> = {
  "verify-email": (p) => ({
    subject: "Verify your email",
    html: layout("Confirm your email address", "Verify your email", `<p>${hi(p)}</p><p>Welcome to ShopEasy. Please confirm your email address to secure your account. This link works for 24 hours.</p>`, { label: "Verify email", href: p.link }),
    text: `${hiText(p)}\n\nConfirm your email address (valid for 24 hours):\n${p.link}\n`,
  }),
  "password-reset": (p) => ({
    subject: "Reset your password",
    html: layout("Choose a new password", "Reset your password", `<p>${hi(p)}</p><p>We received a request to reset your password. This link works for one hour. If you didn't ask for it, you can safely ignore this email.</p>`, { label: "Choose a new password", href: p.link }),
    text: `${hiText(p)}\n\nReset your password (valid for 1 hour):\n${p.link}\n\nIf you didn't ask for this, ignore this email.\n`,
  }),
  "order-placed": (p) => ({
    subject: `Order ${p.orderNumber} received`,
    html: layout(`We're holding your items for order ${p.orderNumber}`, "Thank you for your order", `<p>${hi(p)}</p><p>Your order <strong>${esc(p.orderNumber)}</strong> is placed and your items are being held. Complete your payment to confirm it; unpaid orders are released automatically.</p>${itemsTable(p.items)}<p style="margin:0">Subtotal ${money(p.subtotal)} · Shipping ${Number(p.shipping) === 0 ? "free" : money(p.shipping)}<br><strong style="font-size:17px;color:#14110f">Total ${money(p.total)}</strong></p>`, { label: "View your order", href: orderLink(p) }),
    text: `${hiText(p)}\n\nYour order ${p.orderNumber} is placed and your items are being held. Complete your payment to confirm it.\n\n${itemsText(p.items)}\n\nTotal: ${money(p.total)}\n\nView your order: ${orderLink(p)}\n`,
  }),
  "order-paid": (p) => ({
    subject: `Payment received for order ${p.orderNumber}`,
    html: layout(`Payment received: ${p.orderNumber}`, "Payment received", `<p>${hi(p)}</p><p>Thank you. We received your payment of <strong>${money(p.total)}</strong> for order <strong>${esc(p.orderNumber)}</strong> and we're getting it ready.</p>${itemsTable(p.items)}`, { label: "View your order", href: orderLink(p) }),
    text: `${hiText(p)}\n\nWe received your payment of ${money(p.total)} for order ${p.orderNumber}.\n\n${itemsText(p.items)}\n\n${orderLink(p)}\n`,
  }),
  "order-shipped": (p) => ({
    subject: `Your order ${p.orderNumber} has shipped`,
    html: layout(`Order ${p.orderNumber} is on its way`, "Your order is on its way", `<p>${hi(p)}</p><p>Good news: order <strong>${esc(p.orderNumber)}</strong> has shipped and is heading to you.</p>`, { label: "Track your order", href: orderLink(p) }),
    text: `${hiText(p)}\n\nOrder ${p.orderNumber} has shipped.\n\nTrack it: ${orderLink(p)}\n`,
  }),
  "order-delivered": (p) => ({
    subject: `Order ${p.orderNumber} was delivered`,
    html: layout(`Order ${p.orderNumber} delivered`, "Delivered", `<p>${hi(p)}</p><p>Order <strong>${esc(p.orderNumber)}</strong> was delivered. We hope you love it.</p>`, { label: "View your order", href: orderLink(p) }),
    text: `${hiText(p)}\n\nOrder ${p.orderNumber} was delivered.\n\n${orderLink(p)}\n`,
  }),
  "order-cancelled": (p) => ({
    subject: `Order ${p.orderNumber} was cancelled`,
    html: layout(`Order ${p.orderNumber} cancelled`, "Order cancelled", `<p>${hi(p)}</p><p>Order <strong>${esc(p.orderNumber)}</strong> was cancelled${p.reason ? `: ${esc(p.reason)}` : ""}. You were not charged.</p>`, { label: "Continue shopping", href: `${base()}/products` }),
    text: `${hiText(p)}\n\nOrder ${p.orderNumber} was cancelled${p.reason ? `: ${p.reason}` : ""}. You were not charged.\n`,
  }),
  "order-refunded": (p) => ({
    subject: `Refund for order ${p.orderNumber}`,
    html: layout(`Refund issued: ${p.orderNumber}`, "Your refund is on its way", `<p>${hi(p)}</p><p>We refunded <strong>${money(p.total)}</strong> for order <strong>${esc(p.orderNumber)}</strong>. It can take a few days to appear on your statement.</p>`, { label: "View your order", href: orderLink(p) }),
    text: `${hiText(p)}\n\nWe refunded ${money(p.total)} for order ${p.orderNumber}. It can take a few days to appear on your statement.\n`,
  }),
  "low-stock": (p) => ({
    subject: `Low stock: ${p.name}`,
    html: layout(`${p.name} is running low`, "Low stock alert", `<p><strong>${esc(p.name)}</strong> (${esc(p.sku)}) is down to <strong>${esc(p.available)}</strong> available. The alert level is ${esc(p.threshold)}.</p>`, { label: "Open inventory", href: `${base()}/admin?tab=inventory` }),
    text: `${p.name} (${p.sku}) is down to ${p.available} available (alert level ${p.threshold}).\n${base()}/admin?tab=inventory\n`,
  }),
};

export const render = (template: Template, payload: P): Rendered => {
  const t = T[template];
  if (!t) throw new Error(`Unknown email template: ${template}`);
  return t(payload);
};

// Lower number = sent first. Account security mail must never queue behind marketing-style notifications.
export const PRIORITY: Record<Template, number> = {
  "verify-email": 1, "password-reset": 1, "order-placed": 2, "order-paid": 2, "order-refunded": 2, "order-cancelled": 3,
  "order-shipped": 3, "order-delivered": 4, "low-stock": 5,
};
// Templates whose payload holds a live credential (a one-time link): wiped from the database once sent.
export const SECRET_TEMPLATES: Template[] = ["verify-email", "password-reset"];
