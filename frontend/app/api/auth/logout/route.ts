import { NextRequest, NextResponse } from "next/server";
import { COOKIE, apiUrl } from "@/lib/session";
import { upstreamHeaders } from "@/lib/upstream";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  if (token) {
    // JWT is stateless: tell the API only so the logout lands in AuthLog. A failure here must not block logging out.
    await fetch(`${apiUrl()}/api/auth/logout`, {
      method: "POST",
      headers: upstreamHeaders(req, { token }),
      cache: "no-store",
    }).catch(() => null);
  }
  const out = NextResponse.json({ ok: true });
  out.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return out;
}
