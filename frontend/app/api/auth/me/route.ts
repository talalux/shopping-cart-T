import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE, decodeSession } from "@/lib/session";

export async function GET() {
  const s = decodeSession((await cookies()).get(COOKIE)?.value);
  if (!s) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ email: s.email, role: s.role });
}
