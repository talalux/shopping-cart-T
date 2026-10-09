"use client";
import { createContext, useCallback, useContext, useState } from "react";
import type { Role } from "@/lib/session";

export type User = { email: string; role: Role } | null;
type AuthCtx = { user: User; setUser: (u: User) => void; logout: () => Promise<void> };
const Ctx = createContext<AuthCtx>({ user: null, setUser: () => {}, logout: async () => {} });

export function AuthProvider({ initialUser, children }: { initialUser: User; children: React.ReactNode }) {
  const [user, setUser] = useState<User>(initialUser);
  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);
  return <Ctx.Provider value={{ user, setUser, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
