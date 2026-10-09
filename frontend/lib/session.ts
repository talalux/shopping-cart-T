// Decodes (does NOT verify) the JWT payload. The API verifies the signature on every call;
// this is only for UI/optimistic route guards. Edge-safe (no Buffer).
export type Role = "Staff" | "Customer";
export type Session = { id: string; email: string; role: Role };

export function decodeSession(token?: string | null): Session | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const p = JSON.parse(atob(b64));
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    if (p.role !== "Staff" && p.role !== "Customer") return null;
    return { id: String(p.sub), email: String(p.email), role: p.role };
  } catch {
    return null;
  }
}

export const COOKIE = "token";
export const apiUrl = () => process.env.API_URL ?? "http://localhost:5080";
