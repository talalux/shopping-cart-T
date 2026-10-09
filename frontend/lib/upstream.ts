// One place that builds the headers the BFF sends to the .NET API, so no route can forget the client's IP / UA.
// server.mjs overwrites x-forwarded-for with the socket address, so that value is trustworthy; we SET it (never
// append / never pass through anything else the client sent). host / connection / cookie are deliberately not forwarded.
export function upstreamHeaders(req: Request, extra?: { token?: string; contentType?: string | null }): Headers {
  const h = new Headers();
  if (extra?.contentType) h.set("content-type", extra.contentType);
  if (extra?.token) h.set("authorization", `Bearer ${extra.token}`);
  h.set("x-forwarded-for", req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown");
  const ua = req.headers.get("user-agent");
  if (ua) h.set("user-agent", ua);
  return h;
}
