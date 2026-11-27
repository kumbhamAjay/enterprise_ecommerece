"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { LinkButton } from "@/components/ui/Button";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// The token is single-use, so a StrictMode double-effect must not call the API twice.
const attempts = new Map<string, Promise<void>>();

export function Verify() {
  const token = useSearchParams().get("token");
  const { status, reload } = useAuth();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    if (!attempts.has(token)) attempts.set(token, api.post("/api/auth/verify-email", { token }, false));
    attempts
      .get(token)!
      .then(() => setState("ok"))
      .catch((e) => {
        setState("error");
        setMessage(e instanceof ApiError ? "This link is invalid, has expired, or was already used." : "Network error. Please try again.");
      });
  }, [token]);

  useEffect(() => {
    if (state === "ok" && status === "authed") reload().catch(() => {}); // refresh the "verified" badge
  }, [state, status, reload]);

  return (
    <AuthShell eyebrow="Email verification" title={state === "loading" ? "Verifying…" : state === "ok" ? "Email verified" : "Verification failed"}>
      <div className="text-center">
        {state === "loading" && <Loader2 className="mx-auto animate-spin text-gold" size={32} />}
        {state === "ok" && (<><CheckCircle2 className="mx-auto text-ok" size={36} /><p className="mt-4 text-sm text-mute">Thank you — your email address is confirmed.</p><LinkButton href="/account" size="lg" className="mt-8 w-full">Go to my account</LinkButton></>)}
        {state === "error" && (<><XCircle className="mx-auto text-danger" size={36} /><p className="mt-4 text-sm text-mute">{message}</p><LinkButton href="/account" variant="outline" size="lg" className="mt-8 w-full">Request a new link in your account</LinkButton></>)}
      </div>
    </AuthShell>
  );
}
