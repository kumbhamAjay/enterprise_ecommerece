"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, Skeleton } from "@/components/ui/Misc";
import { Pagination } from "@/components/product/Pagination";
import { api, ApiError } from "@/lib/api";
import { useEmailStats, useEmails } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { EmailStatus } from "@/lib/types";

const LABEL: Record<string, string> = {
  "verify-email": "Verify email", "password-reset": "Password reset", "order-placed": "Order placed", "order-paid": "Payment received",
  "order-shipped": "Order shipped", "order-delivered": "Order delivered", "order-cancelled": "Order cancelled", "order-refunded": "Refund issued", "low-stock": "Low-stock alert",
};
const TONE: Record<EmailStatus, "ok" | "gold" | "danger"> = { SENT: "ok", PENDING: "gold", FAILED: "danger" };
const when = (d: string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function EmailsAdmin() {
  const [status, setStatus] = useState<"" | EmailStatus>("");
  const [page, setPage] = useState(1);
  const { data: stats } = useEmailStats();
  const { data, isPending, isError } = useEmails(status, page);
  const qc = useQueryClient();
  const toast = useToast();

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/emails/${id}/retry`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["emails"] }); toast.success("Queued for another attempt."); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not retry."),
  });

  const card = (label: string, value: number | string, tone = "text-ink") => (
    <div className="rounded-[3px] border border-line bg-paper px-5 py-4">
      <p className={`font-serif text-3xl tabular-nums ${tone}`}>{value}</p>
      <p className="eyebrow mt-1">{label}</p>
    </div>
  );

  return (
    <section>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {stats ? (
          <>
            {card("Sent", stats.emails.SENT, "text-ok")}
            {card("Pending", stats.emails.PENDING, stats.emails.PENDING ? "text-gold" : "text-ink")}
            {card("Failed", stats.emails.FAILED, stats.emails.FAILED ? "text-danger" : "text-ink")}
            {card("In queue", stats.queue ? stats.queue.waiting + stats.queue.active + stats.queue.delayed : "offline", stats.queue ? "text-ink" : "text-mute")}
            <div className="rounded-[3px] border border-line bg-paper px-5 py-4">
              <p className="font-serif text-xl">{stats.provider === "resend" ? "Resend" : stats.provider === "dev" ? "Console (dev)" : stats.provider}</p>
              <p className="eyebrow mt-1">Provider · {stats.mode}</p>
            </div>
          </>
        ) : (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[84px]" />)
        )}
      </div>
      {stats?.provider === "dev" && <p className="mt-4 text-xs leading-relaxed text-mute">No email provider key is set, so emails are printed to the server console instead of being delivered. Add <code className="font-mono">RESEND_API_KEY</code> to send real email.</p>}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label="Filter by status" className="flex gap-1">
          {(["", "FAILED", "PENDING", "SENT"] as const).map((s) => (
            <button key={s || "all"} role="tab" aria-selected={status === s} onClick={() => { setStatus(s); setPage(1); }} className={`rounded-full border px-4 py-1.5 text-xs transition-colors ${status === s ? "border-ink bg-ink text-ivory" : "border-line text-ink-soft hover:border-ink"}`}>
              {s ? s.charAt(0) + s.slice(1).toLowerCase() : "All"}
            </button>
          ))}
        </div>
        <a href="/api/admin/queues" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-ink-soft underline decoration-gold underline-offset-4 hover:text-ink" title="Needs BULL_BOARD_PASSWORD on the server">
          Open queue dashboard <ExternalLink size={14} />
        </a>
      </div>

      <div className="mt-5 overflow-x-auto rounded-[3px] border border-line bg-paper">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {["When", "To", "Email", "Status", "Tries", ""].map((h, i) => <th key={i} className={`eyebrow px-5 py-4 font-medium ${i === 4 ? "text-right" : ""}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              Array.from({ length: 6 }, (_, i) => <tr key={i} className="border-b border-line last:border-0"><td colSpan={6} className="px-5 py-4"><Skeleton className="h-8" /></td></tr>)
            ) : isError ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-danger">Couldn’t load emails.</td></tr>
            ) : data.data.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title="No emails" text={status ? "Nothing with that status." : "Emails appear here as customers register, order and pay."} /></td></tr>
            ) : (
              data.data.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0 hover:bg-sand/40">
                  <td className="whitespace-nowrap px-5 py-3 text-mute">{when(e.createdAt)}</td>
                  <td className="px-5 py-3 text-ink-soft">{e.to}</td>
                  <td className="px-5 py-3">
                    {LABEL[e.template] ?? e.template}
                    {e.lastError && <p className="mt-1 max-w-xs truncate text-xs text-danger" title={e.lastError}>{e.lastError}</p>}
                  </td>
                  <td className="px-5 py-3"><Badge tone={TONE[e.status]}>{e.status.charAt(0) + e.status.slice(1).toLowerCase()}</Badge></td>
                  <td className="px-5 py-3 text-right tabular-nums text-mute">{e.attempts}</td>
                  <td className="px-5 py-3 text-right">
                    {e.status === "FAILED" && <Button variant="outline" size="sm" loading={retry.isPending && retry.variables === e.id} onClick={() => retry.mutate(e.id)}><RotateCw size={13} /> Retry</Button>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />}
    </section>
  );
}
