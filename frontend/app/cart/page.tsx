"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Shortage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCart, type CartItem } from "@/lib/cart";
import { baht, reducedMotion } from "@/lib/format";
import { useBumpKey } from "@/lib/useBumpKey";
import { mmss, useCountdown } from "@/lib/useCountdown";
import { useToast } from "@/components/Toast";
import { btn, DelBtn, inputCls, TRASH, Xp } from "@/components/ui";

type Known = Record<number, { have: number; expired: number }>;
type Guest = { name: string; mode: "email" | "sms"; contact: string; errs: { name?: string; contact?: string }; general: string | null };

export default function CartPage() {
  const router = useRouter();
  const { user } = useAuth();
  const cart = useCart();
  const { toast, toastUndo } = useToast();
  const [known, setKnown] = useState<Known>({});
  const [showErr, setShowErr] = useState(false);
  const [tick, setTick] = useState(0);
  const [removing, setRemoving] = useState<number | null>(null);
  const [expandId, setExpandId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderErr, setOrderErr] = useState<string | null>(null);
  const [g, setG] = useState<Guest>({ name: "", mode: "email", contact: "", errs: {}, general: null });
  const [rateLeft, setRateLeft] = useCountdown(); // 429: seconds until the API lets this IP order again
  const [clearOpen, setClearOpen] = useState(false);
  const [clearN, setClearN] = useState(0); // "clear cart" collapse: rows with index < clearN are collapsing
  const clearBtn = useRef<HTMLButtonElement | null>(null);
  const focusEmpty = useRef(false);
  const gen = useRef(0); // bumped by "clear cart": a row-delete undo from before that must not bring the item back

  const items = cart.items;
  const errs = showErr ? items.filter((i) => known[i.productId] && i.qty > known[i.productId].have) : [];
  const errOf = (id: number) => errs.find((e) => e.productId === id);
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);
  const totalKey = useBumpKey(total);

  // bring the first error into view after a failed submit
  useEffect(() => {
    if (tick === 0) return;
    const el = document.querySelector("[aria-invalid=true],[role=alert]");
    el?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [tick]);

  if (!cart.ready) return <h1 className="text-2xl font-semibold">ตะกร้า</h1>;
  if (!items.length)
    return (
      <>
        <h1 id="cartTitle" tabIndex={-1} ref={(el) => { if (el && focusEmpty.current) { focusEmpty.current = false; el.focus(); } }} className="text-2xl font-semibold outline-none">ตะกร้า</h1>
        <div className="mt-4 bg-white border border-stone-200 rounded-xl p-10 text-center text-stone-600">
          ตะกร้ายังว่างอยู่<br />
          <Link href="/shop" className={`${btn.primary} mt-4`}>ไปเลือกสินค้า</Link>
        </div>
      </>
    );

  const applyShortages = (shortages: Shortage[]) => {
    const k: Known = {};
    shortages.forEach((s) => { k[s.productId] = { have: s.available, expired: s.expired_qty ?? 0 }; });
    setKnown((prev) => ({ ...prev, ...k }));
    setShowErr(true);
    setTick((t) => t + 1);
  };

  const dec = (i: CartItem) => i.qty > 1 && cart.setQty(i.productId, i.qty - 1);
  const inc = (i: CartItem) => cart.setQty(i.productId, i.qty + 1);
  const fit = (i: CartItem) => cart.setQty(i.productId, known[i.productId].have);
  const fixAll = () => {
    errs.forEach((e) => {
      const have = known[e.productId].have;
      if (have <= 0) cart.remove(e.productId);
      else cart.setQty(e.productId, have);
    });
    toast("ปรับจำนวนให้เท่าที่ขายได้แล้ว ตรวจยอดรวมอีกครั้งก่อนสั่งซื้อ");
  };

  const del = (i: CartItem) => {
    if (removing !== null || clearN > 0) return;
    const g0 = gen.current;
    const doIt = () => {
      setRemoving(null);
      if (gen.current !== g0) return; // cart was cleared meanwhile
      const r = cart.remove(i.productId);
      if (!r) return;
      toastUndo(`ลบ ${i.name} แล้ว`, () => {
        if (gen.current !== g0) return;
        setExpandId(i.productId);
        cart.restore(r.item, r.idx);
      });
    };
    setRemoving(i.productId);
    setTimeout(doIt, reducedMotion() ? 120 : 200);
  };

  // clear the whole cart (after the confirm modal): short row stagger (<= ~300ms), then empty + drop every stale state
  const clearAll = () => {
    setClearOpen(false);
    gen.current++;
    focusEmpty.current = true;
    const n = items.length;
    const rm = reducedMotion();
    const steps = rm ? 1 : Math.min(n, 4); // rows 0,1,2 start 30ms apart, the rest together at 90ms
    for (let k = 1; k <= steps; k++) setTimeout(() => setClearN(k === steps ? n : k), (k - 1) * 30);
    setTimeout(() => {
      cart.clear();
      setClearN(0);
      setRemoving(null);
      setExpandId(null);
      setKnown({});
      setShowErr(false);
      setOrderErr(null);
      setG((s) => ({ ...s, errs: {}, general: null }));
      toast("ล้างตะกร้าแล้ว"); // also replaces a pending row-delete undo toast
    }, rm ? 130 : (steps - 1) * 30 + 210);
  };
  const closeClear = () => { setClearOpen(false); clearBtn.current?.focus(); };

  const payload = items.map((i) => ({ productId: i.productId, qty: i.qty }));

  const order = async () => {
    setOrderErr(null);
    if (errs.length) { setTick((t) => t + 1); return; }
    setBusy(true);
    try {
      const r = await api<{ id: number }>("orders/checkout", { method: "POST", json: { items: payload } });
      if (r.ok) {
        cart.clear();
        toast("สั่งซื้อสำเร็จ");
        router.push(`/orders?open=${r.data.id}`);
      } else if (r.status === 409 && r.data?.shortages) applyShortages(r.data.shortages);
      else setOrderErr(r.data?.error ?? "สั่งซื้อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally { setBusy(false); }
  };

  const guestOrder = async () => {
    const c = g.contact.trim();
    const fe: Guest["errs"] = {};
    if (g.name.trim().length < 2) fe.name = "กรุณากรอกชื่อ (อย่างน้อย 2 ตัวอักษร)";
    if (!c) fe.contact = g.mode === "email" ? "กรุณากรอกอีเมล" : "กรุณากรอกเบอร์โทรศัพท์";
    else if (g.mode === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) fe.contact = "รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com";
    else if (g.mode === "sms" && !/^0\d{9}$/.test(c.replace(/[-\s]/g, ""))) fe.contact = "เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0";
    setG((s) => ({ ...s, errs: fe, general: null }));
    setTick((t) => t + 1);
    if (Object.keys(fe).length || errs.length) return;

    setBusy(true);
    try {
      const body = { name: g.name.trim(), email: g.mode === "email" ? c : undefined, phone: g.mode === "sms" ? c.replace(/[-\s]/g, "") : undefined, items: payload };
      const r = await api<{ orderId: number; maskedTarget: string; expiresAt: string }>("orders/guest", { method: "POST", json: body });
      if (r.status === 202) {
        const pending = {
          orderId: r.data.orderId, name: g.name.trim(), mode: g.mode, maskedTarget: r.data.maskedTarget, expiresAt: r.data.expiresAt,
          sentAt: new Date().toISOString(), items: items.map((i) => ({ code: i.code, name: i.name, qty: i.qty, price: i.price })),
        };
        try { sessionStorage.setItem("pendingOrder", JSON.stringify(pending)); } catch { /* ignore */ }
        router.push("/checkout/sent");
      } else if (r.status === 409 && r.data?.shortages) applyShortages(r.data.shortages);
      else if (r.status === 429) {
        const secs = parseInt(r.headers.get("retry-after") ?? "600", 10) || 600;
        setRateLeft(secs);
        setTick((t) => t + 1);
      } else if (r.status === 400) setG((s) => ({ ...s, errs: { ...s.errs, contact: r.data?.error ?? "ข้อมูลไม่ถูกต้อง" } }));
      else setG((s) => ({ ...s, general: r.data?.error ?? "สั่งซื้อไม่สำเร็จ ลองใหม่อีกครั้ง" }));
    } finally { setBusy(false); }
  };

  return (
    <>
      <h1 className="text-2xl font-semibold">ตะกร้า</h1>
      {errs.length > 0 && (
        <Xp key={`e409-${tick}`}>
          <div role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4">
            <div className="font-semibold text-rose-900">สั่งซื้อยังไม่สำเร็จ: {errs.length} รายการมีสินค้าไม่พอ</div>
            <p className="text-sm text-rose-900/80 mt-1">ยังไม่มีการตัดสต็อก และตะกร้าของคุณยังอยู่ครบ ปรับจำนวนหรือลบรายการที่ติดสีแดงด้านล่าง แล้วกดสั่งซื้ออีกครั้ง</p>
            <ul className="mt-3 space-y-1 text-sm text-rose-950">
              {errs.map((e) => (
                <li key={e.productId}>• <b>{e.name}</b> สั่ง {e.qty} ขายได้ {known[e.productId].have} <b>(ขาด {e.qty - known[e.productId].have})</b></li>
              ))}
            </ul>
            <button onClick={fixAll} className={`${btn.ghost} mt-3 border-rose-300`}>ปรับทุกรายการให้เท่าที่ขายได้</button>
          </div>
        </Xp>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem] items-start">
        <div>
          <ul className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-200 overflow-hidden">
            {items.map((i, idx) => (
              <Row key={i.productId} item={i} err={errOf(i.productId) ? known[i.productId] : null} expand={expandId === i.productId} collapsing={removing === i.productId || idx < clearN}
                onDec={() => dec(i)} onInc={() => inc(i)} onFit={() => fit(i)} onDel={() => del(i)} />
            ))}
          </ul>
          {/* kept on the left, away from the per-row delete buttons on the right */}
          <div className="mt-6">
            <button ref={clearBtn} onClick={() => setClearOpen(true)} disabled={busy || clearN > 0} data-testid="clear-cart"
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-rose-50">
              {TRASH}
              ล้างตะกร้า
            </button>
          </div>
        </div>
        <aside className="bg-white border border-stone-200 rounded-xl p-4 lg:sticky lg:top-24">
          <div className="text-sm text-stone-600">{items.length} รายการ · {cart.count} ชิ้น</div>
          <div className="mt-2 flex justify-between items-baseline">
            <span className="font-medium">ยอดรวม</span>
            <span key={totalKey} className={`text-2xl font-semibold num ${totalKey > 0 ? "num-bump" : ""}`}>{baht(total)}</span>
          </div>
          {user ? (
            <button onClick={order} disabled={busy || errs.length > 0} className={`${btn.primary} w-full mt-4 py-2.5`}>{busy ? "กำลังสั่งซื้อ…" : "สั่งซื้อ"}</button>
          ) : (
            <GuestForm g={g} setG={setG} tick={tick} errCount={errs.length} busy={busy} rateLeft={rateLeft} onOrder={guestOrder} />
          )}
          {orderErr && <p role="alert" className="text-sm text-rose-800 mt-2">{orderErr}</p>}
          {errs.length > 0 ? (
            <p className="text-xs text-rose-800 mt-2">แก้ {errs.length} รายการที่ติดสีแดงก่อน จึงจะสั่งซื้อได้</p>
          ) : user ? (
            <p className="text-xs text-stone-500 mt-2">ระบบจะตรวจสต็อกอีกครั้งตอนกดสั่งซื้อ</p>
          ) : null}
        </aside>
      </div>
      {clearOpen && <ConfirmClear lines={items.length} pcs={cart.count} onCancel={closeClear} onConfirm={clearAll} />}
    </>
  );
}

function ConfirmClear({ lines, pcs, onCancel, onConfirm }: { lines: number; pcs: number; onCancel: () => void; onConfirm: () => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const cancelBtn = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);
  // mount only: initial focus on "ยกเลิก" + Esc / Tab trap (a parent re-render must not pull focus back)
  useEffect(() => {
    cancelBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); cancelRef.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      const inside = box.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/40 fade-in" onClick={onCancel} data-testid="clear-backdrop" />
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="clearTitle" aria-describedby="clearDesc"
        className="modal-in fixed z-50 inset-x-4 top-1/3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[24rem] bg-white rounded-xl shadow-xl p-5">
        <h2 id="clearTitle" className="text-lg font-semibold">ล้างตะกร้าทั้งหมด {lines} รายการ?</h2>
        <p id="clearDesc" className="text-sm text-stone-600 mt-1">รวม {pcs} ชิ้น ลบแล้วกู้คืนไม่ได้</p>
        <div className="mt-5 flex gap-2 justify-end">
          <button ref={cancelBtn} onClick={onCancel} className={`${btn.ghost} min-h-[44px] px-4`}>ยกเลิก</button>
          <button onClick={onConfirm} className="inline-flex items-center justify-center rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-sm font-medium px-4 min-h-[44px]">ล้างตะกร้า</button>
        </div>
      </div>
    </>
  );
}

function Row({ item: i, err, expand, collapsing, onDec, onInc, onFit, onDel }: {
  item: CartItem; err: { have: number; expired: number } | null; expand: boolean; collapsing: boolean;
  onDec: () => void; onInc: () => void; onFit: () => void; onDel: () => void;
}) {
  const bk = useBumpKey(i.qty);
  return (
    <Xp as="li" animate={expand} collapsing={collapsing}>
      <div data-row={i.code} className={`p-4 ${err ? "bg-rose-50/60 ring-1 ring-inset ring-rose-300" : ""}`}>
        <div className="flex gap-3 justify-between items-start">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-stone-500 num">{i.code}</div>
            <div className="font-medium">{i.name}</div>
            <div className="text-sm text-stone-600 num">{baht(i.price)} / ชิ้น</div>
          </div>
          <div key={`t${bk}`} className={`font-semibold num text-right ${bk > 0 ? "num-bump" : ""}`}>{baht(i.qty * i.price)}</div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className={`inline-flex items-center rounded-lg border ${err ? "border-rose-400" : "border-stone-300"} bg-white`}>
            <button onClick={onDec} disabled={i.qty <= 1} className="w-10 h-10 text-lg hover:bg-stone-100 rounded-l-lg disabled:text-stone-300 disabled:hover:bg-transparent disabled:cursor-not-allowed" aria-label="ลด">−</button>
            <span key={`q${bk}`} className={`w-12 text-center num text-sm font-medium ${bk > 0 ? "num-bump" : ""}`}>{i.qty}</span>
            <button onClick={onInc} className="w-10 h-10 text-lg hover:bg-stone-100 rounded-r-lg" aria-label="เพิ่ม">+</button>
          </div>
          <DelBtn onClick={onDel} label="ลบ" />
        </div>
        {err && (
          <div className="mt-3 rounded-lg bg-white border border-rose-300 p-3 text-sm">
            <div className="text-rose-900">
              <b>{err.have === 0 ? "สินค้าหมดแล้ว" : `ขายได้เพียง ${err.have} ชิ้น`}</b> · คุณสั่ง {i.qty}{err.have === 0 ? "" : ` ขาดอีก ${i.qty - err.have}`}
            </div>
            {err.expired > 0 && <div className="text-stone-600 mt-0.5">ไม่นับล็อตที่หมดอายุแล้ว {err.expired} ชิ้น</div>}
            <div className="mt-2 flex gap-3 items-center flex-wrap">
              {err.have > 0 && <button onClick={onFit} className={btn.link}>ปรับเป็น {err.have} ชิ้น</button>}
              <DelBtn onClick={onDel} label="ลบออกจากตะกร้า" />
            </div>
          </div>
        )}
      </div>
    </Xp>
  );
}

function GuestForm({ g, setG, tick, errCount, busy, rateLeft, onOrder }: {
  g: Guest; setG: React.Dispatch<React.SetStateAction<Guest>>; tick: number; errCount: number; busy: boolean; rateLeft: number; onOrder: () => void;
}) {
  const em = g.mode === "email";
  const seg = (m: "email" | "sms", l: string) => (
    <button type="button" onClick={() => setG((s) => ({ ...s, mode: m, contact: "", errs: { ...s.errs, contact: undefined } }))} aria-pressed={g.mode === m}
      className={`flex-1 min-h-[40px] text-sm font-medium rounded-md ${g.mode === m ? "bg-white text-emerald-800 shadow-sm ring-1 ring-stone-200" : "text-stone-600 hover:text-stone-900"}`}>{l}</button>
  );
  const fieldCls = (k: "name" | "contact") => (g.errs[k] ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500 shake" : "");
  const fieldErr = (k: "name" | "contact") => g.errs[k] ? (
    <Xp key={`err-${k}-${tick}`}><p id={`err-${k}`} className="text-xs text-rose-700 mt-1">{g.errs[k]}</p></Xp>
  ) : null;
  return (
    <div className="mt-4 pt-4 border-t border-stone-200">
      <div className="text-sm font-semibold">สั่งซื้อโดยไม่ต้องเข้าสู่ระบบ</div>
      <p className="text-xs text-stone-500 mt-0.5">เราจะส่งลิงก์ยืนยันให้ สต็อกจะถูกตัดเมื่อคุณกดลิงก์ยืนยัน</p>
      <label className="block mt-3 text-sm font-medium">ชื่อผู้สั่ง
        <input id="gName" key={g.errs.name ? `n${tick}` : "n"} value={g.name} onChange={(e) => setG((s) => ({ ...s, name: e.target.value, errs: { ...s.errs, name: undefined } }))}
          className={`${inputCls} mt-1 ${fieldCls("name")}`} placeholder="เช่น สมชาย ใจดี" autoComplete="name" aria-invalid={g.errs.name ? true : undefined} aria-describedby={g.errs.name ? "err-name" : undefined} />
      </label>
      {fieldErr("name")}
      <div className="mt-3 text-sm font-medium" id="gModeLbl">รับลิงก์ยืนยันทาง</div>
      <div className="mt-1 flex gap-1 rounded-lg bg-stone-100 p-1" role="group" aria-labelledby="gModeLbl">{seg("email", "Email")}{seg("sms", "SMS")}</div>
      <label className="block mt-3 text-sm font-medium">{em ? "อีเมล" : "เบอร์โทรศัพท์"}
        <input id="gContact" key={g.errs.contact ? `c${tick}` : "c"} value={g.contact} onChange={(e) => setG((s) => ({ ...s, contact: e.target.value, errs: { ...s.errs, contact: undefined } }))}
          type={em ? "email" : "tel"} inputMode={em ? "email" : "numeric"} className={`${inputCls} mt-1 ${fieldCls("contact")}`} placeholder={em ? "name@example.com" : "08x-xxx-xxxx"}
          autoComplete={em ? "email" : "tel"} aria-invalid={g.errs.contact ? true : undefined} aria-describedby={g.errs.contact ? "err-contact" : undefined} />
      </label>
      {fieldErr("contact")}
      {rateLeft > 0 && (
        <Xp key="rate">
          <div role="alert" data-testid="rate-box" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <b>สั่งบ่อยเกินไป</b> ลองใหม่ได้ในอีก <span className="num" data-testid="rate-left">{mmss(rateLeft)}</span>
            <div className="text-xs text-amber-800/80 mt-0.5">ตะกร้าของคุณยังอยู่ครบ (429)</div>
          </div>
        </Xp>
      )}
      {g.general && <p role="alert" className="mt-3 text-sm text-rose-800">{g.general}</p>}
      <button onClick={onOrder} disabled={busy || errCount > 0 || rateLeft > 0} className={`${btn.primary} w-full mt-4 py-2.5 min-h-[44px]`}>{busy ? "กำลังส่ง…" : "สั่งซื้อและรับลิงก์ยืนยัน"}</button>
      <p className="text-sm text-center mt-3 text-stone-600">มีบัญชีแล้ว? <Link href="/login?next=/cart" className={`${btn.link} min-h-[40px] inline-flex items-center`}>เข้าสู่ระบบ</Link></p>
    </div>
  );
}
