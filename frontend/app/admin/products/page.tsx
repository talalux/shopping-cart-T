"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { baht, fmtDate, reducedMotion } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { B, Badge, btn, inputCls } from "@/components/ui";

type AdminProduct = { id: number; code: string; name: string; type: string; price: number; isActive: boolean; stock: number; expiredQty: number; nearestExp: string | null; daysLeft: number | null; nearExpiry: boolean };
type Lot = { id: number; receivedQty: number; remainingQty: number; receivedAt: string; expDate: string; expired: boolean; daysLeft: number; state: "ok" | "near" | "expired" };
type Detail = AdminProduct & { lots: Lot[] };

function ExpCell({ p }: { p: AdminProduct }) {
  if (!p.nearestExp) return p.expiredQty > 0 ? <span className="text-rose-700">มีแต่ล็อตหมดอายุ</span> : <>—</>;
  const near = p.nearExpiry;
  return (<><span className={`num ${near ? "text-amber-800 font-medium" : ""}`}>{fmtDate(p.nearestExp)}</span>{near && <> <B.Near /></>}</>);
}

function Products() {
  const sp = useSearchParams();
  const { toast } = useToast();
  const [list, setList] = useState<AdminProduct[] | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ id: number; closing: boolean } | null>(null);
  const [modal, setModal] = useState<{ code: string | null; prefill?: string } | null>(() => {
    const n = sp.get("new");
    return n ? { code: null, prefill: n } : null;
  });

  const reload = useCallback(async () => {
    const [r, t] = await Promise.all([api<AdminProduct[]>("products/admin"), api<string[]>("products/admin/types")]);
    if (r.ok) setList(r.data); else setError("โหลดรายการสินค้าไม่สำเร็จ");
    if (t.ok) setTypes(t.data);
  }, []);
  useEffect(() => {
    let alive = true;
    Promise.all([api<AdminProduct[]>("products/admin"), api<string[]>("products/admin/types")]).then(([r, t]) => {
      if (!alive) return;
      if (r.ok) setList(r.data); else setError("โหลดรายการสินค้าไม่สำเร็จ");
      if (t.ok) setTypes(t.data);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDrawer(null); setModal(null); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggle = async (p: AdminProduct) => {
    const r = await api(`products/${p.id}`, { method: "PUT", json: { code: p.code, name: p.name, type: p.type, price: p.price, isActive: !p.isActive } });
    if (r.ok) { toast(!p.isActive ? "เปิดการขายแล้ว" : "ปิดการขายแล้ว ลูกค้าจะไม่เห็นสินค้านี้"); reload(); }
    else toast(r.data?.error ?? "บันทึกไม่สำเร็จ");
  };

  const closeDrawer = () => {
    if (!drawer || drawer.closing) return;
    setDrawer({ ...drawer, closing: true });
    setTimeout(() => setDrawer(null), reducedMotion() ? 120 : 180);
  };

  return (
    <>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">สินค้า</h1>
          <p className="text-sm text-stone-600">คงเหลือ = เฉพาะล็อตที่ยังไม่หมดอายุ (ขายได้จริง)</p>
        </div>
        <button onClick={() => setModal({ code: null })} className={btn.primary}>+ เพิ่มสินค้า</button>
      </div>
      {error && <p role="alert" className="mt-4 text-rose-800">{error}</p>}
      <div className="mt-4 bg-white border border-stone-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-stone-50 text-stone-600 text-left">
            <tr>
              <th className="font-medium px-4 py-2.5">รหัส</th><th className="font-medium px-2">ชื่อ</th><th className="font-medium px-2">Type</th>
              <th className="font-medium px-2 text-right">ราคา</th><th className="font-medium px-2 text-right">คงเหลือ (ขายได้)</th>
              <th className="font-medium px-2">exp ใกล้สุด</th><th className="font-medium px-2">สถานะ</th><th className="px-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {!list && !error && <tr><td colSpan={8} className="px-4 py-6 text-center text-stone-500">กำลังโหลด…</td></tr>}
            {list?.map((p) => (
              <tr key={p.id} data-code={p.code} className={p.isActive ? "" : "bg-stone-50 text-stone-500"}>
                <td className="px-4 py-3 num whitespace-nowrap">{p.code}</td>
                <td className="px-2"><button onClick={() => setDrawer({ id: p.id, closing: false })} className="text-left font-medium hover:underline underline-offset-2">{p.name}</button></td>
                <td className="px-2 whitespace-nowrap">{p.type}</td>
                <td className="px-2 text-right num">{baht(p.price)}</td>
                <td className="px-2 text-right num whitespace-nowrap">
                  {p.stock === 0 ? <B.Out /> : <b>{p.stock.toLocaleString("th-TH")}</b>}
                  {p.expiredQty > 0 && <div className="text-xs text-rose-700">+{p.expiredQty} หมดอายุ</div>}
                </td>
                <td className="px-2 whitespace-nowrap"><ExpCell p={p} /></td>
                <td className="px-2">{p.isActive ? <B.On /> : <B.Off />}</td>
                <td className="px-4 text-right whitespace-nowrap space-x-3">
                  <button onClick={() => setDrawer({ id: p.id, closing: false })} className={btn.link}>ดูล็อต</button>
                  <button onClick={() => setModal({ code: p.code })} className={btn.link}>แก้ไข</button>
                  <button onClick={() => toggle(p)} className={p.isActive ? btn.danger : btn.link}>{p.isActive ? "ปิดการขาย" : "เปิดการขาย"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drawer && <LotsDrawer id={drawer.id} closing={drawer.closing} onClose={closeDrawer} />}
      {modal && (
        <EditModal
          product={modal.code ? list?.find((x) => x.code === modal.code) ?? null : null}
          prefill={modal.prefill}
          types={types}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); toast("บันทึกสินค้าแล้ว"); reload(); }}
        />
      )}
    </>
  );
}

function LotsDrawer({ id, closing, onClose }: { id: number; closing: boolean; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    api<Detail>(`products/${id}`).then((r) => { if (!alive) return; if (r.ok) setD(r.data); else setError(true); });
    return () => { alive = false; };
  }, [id]);

  const lots = d ? [...d.lots].sort((a, b) => a.expDate.localeCompare(b.expDate) || a.id - b.id) : [];
  const firstSellable = lots.find((l) => l.remainingQty > 0 && !l.expired)?.id;
  const expiredQty = lots.filter((l) => l.expired).reduce((s, l) => s + l.remainingQty, 0);

  return (
    <>
      <div className={`fixed inset-0 z-40 bg-stone-900/40 ${closing ? "fade-out" : "fade-in"}`} onClick={onClose} />
      <aside className={`fixed z-50 inset-y-0 right-0 w-full sm:w-[34rem] bg-white shadow-xl flex flex-col ${closing ? "drawer-out" : "drawer-in"}`} role="dialog" aria-label="ล็อตสินค้า">
        <div className="p-4 border-b border-stone-200 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {d ? (
              <>
                <div className="text-xs text-stone-500 num">{d.code} · {d.type}</div>
                <h2 className="font-semibold text-lg leading-snug">{d.name}</h2>
                <p className="text-sm text-stone-600 mt-1">ขายได้ <b className="num">{d.stock}</b> ชิ้น{expiredQty > 0 && <> · หมดอายุ <b className="num text-rose-700">{expiredQty}</b> ชิ้น</>}</p>
              </>
            ) : <p className="text-stone-500">{error ? "โหลดล็อตไม่สำเร็จ" : "กำลังโหลด…"}</p>}
          </div>
          <button onClick={onClose} className={btn.ghost} aria-label="ปิด">ปิด</button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          <p className="text-xs text-stone-500 mb-2">เรียงตามลำดับ exp (FEFO: หมดอายุก่อนตัดขายก่อน)</p>
          <div className="overflow-x-auto border border-stone-200 rounded-lg">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-stone-50 text-stone-600 text-left"><tr><th className="font-medium px-3 py-2">ล็อต</th><th className="font-medium px-2">รับเข้า</th><th className="font-medium px-2 text-right">คงเหลือ</th><th className="font-medium px-2">exp</th><th className="font-medium px-2">สถานะ</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {lots.map((l) => {
                  const st = l.state;
                  return (
                    <tr key={l.id} className={st === "expired" ? "bg-rose-50/50" : ""}>
                      <td className="px-3 py-2.5 num whitespace-nowrap">L-{l.id}{l.id === firstSellable && <div className="text-xs text-emerald-700">ตัดขายก่อน</div>}</td>
                      <td className="px-2 num whitespace-nowrap">{fmtDate(l.receivedAt)}<div className="text-xs text-stone-500">รับ {l.receivedQty} ชิ้น</div></td>
                      <td className="px-2 text-right num font-medium">{l.remainingQty}</td>
                      <td className="px-2 num whitespace-nowrap">{fmtDate(l.expDate)}</td>
                      <td className="px-2 whitespace-nowrap">
                        {l.remainingQty === 0 ? <Badge cls="bg-stone-200 text-stone-700">ขายหมดแล้ว</Badge> : st === "expired" ? <B.Expired /> : st === "near" ? <B.Near /> : <B.Ok />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d && <Link href={`/admin/stock-import?code=${encodeURIComponent(d.code)}`} className={`${btn.primary} mt-4`}>นำเข้าล็อตใหม่</Link>}
        </div>
      </aside>
    </>
  );
}

function EditModal({ product, prefill, types, onClose, onSaved }: {
  product: AdminProduct | null; prefill?: string; types: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [code, setCode] = useState(product?.code ?? prefill ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [type, setType] = useState(product?.type ?? types[0] ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const p = Number(price);
    if (!code.trim()) return setErr("กรุณากรอกรหัสสินค้า");
    if (!name.trim()) return setErr("กรุณากรอกชื่อสินค้า");
    if (!type.trim()) return setErr("กรุณากรอก Type");
    if (!(p >= 0) || price === "") return setErr("ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป");
    setBusy(true);
    try {
      const body = { code: code.trim(), name: name.trim(), type: type.trim(), price: p, isActive: product?.isActive ?? true };
      const r = product ? await api(`products/${product.id}`, { method: "PUT", json: body }) : await api("products", { method: "POST", json: body });
      if (r.ok) onSaved();
      else setErr(r.data?.error ?? "บันทึกไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/40 fade-in" onClick={onClose} />
      <div className="modal-in fixed z-50 inset-x-4 top-8 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[28rem] max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl p-5" role="dialog" aria-label={product ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}>
        <h2 className="font-semibold text-lg">{product ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-sm font-medium">รหัสสินค้า (Code)
            <input value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} mt-1`} placeholder="เช่น P-1005" />
          </label>
          <label className="block text-sm font-medium">ชื่อสินค้า
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">Type
              <input list="types" value={type} onChange={(e) => setType(e.target.value)} className={`${inputCls} mt-1`} />
              <datalist id="types">{types.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label className="block text-sm font-medium">ราคา (บาท)
              <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
          </div>
          <p className="text-xs text-stone-500">จำนวนคงเหลือและ exp ไม่กรอกที่นี่ — ได้จากการนำเข้าสต็อกเป็นล็อต</p>
          {err && <p role="alert" className="text-sm text-rose-700">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className={btn.ghost}>ยกเลิก</button>
            <button disabled={busy} className={btn.primary}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button>
          </div>
        </form>
      </div>
    </>
  );
}

export default function ProductsPage() {
  return (
    <Suspense>
      <Products />
    </Suspense>
  );
}
