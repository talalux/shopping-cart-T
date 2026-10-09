"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Product } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { baht, fmtDate } from "@/lib/format";
import { useReveal } from "@/lib/useReveal";
import { Roll } from "@/components/Roll";
import { B, btn, inputCls } from "@/components/ui";

const PAGE_SIZE = 24;
type Result = { key: string; mode: "page" | "grid"; items: Product[]; page: number; total: number; hasMore: boolean; moreBusy: boolean; error: string | null };

export default function ShopPage() {
  const cart = useCart();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [type, setType] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [retry, setRetry] = useState(0);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [bumps, setBumps] = useState<Record<string, number>>({});
  const [resets, setResets] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<{ code: string; n: number; id: number } | null>(null);
  const first = useRef(true);
  const reqId = useRef(0);
  const flashSeq = useRef(0);

  const key = `${dq}|${type}|${retry}`;
  const loading = !res || res.key !== key;
  const revealMode = res?.mode ?? "page";
  const reveal = useReveal(key, revealMode, res?.items.length ?? 0);

  // debounce search 300ms -> server
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    api<string[]>("products/types").then((r) => { if (alive && r.ok) setTypes(r.data); });
    return () => { alive = false; };
  }, []);

  // load page 1 whenever the query changes (search / type / retry)
  useEffect(() => {
    const id = ++reqId.current;
    const mode = first.current ? "page" : "grid";
    first.current = false;
    const params = new URLSearchParams({ page: "1", pageSize: String(PAGE_SIZE) });
    if (dq) params.set("q", dq);
    if (type) params.set("type", type);
    api<{ items: Product[]; page: number; total: number; hasMore: boolean }>(`products?${params}`).then((r) => {
      if (id !== reqId.current) return; // stale response
      if (!r.ok) setRes({ key, mode, items: [], page: 1, total: 0, hasMore: false, moreBusy: false, error: "โหลดรายการสินค้าไม่สำเร็จ" });
      else setRes({ key, mode, items: r.data.items, page: 1, total: r.data.total, hasMore: r.data.hasMore, moreBusy: false, error: null });
    });
  }, [dq, type, retry, key]);

  const loadMore = useCallback(() => {
    if (!res || res.key !== key || !res.hasMore || res.moreBusy) return;
    const next = res.page + 1;
    const id = reqId.current;
    setRes((s) => (s ? { ...s, moreBusy: true } : s));
    const params = new URLSearchParams({ page: String(next), pageSize: String(PAGE_SIZE) });
    if (dq) params.set("q", dq);
    if (type) params.set("type", type);
    api<{ items: Product[]; hasMore: boolean; total: number }>(`products?${params}`).then((r) => {
      if (id !== reqId.current) return;
      setRes((s) => {
        if (!s || s.key !== key) return s;
        if (!r.ok) return { ...s, moreBusy: false };
        return { ...s, items: [...s.items, ...r.data.items.filter((n) => !s.items.some((o) => o.id === n.id))], page: next, hasMore: r.data.hasMore, total: r.data.total, moreBusy: false };
      });
    });
  }, [res, key, dq, type]);

  // infinite scroll sentinel
  const sentinel = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMoreRef.current(); }, { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, res?.items.length, res?.hasMore]);

  const inCartOf = (id: number) => cart.items.find((i) => i.productId === id)?.qty ?? 0;
  const bump = (code: string) => setBumps((b) => ({ ...b, [code]: (b[code] ?? 0) + 1 }));

  const addToCart = (p: Product) => {
    const cap = p.stock - inCartOf(p.id);
    const n = Math.min(pick[p.code] ?? 1, cap);
    if (n < 1) return;
    const numEl = document.querySelector(`[data-stepnum="${p.code}"]`);
    cart.addWithChip({ id: p.id, code: p.code, name: p.name, price: p.price }, n, numEl);
    setPick((s) => ({ ...s, [p.code]: 1 }));
    setResets((s) => ({ ...s, [p.code]: (s[p.code] ?? 0) + 1 }));
    const fid = ++flashSeq.current;
    setFlash({ code: p.code, n, id: fid });
    setTimeout(() => setFlash((f) => (f && f.id === fid ? null : f)), 2000);
  };

  const chip = (t: string, label: string) => (
    <button
      key={t || "all"}
      onClick={() => setType(t)}
      aria-pressed={type === t}
      className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm border ${type === t ? "bg-emerald-700 border-emerald-700 text-white" : "bg-white border-stone-300 text-stone-700 hover:bg-stone-100"}`}
    >
      {label}
    </button>
  );

  const items = res && res.key === key ? res.items : [];

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">ร้านค้า</h1>
        <p className="text-sm text-stone-600">ระบบหยิบล็อตที่หมดอายุก่อนให้อัตโนมัติ ล็อตที่หมดอายุแล้วจะไม่ถูกขาย</p>
      </div>
      <div className="mt-4 space-y-3">
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} className={`${inputCls} sm:max-w-sm`} placeholder="ค้นหาชื่อหรือรหัสสินค้า" aria-label="ค้นหา" />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {chip("", "ทั้งหมด")}
          {types.map((t) => chip(t, t))}
        </div>
      </div>

      <div className="stagger mt-4 grid gap-3 sm:gap-4 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy={loading}>
        {items.map((p) => (
          <Card
            key={p.id}
            p={p}
            inCart={inCartOf(p.id)}
            pend={cart.pend[p.code] ?? 0}
            pick={pick[p.code] ?? 1}
            bumpN={bumps[p.code] ?? 0}
            resetN={resets[p.code] ?? 0}
            flash={flash && flash.code === p.code ? flash : null}
            rvRef={reveal.ref}
            rv={reveal.map[p.code]}
            onPick={(n) => { setPick((s) => ({ ...s, [p.code]: n })); bump(p.code); }}
            onAdd={() => addToCart(p)}
          />
        ))}
        {!loading && res?.error && (
          <div className="col-span-full text-center text-rose-800 py-12 bg-white border border-rose-200 rounded-xl">
            {res.error}<br /><button onClick={() => setRetry((r) => r + 1)} className={`${btn.link} mt-2`}>ลองใหม่</button>
          </div>
        )}
        {!loading && !res?.error && items.length === 0 && (
          <div className="col-span-full text-center text-stone-500 py-16 bg-white border border-stone-200 rounded-xl">
            ไม่พบสินค้าที่ตรงกับเงื่อนไข<br />
            <button onClick={() => { setQ(""); setDq(""); setType(""); }} className={`${btn.link} mt-2`}>ล้างตัวกรอง</button>
          </div>
        )}
        {loading && <div className="col-span-full text-center text-stone-500 py-16" role="status">กำลังโหลดสินค้า…</div>}
      </div>

      {!loading && items.length > 0 && (
        <div ref={sentinel} className="py-6 text-center text-sm text-stone-500" aria-live="polite">
          {res?.moreBusy ? "กำลังโหลดเพิ่ม…" : res?.hasMore ? "" : `แสดงครบ ${res?.total ?? items.length} รายการแล้ว`}
        </div>
      )}
    </>
  );
}

function Card({ p, inCart, pend, pick, bumpN, resetN, flash, rvRef, rv, onPick, onAdd }: {
  p: Product; inCart: number; pend: number; pick: number; bumpN: number; resetN: number;
  flash: { n: number; id: number } | null;
  rvRef: (el: HTMLElement | null) => void | (() => void);
  rv?: { d: number; now: boolean };
  onPick: (n: number) => void; onAdd: () => void;
}) {
  const out = p.stock <= 0;
  const near = !out && p.nearExpiry;
  const shownIn = inCart - pend;
  const cap = Math.max(0, p.stock - inCart);
  const cur = Math.min(Math.max(1, pick), Math.max(cap, 1));

  return (
    <article
      ref={rvRef}
      data-code={p.code}
      style={rv ? ({ ["--rd" as string]: `${rv.d}ms` } as React.CSSProperties) : undefined}
      className={`rv ${rv ? `in${rv.now ? " now" : ""}` : ""} bg-white border border-stone-200 rounded-xl p-4 flex flex-col ${out ? "opacity-80" : ""}`}
    >
      <div className="flex items-start justify-between gap-2 min-h-[1.5rem]">
        <span className="text-xs text-stone-500 num pt-0.5">{p.code} · {p.type}</span>
        {out ? <B.Out /> : near ? <B.Near /> : null}
      </div>
      <h2 className="mt-1.5 font-medium leading-snug min-h-[2.75rem]">{p.name}</h2>
      <div className="mt-2 text-xl font-semibold num">{baht(p.price)}</div>
      <dl className="mt-2 text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-stone-500">คงเหลือ</dt>
        <dd className="num">{out ? <span className="text-stone-500">สินค้าหมด</span> : <><b>{p.stock.toLocaleString("th-TH")}</b> <span className="text-stone-500">ชิ้น</span></>}</dd>
        <dt className="text-stone-500">หมดอายุ</dt>
        <dd className={`num ${near ? "text-amber-800 font-medium" : ""}`}>
          {out || !p.nearestExp ? "—" : <>{fmtDate(p.nearestExp)}{near && <span className="font-normal"> (อีก {p.daysLeft} วัน)</span>}</>}
        </dd>
      </dl>
      <div className="mt-auto pt-4">
        {out ? (
          <>
            <div className="min-h-[44px]" />
            <button disabled className={`${btn.primary} w-full min-h-[44px] mt-2`}>สินค้าหมด</button>
            <div className="mt-2 min-h-[2.5rem]" />
          </>
        ) : (
          <>
            <div className={`flex items-center justify-between rounded-lg border ${cap <= 0 ? "border-stone-200 bg-stone-50" : "border-stone-300 bg-white"} min-h-[44px]`}>
              <button onClick={() => onPick(Math.max(1, cur - 1))} disabled={cur <= 1 || cap <= 0} className="w-12 min-h-[44px] text-xl hover:bg-stone-100 rounded-l-lg disabled:text-stone-300 disabled:hover:bg-transparent disabled:cursor-not-allowed" aria-label="ลดจำนวน">−</button>
              <span
                key={`${bumpN}-${resetN}`}
                data-stepnum={p.code}
                className={`num font-semibold ${cap <= 0 ? "text-stone-400" : ""} ${bumpN > 0 && resetN === 0 ? "num-bump" : ""} ${resetN > 0 ? "step-reset" : ""}`}
              >
                {cap <= 0 ? 1 : cur}
              </span>
              <button onClick={() => onPick(cur + 1)} disabled={cur >= cap} className="w-12 min-h-[44px] text-xl hover:bg-stone-100 rounded-r-lg disabled:text-stone-300 disabled:hover:bg-transparent disabled:cursor-not-allowed" aria-label="เพิ่มจำนวน">+</button>
            </div>
            <button onClick={onAdd} disabled={cap <= 0} className={`${btn.primary} w-full min-h-[44px] mt-2`}>เพิ่มลงตะกร้า</button>
            <div className="mt-2 min-h-[2.5rem] text-xs leading-snug" aria-live="polite">
              <div className="text-stone-600">{shownIn > 0 ? <>ในตะกร้า <Roll value={shownIn} /> ชิ้น</> : " "}</div>
              {flash ? (
                <div key={flash.id} className="text-emerald-800 font-medium flash-anim">✓ เพิ่ม {flash.n} ชิ้นแล้ว</div>
              ) : cap <= 0 ? (
                <div className="text-amber-800 font-medium">ครบจำนวนที่มีแล้ว</div>
              ) : cur >= cap ? (
                <div className="text-amber-800 font-medium">เพิ่มได้อีกสูงสุด {cap} ชิ้น</div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </article>
  );
}
