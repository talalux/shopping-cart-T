import type { NextRequest } from "next/server";
import { COOKIE, apiUrl } from "@/lib/session";
import { upstreamHeaders } from "@/lib/upstream";

// BFF proxy: attaches the httpOnly cookie as Bearer and forwards to the .NET API.
// Handles JSON, multipart (xlsx upload) and binary downloads (template) by passing raw bytes.
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `${apiUrl()}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = upstreamHeaders(req, { token: req.cookies.get(COOKIE)?.value, contentType: req.headers.get("content-type") });

  const hasBody = !["GET", "HEAD"].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return Response.json({ error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" }, { status: 502 });
  }

  const out = new Headers();
  for (const h of ["content-type", "content-disposition", "retry-after"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  const noBody = upstream.status === 204 || upstream.status === 304;
  return new Response(noBody ? null : await upstream.arrayBuffer(), { status: upstream.status, headers: out });
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH };
