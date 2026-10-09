"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { baht, fmtDate, fmtDateTime, orderNo } from "@/lib/format";
import { Badge } from "@/components/ui";

type Order = {
  id: number; createdAt: string; total: number; status: string;
  items: { productId: number; productCode: string; productName: string; qty: number; unitPrice: number }[];
};

function Orders() {
  const sp = useSearchParams();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(() => {
    const o = sp.get("open");
    return o ? Number(o) : null;
  });

  useEffect(() => {
    let alive = true;
    api<Order[]>("orders/mine").then((r) => {
      if (!alive) return;
      if (r.ok) setOrders(r.data);
      else setError("โหลดคำสั่งซื้อไม่สำเร็จ");
    });
    return () => { alive = false; };
  }, []);

  return (
    <>
      <h1 className="text-2xl font-semibold">คำสั่งซื้อของฉัน</h1>
      {error && <p role="alert" className="mt-4 text-rose-800">{error}</p>}
      {!orders && !error && <p className="mt-4 text-stone-500" role="status">กำลังโหลด…</p>}
      {orders && orders.length === 0 && (
        <div className="mt-4 bg-white border border-stone-200 rounded-xl p-10 text-center text-stone-600">ยังไม่มีคำสั่งซื้อ</div>
      )}
      <ul className="mt-4 space-y-3">
        {orders?.map((o) => {
          const isOpen = open === o.id;
          return (
            <li key={o.id} data-order={o.id} className="bg-white border border-stone-200 rounded-xl">
              <button onClick={() => setOpen(isOpen ? null : o.id)} aria-expanded={isOpen} className="w-full text-left p-4 flex items-center gap-3 flex-wrap">
                <div className="flex-1 basis-40">
                  <div className="font-medium num">{orderNo(o.id)}</div>
                  <div className="text-sm text-stone-600">{fmtDate(o.createdAt.slice(0, 10))} · {o.items.length} รายการ</div>
                </div>
                <Badge cls="bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">สำเร็จ</Badge>
                <div className="font-semibold num w-24 text-right">{baht(o.total)}</div>
                <span className="text-stone-400 text-sm" aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div className="border-t border-stone-200 px-4 py-3 overflow-x-auto">
                  <div className="text-xs text-stone-500 mb-1">สั่งเมื่อ {fmtDateTime(o.createdAt)}</div>
                  <table className="w-full min-w-[380px] text-sm">
                    <thead className="text-stone-500 text-left"><tr><th className="font-medium py-1">สินค้า</th><th className="font-medium text-right">ราคา</th><th className="font-medium text-right">จำนวน</th><th className="font-medium text-right">รวม</th></tr></thead>
                    <tbody>
                      {o.items.map((i) => (
                        <tr key={i.productId} className="border-t border-stone-100">
                          <td className="py-1.5">{i.productName}</td><td className="text-right num">{baht(i.unitPrice)}</td><td className="text-right num">{i.qty}</td><td className="text-right num">{baht(i.qty * i.unitPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}
