"use client";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, Skeleton } from "@/components/ui/Misc";
import { Pagination } from "@/components/product/Pagination";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAdminUsers } from "@/lib/hooks";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { AdminUser } from "@/lib/types";

const ROLES = ["CUSTOMER", "ADMIN", "SUPER_ADMIN"];
const date = (d: string) => new Date(d).toLocaleDateString("en-GB", { dateStyle: "medium" });

export function UsersAdmin() {
  const { user: me } = useAuth();
  const isSuper = !!me?.roles.includes("SUPER_ADMIN");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [text]);

  const { data, isPending, isError } = useAdminUsers({ q: q || undefined, role: role || undefined, status: status || undefined, page });
  const qc = useQueryClient();
  const toast = useToast();
  const done = () => qc.invalidateQueries({ queryKey: ["admin-users"] });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "That didn’t work.");

  const setActive = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => api.patch(`/api/admin/users/${v.id}/status`, { isActive: v.isActive }),
    onSuccess: (_d, v) => { done(); toast.success(v.isActive ? "Account enabled." : "Account disabled and signed out."); }, onError: fail,
  });
  const setRoles = useMutation({
    mutationFn: (v: { id: string; roles: string[] }) => api.put(`/api/admin/users/${v.id}/roles`, { roles: v.roles }),
    onSuccess: () => { done(); toast.success("Role updated. They’ll be signed out to pick it up."); }, onError: fail,
  });

  // Admins manage customers; a super admin also manages staff. The API enforces the same rules: this only hides buttons that would be refused.
  const canManage = (u: AdminUser) => u.id !== me?.id && (isSuper || u.roles.every((r) => r === "CUSTOMER"));

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search name or email" aria-label="Search users" className="h-10 w-72 rounded-[3px] border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none" />
        <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role" className="h-10 rounded-[3px] border border-line bg-paper px-3 text-sm"><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ").toLowerCase()}</option>)}</select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className="h-10 rounded-[3px] border border-line bg-paper px-3 text-sm"><option value="">Any status</option><option value="active">Active</option><option value="disabled">Disabled</option></select>
        {data && <p className="ml-auto text-sm text-mute">{data.meta.total} {data.meta.total === 1 ? "user" : "users"}</p>}
      </div>

      <div className="mt-5 overflow-x-auto rounded-[3px] border border-line bg-paper">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead><tr className="border-b border-line">{["User", "Role", "Status", "Orders", "Spend", "Joined", ""].map((h, i) => <th key={i} className={`eyebrow px-5 py-4 font-medium ${i === 3 || i === 4 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>
            {isPending ? Array.from({ length: 6 }, (_, i) => <tr key={i} className="border-b border-line last:border-0"><td colSpan={7} className="px-5 py-4"><Skeleton className="h-8" /></td></tr>)
              : isError ? <tr><td colSpan={7} className="px-5 py-10 text-center text-danger">Couldn’t load users.</td></tr>
              : data.data.length === 0 ? <tr><td colSpan={7}><EmptyState title="No users" text="Nobody matches those filters." /></td></tr>
              : data.data.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0 hover:bg-sand/40">
                  <td className="px-5 py-3">{u.firstName} {u.lastName}<span className="block text-xs text-mute">{u.email}{!u.emailVerified && " · unverified"}</span></td>
                  <td className="px-5 py-3">
                    {isSuper && u.id !== me?.id ? (
                      <select value={u.roles.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : u.roles.includes("ADMIN") ? "ADMIN" : "CUSTOMER"} disabled={setRoles.isPending}
                        onChange={(e) => confirm(`Change ${u.email} to ${e.target.value.replace("_", " ").toLowerCase()}?`) && setRoles.mutate({ id: u.id, roles: e.target.value === "CUSTOMER" ? ["CUSTOMER"] : ["CUSTOMER", e.target.value] })}
                        aria-label={`Role of ${u.email}`} className="h-8 rounded-[3px] border border-line bg-paper px-2 text-xs">
                        {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ").toLowerCase()}</option>)}
                      </select>
                    ) : u.roles.map((r) => <Badge key={r} tone={r === "CUSTOMER" ? "neutral" : "gold"}>{r.replace("_", " ").toLowerCase()}</Badge>)}
                  </td>
                  <td className="px-5 py-3"><Badge tone={u.isActive ? "ok" : "danger"}>{u.isActive ? "Active" : "Disabled"}</Badge></td>
                  <td className="px-5 py-3 text-right tabular-nums">{u.orders}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{money(u.spend)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-mute">{date(u.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    {canManage(u) && <Button variant="outline" size="sm" loading={setActive.isPending && setActive.variables?.id === u.id}
                      onClick={() => (u.isActive ? confirm(`Disable ${u.email}? They will be signed out everywhere.`) : true) && setActive.mutate({ id: u.id, isActive: !u.isActive })}>{u.isActive ? "Disable" : "Enable"}</Button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />}
    </section>
  );
}
