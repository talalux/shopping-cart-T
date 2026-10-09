import { NextResponse } from "next/server";
import { COOKIE, apiUrl } from "@/lib/session";
import { upstreamHeaders } from "@/lib/upstream";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) return NextResponse.json({ error: "กรอกอีเมลและรหัสผ่าน" }, { status: 400 });
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/api/auth/login`, {
      method: "POST",
      headers: upstreamHeaders(req, { contentType: "application/json" }), // client IP + User-Agent reach AuthLog
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.token) return NextResponse.json({ error: data?.error ?? "เข้าสู่ระบบไม่สำเร็จ" }, { status: res.status });
  const out = NextResponse.json({ email: data.email, role: data.role });
  out.cookies.set(COOKIE, data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: data.expiresAt ? new Date(data.expiresAt) : undefined,
  });
  return out;
}
