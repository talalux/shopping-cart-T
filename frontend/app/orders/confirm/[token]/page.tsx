"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { api, type Shortage } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { baht, orderNo } from "@/lib/format";
import { Badge, btn } from "@/components/ui";

type OrderView = {
  id: number; status: string; total: number; guestName: string; alreadyConfirmed: boolean; confirmedAt: string | null;
  items: { productId: number; productCode: string; productName: string; qty: number; unitPrice: number }[];
};
type State =
  | { k: "loading" }
  | { k: "ok"; o: OrderView }
  | { k: "done"; o: OrderView }
  | { k: "expired" }
  | { k: "short"; shortages: Shortage[] }
  | { k: "notfound" }
  | { k: "error"; text: string };

function Hdr({ icon, cls, title, sub }: { icon: string; cls: string; title: string; sub: string }) {
  return (
    <>
      <div className={`w-12 h-12 rounded-full ${cls} flex items-center justify-center text-2xl font-semibold`} aria-hidden="true">{icon}</div>
      <h1 className="text-2xl font-semibold mt-3">{title}</h1>
      <p className="text-stone-600 mt-1">{sub}</p>
    </>
  );
}

function ItemsTable({ o }: { o: OrderView }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[300px] text-sm">
        <thead className="text-stone-500 text-left"><tr><th className="font-medium py-1">สินค้า</th><th className="font-medium text-right">จำนวน</th><th className="font-medium text-right">รวม</th></tr></thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.productId} className="border-t border-stone-100"><td className="py-1.5">{i.productName}</td><td className="text-right num">{i.qty}</td><td className="text-right num">{baht(i.qty * i.unitPrice)}</td></tr>
          ))}
          <tr className="border-t border-stone-300"><td className="py-2 font-medium" colSpan={2}>ยอดรวม</td><td className="text-right font-semibold num">{baht(o.total)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const cart = useCart();
  const [st, setSt] = useState<State>({ k: "loading" });
  const sent = useRef(false);
  const clearRef = useRef(cart.clear);
  useEffect(() => { clearRef.current = cart.clear; }, [cart.clear]);

  useEffect(() => {
    if (sent.current) return; // StrictMode runs effects twice in dev; the API is idempotent anyway
    sent.current = true;
    api<OrderView>(`orders/confirm/${encodeURIComponent(token)}`, { method: "POST" }).then((r) => {
      if (r.status === 200) {
        if (r.data.alreadyConfirmed) setSt({ k: "done", o: r.data });
        else {
          setSt({ k: "ok", o: r.data });
          try { localStorage.removeItem("cart:guest"); } catch { /* ignore */ }
          clearRef.current();
        }
      } else if (r.status === 410) setSt({ k: "expired" });
      else if (r.status === 409) setSt({ k: "short", shortages: r.data?.shortages ?? [] });
      else if (r.status === 404) setSt({ k: "notfound" });
      else setSt({ k: "error", text: r.data?.error ?? "ยืนยันไม่สำเร็จ ลองใหม่อีกครั้ง" });
    });
  }, [token]);

  return (
    <div className="max-w-lg mx-auto">
      <div className="rounded-xl bg-white border border-stone-200 p-5 sm:p-6" aria-live="polite">
        {st.k === "loading" && (
          <div className="py-6 text-center" role="status"><div className="spinner mx-auto" aria-hidden="true" /><div className="mt-4 font-medium">กำลังยืนยันคำสั่งซื้อ…</div></div>
        )}
        {st.k === "ok" && (
          <>
            <Hdr icon="✓" cls="bg-emerald-50 text-emerald-700" title="ยืนยันคำสั่งซื้อเรียบร้อย" sub={`ขอบคุณ ${st.o.guestName} เราตัดสต็อกและรับคำสั่งซื้อของคุณแล้ว`} />
            <div className="mt-4 flex items-center gap-3 flex-wrap"><span className="num text-lg font-semibold">{orderNo(st.o.id)}</span><Badge cls="bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">ยืนยันแล้ว</Badge></div>
            <div className="mt-3 border-t border-stone-200 pt-3"><ItemsTable o={st.o} /></div>
            <p className="text-xs text-stone-500 mt-3">เก็บลิงก์นี้ไว้ เปิดดูสถานะคำสั่งซื้อได้ตลอด แต่กดยืนยันซ้ำไม่ได้</p>
            <Link href="/shop" className={`${btn.primary} mt-4 min-h-[44px]`}>กลับไปเลือกสินค้า</Link>
          </>
        )}
        {st.k === "done" && (
          <>
            <Hdr icon="i" cls="bg-sky-50 text-sky-800" title="คำสั่งซื้อนี้ยืนยันไปแล้ว" sub="ลิงก์ยืนยันใช้ได้ครั้งเดียว ไม่ได้ตัดสต็อกซ้ำ ด้านล่างคือสถานะล่าสุดของคำสั่งซื้อ" />
            <div className="mt-4 num text-lg font-semibold">{orderNo(st.o.id)}</div>
            <ol className="mt-3 grid grid-cols-2 gap-1 text-center text-xs">
              {["รอยืนยัน", "ยืนยันแล้ว"].map((t, i) => (
                <li key={t}><div className="h-1.5 rounded-full bg-emerald-600" /><div className={`mt-1.5 ${i === 1 ? "font-semibold text-emerald-800" : "text-stone-700"}`}>{t}</div></li>
              ))}
            </ol>
            <p className="text-sm text-stone-600 mt-3">{st.o.items.length} รายการ รวม {baht(st.o.total)}</p>
            <div className="mt-3 border-t border-stone-200 pt-3"><ItemsTable o={st.o} /></div>
          </>
        )}
        {st.k === "expired" && (
          <>
            <Hdr icon="⏱" cls="bg-amber-100 text-amber-800" title="ลิงก์ยืนยันหมดอายุแล้ว" sub="ลิงก์ใช้ได้ 30 นาทีหลังส่ง หรือถูกแทนที่ด้วยลิงก์ที่ส่งใหม่ คำสั่งซื้อนี้ยังไม่ถูกยืนยัน และไม่มีการตัดสต็อก" />
            {cart.ready && cart.items.length > 0 ? (
              <>
                <div className="mt-4 rounded-lg bg-stone-50 border border-stone-200 p-3 text-sm">ตะกร้าเดิมของคุณยังอยู่ <b>{cart.items.length} รายการ · {cart.count} ชิ้น</b> สั่งใหม่แล้วเราจะส่งลิงก์ใหม่ให้</div>
                <Link href="/cart" className={`${btn.primary} mt-4 min-h-[44px]`}>สั่งซื้ออีกครั้งจากตะกร้าเดิม</Link>
              </>
            ) : (
              <>
                <div className="mt-4 rounded-lg bg-stone-50 border border-stone-200 p-3 text-sm">ตะกร้าเดิมไม่มีรายการแล้ว เลือกสินค้าใหม่เพื่อสั่งซื้ออีกครั้ง</div>
                <Link href="/shop" className={`${btn.primary} mt-4 min-h-[44px]`}>ไปเลือกสินค้า</Link>
              </>
            )}
          </>
        )}
        {st.k === "short" && (
          <>
            <Hdr icon="!" cls="bg-rose-100 text-rose-800" title="ยืนยันไม่สำเร็จ: สินค้าบางรายการไม่พอ" sub="มีคนซื้อตัดหน้าระหว่างรอยืนยัน ตอนนี้บางรายการเหลือน้อยกว่าที่คุณสั่ง" />
            <ul className="mt-4 space-y-2">
              {st.shortages.map((e) => (
                <li key={e.productId} className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm">
                  <div className="font-medium text-rose-950">{e.name}</div>
                  <div className="text-rose-900">สั่ง {e.requested} ขายได้ {e.available} <b>(ขาด {e.short_by})</b></div>
                  {e.expired_qty > 0 && <div className="text-stone-600 text-xs mt-0.5">ไม่นับล็อตที่หมดอายุแล้ว {e.expired_qty} ชิ้น</div>}
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-lg bg-stone-50 border border-stone-200 p-3 text-sm space-y-0.5"><div>✓ ยังไม่มีการตัดสต็อก</div><div>✓ ตะกร้าของคุณยังอยู่ครบ</div><div>✓ ปรับจำนวนแล้วสั่งใหม่ จะได้ลิงก์ใหม่ทันที</div></div>
            <Link href="/cart" className={`${btn.primary} mt-4 min-h-[44px]`}>กลับไปแก้ตะกร้า</Link>
          </>
        )}
        {st.k === "notfound" && (
          <>
            <Hdr icon="?" cls="bg-stone-100 text-stone-600" title="ไม่พบคำสั่งซื้อ" sub="ลิงก์นี้ไม่ถูกต้อง หรือถูกแทนที่ด้วยลิงก์ที่ส่งใหม่แล้ว ใช้ลิงก์ล่าสุดที่ได้รับ" />
            <Link href="/shop" className={`${btn.primary} mt-4 min-h-[44px]`}>ไปเลือกสินค้า</Link>
          </>
        )}
        {st.k === "error" && (
          <>
            <Hdr icon="!" cls="bg-rose-100 text-rose-800" title="ยืนยันไม่สำเร็จ" sub={st.text} />
            <button onClick={() => window.location.reload()} className={`${btn.primary} mt-4 min-h-[44px]`}>ลองใหม่</button>
          </>
        )}
      </div>
    </div>
  );
}
