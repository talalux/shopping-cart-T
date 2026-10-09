import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE, decodeSession } from "@/lib/session";

// Next 16 renamed middleware.ts -> proxy.ts. Optimistic guards only; the API enforces roles on every call.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const s = decodeSession(req.cookies.get(COOKIE)?.value);
  const toLogin = () => {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?next=" + encodeURIComponent(pathname);
    return NextResponse.redirect(url);
  };

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!s) return toLogin();
    if (s.role !== "Staff") {
      const url = req.nextUrl.clone();
      url.pathname = "/forbidden";
      url.search = "";
      return NextResponse.rewrite(url, { status: 403 });
    }
  }
  if (pathname === "/orders" && !s) return toLogin();
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/orders"] };
