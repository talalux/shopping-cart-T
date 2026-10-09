export type ApiErr = { error?: string; shortages?: Shortage[] };
export type ApiResult<T = unknown> = { ok: boolean; status: number; data: T & ApiErr; headers: Headers };

/** Calls the .NET API through the Next BFF proxy (cookie -> Bearer happens server-side). */
export async function api<T = unknown>(
  path: string,
  init: Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit } = {},
): Promise<ApiResult<T>> {
  const { json, headers, ...rest } = init;
  const h = new Headers(headers);
  let body = rest.body;
  if (json !== undefined) {
    h.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }
  const res = await fetch(`/api/proxy/${path.replace(/^\//, "")}`, { ...rest, headers: h, body, cache: "no-store" });
  let data: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) data = await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname);
  }
  return { ok: res.ok, status: res.status, data: data as T & ApiErr, headers: res.headers };
}

export type Product = {
  id: number; code: string; name: string; type: string; price: number; stock: number; nearestExp: string | null;
  /** decided by the server (Stock:NearExpiryDays) - the UI never recomputes it */
  daysLeft: number | null; nearExpiry: boolean;
};
export type Shortage = {
  productId: number; code: string; name: string; requested: number; available: number; short_by: number; expired_qty: number;
};
