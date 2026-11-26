"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, clearTokens, getRefreshToken, hasStoredSession, refreshSession, setTokens } from "./api";
import type { User } from "./types";

type Status = "loading" | "authed" | "guest";
type Ctx = {
  user: User | null;
  status: Status;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (v: { firstName: string; lastName?: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
  reload: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const qc = useQueryClient();

  const reload = useCallback(async () => {
    setUser(await api.get<User>("/api/auth/me"));
    setStatus("authed");
  }, []);

  // Restore the session on first load: refresh token -> new access token -> /me
  useEffect(() => {
    (async () => {
      if (!hasStoredSession() || !(await refreshSession())) return setStatus("guest");
      try {
        await reload();
      } catch {
        clearTokens();
        setStatus("guest");
      }
    })();
  }, [reload]);

  // Signed out in another tab
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "shopeasy.rt" && !e.newValue) {
        setUser(null);
        setStatus("guest");
      }
    };
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const d = await api.post<{ user: User; accessToken: string; refreshToken: string }>("/api/auth/login", { email, password }, false);
    setTokens(d);
    setUser(d.user);
    setStatus("authed");
  }, []);

  const register: Ctx["register"] = useCallback(
    async (v) => {
      await api.post("/api/auth/register", v, false);
      await login(v.email, v.password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    const rt = getRefreshToken();
    if (rt) await api.post("/api/auth/logout", { refreshToken: rt }, false).catch(() => {});
    clearTokens();
    setUser(null);
    setStatus("guest");
    qc.removeQueries({ queryKey: ["account"] });
  }, [qc]);

  const value = useMemo(
    () => ({ user, status, isAdmin: !!user?.roles.some((r) => r === "ADMIN" || r === "SUPER_ADMIN"), login, register, logout, setUser, reload }),
    [user, status, login, register, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
}
