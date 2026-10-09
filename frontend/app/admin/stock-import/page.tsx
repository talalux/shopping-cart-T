"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { daysTo, fmtDate, fmtDateTime, fmtSize, fmtTime, reducedMotion } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { Badge, btn, inputCls, Xp } from "@/components/ui";

type AdminProduct = { id: number; code: string; name: string; stock: number };
type LotRow = { id: number; productCode: string; productName: string; receivedQty: number; expDate: string; receivedAt: string; importedBy: string | null };
type Batch = { id: number; fileName: string; rowCount: number; totalQty: number; createdAt: string; importedBy: string | null; lots: { productCode: string; productName: string; qty: number; expDate: string }[] };
type PRow = { row: number; code: string; qty: string; expDate: string; productName: string | null; status: "ok" | "warning" | "error"; messages: string[] };
type Preview = { previewId: string; rows: PRow[]; summary: { total: number; ok: number; error: number; warning: number; totalQty: number }; duplicateFile: boolean };
type Xl =
  | { st: "pick"; err: string | null }
  | { st: "checking"; file: { name: string; size: number } }
  | { st: "preview"; file: { name: string; size: number }; pv: Preview; at: number; filter: boolean; ack: boolean; err: string | null; busy: boolean }
  | { st: "done"; file: string; id: number; lots: number; qty: number }
  | { st: "expired" };

const batchNo = (id: number) => "IMP-" + String(id).padStart(4, "0");
const SEG = (active: boolean) =>
  `flex-1 sm:flex-none min-h-[40px] px-4 text-sm font-medium rounded-md ${active ? "bg-white text-emerald-800 shadow-sm ring-1 ring-stone-200" : "text-stone-600 hover:text-stone-900"}`;

function ImportPage() {
  const sp = useSearchParams();
  const [mode, setMode] = useState<"single" | "excel">("single");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([api<AdminProduct[]>("products/admin"), api<LotRow[]>("stock-imports"), api<Batch[]>("stock-imports/batches")]).then(([p, l, b]) => {
      if (!alive) return;
      if (p.ok) setProducts(p.data);
      if (l.ok) setLots(l.data);
      if (b.ok) setBatches(b.data);
    });
    return () => { alive = false; };
  }, [tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return (
    <>
      <h1 className="text-2xl font-semibold">นำเข้าสต็อก</h1>
      <p className="text-sm text-stone-600">นำเข้า 1 ครั้ง = 1 ล็อต แต่ละล็อตมีวันหมดอายุของตัวเอง</p>
      <div className="mt-4 inline-flex w-full sm:w-auto gap-1 rounded-lg bg-stone-100 p-1" role="group" aria-label="โหมดนำเข้า">
        <button onClick={() => setMode("single")} aria-pressed={mode === "single"} className={SEG(mode === "single")}>ทีละรายการ</button>
        <button onClick={() => setMode("excel")} aria-pressed={mode === "excel"} className={SEG(mode === "excel")}>หลายรายการ (Excel)</button>
      </div>
      {mode === "single" ? (
        <Single products={products} lots={lots} pref={sp.get("code") ?? ""} onSaved={refresh} />
      ) : (
        <Excel batches={batches} onApplied={refresh} />
      )}
    </>
  );
}

/* ---------------- ทีละรายการ ---------------- */
function Single({ products, lots, pref, onSaved }: { products: AdminProduct[]; lots: LotRow[]; pref: string; onSaved: () => void }) {
  const { toast } = useToast();
  const [code, setCode] = useState(pref);
  const [qty, setQty] = useState("");
  const [exp, setExp] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const p = products.find((x) => x.code === code.trim().toUpperCase()); // codes are case-insensitive

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!p) return setErr("ไม่พบรหัสสินค้านี้ กรุณาเลือกจากรายการ");
    if (!(n >= 1) || !Number.isInteger(n)) return setErr("จำนวนต้องเป็นจำนวนเต็มมากกว่า 0");
    if (!exp) return setErr("กรุณาระบุวันหมดอายุ");
    if (daysTo(exp) < 0) return setErr("วันหมดอายุผ่านไปแล้ว ล็อตนี้จะขายไม่ได้ กรุณาตรวจสอบวันที่");
    setErr("");
    setBusy(true);
    try {
      const r = await api("stock-imports", { method: "POST", json: { productCode: p.code, qty: n, expDate: exp } });
      if (r.ok) { toast(`นำเข้า ${p.name} +${n} ชิ้น เรียบร้อย`); setCode(""); setQty(""); setExp(""); onSaved(); }
      else setErr(r.data?.error ?? "บันทึกไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[22rem_1fr] items-start">
      <form onSubmit={submit} className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
        <label className="block text-sm font-medium">รหัสสินค้า
          <input id="iCode" list="codes" value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} mt-1`} placeholder="พิมพ์รหัส เช่น MILK-001" />
          <datalist id="codes">{products.map((x) => <option key={x.id} value={x.code}>{x.name}</option>)}</datalist>
        </label>
        <div id="iHint" className="text-sm min-h-[1.25rem]">
          {!code.trim() ? null : p ? <span className="text-emerald-800">✓ {p.name} · ขายได้ {p.stock} ชิ้น</span> : <span className="text-rose-700">ไม่พบรหัสสินค้านี้</span>}
        </div>
        <label className="block text-sm font-medium">จำนวนที่รับเข้า
          <input id="iQty" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className={`${inputCls} mt-1`} placeholder="0" />
        </label>
        <label className="block text-sm font-medium">วันหมดอายุ (exp)
          <input id="iExp" type="date" value={exp} onChange={(e) => setExp(e.target.value)} className={`${inputCls} mt-1`} />
        </label>
        <div id="iErr" className="text-sm text-rose-700 min-h-[1.25rem]" role="alert">{err}</div>
        <button disabled={busy} className={`${btn.primary} w-full`}>{busy ? "กำลังบันทึก…" : "บันทึกการนำเข้า"}</button>
      </form>
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 font-medium">ประวัติการนำเข้า</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-stone-50 text-stone-600 text-left"><tr><th className="font-medium px-4 py-2">เวลา</th><th className="font-medium px-2">สินค้า</th><th className="font-medium px-2 text-right">จำนวน</th><th className="font-medium px-2">exp</th><th className="font-medium px-4">ผู้บันทึก</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {lots.slice(0, 30).map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 num whitespace-nowrap">{fmtDateTime(r.receivedAt)}</td>
                  <td className="px-2"><span className="num text-stone-500">{r.productCode}</span> {r.productName}</td>
                  <td className="px-2 text-right num">+{r.receivedQty}</td>
                  <td className="px-2 num whitespace-nowrap">{fmtDate(r.expDate)}</td>
                  <td className="px-4 text-stone-600 whitespace-nowrap">{r.importedBy ?? "—"}</td>
                </tr>
              ))}
              {lots.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-stone-500">ยังไม่มีประวัติ</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- หลายรายการ (Excel) ---------------- */
function Excel({ batches, onApplied }: { batches: Batch[]; onApplied: () => void }) {
  const { toast } = useToast();
  const [xl, setXl] = useState<Xl>({ st: "pick", err: null });
  const [drag, setDrag] = useState(false);
  const [openBatch, setOpenBatch] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // preview result lives 10 minutes server-side
  const previewAt = xl.st === "preview" ? xl.at : null;
  useEffect(() => {
    if (previewAt === null) return;
    const t = setTimeout(() => setXl({ st: "expired" }), Math.max(0, previewAt + 10 * 60 * 1000 - Date.now()));
    return () => clearTimeout(t);
  }, [previewAt]);

  const handleFile = async (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setXl({ st: "pick", err: "รองรับเฉพาะไฟล์ .xlsx — ดาวน์โหลด template ได้ที่ปุ่มด้านบน" });
    if (f.size > 2 * 1024 * 1024) return setXl({ st: "pick", err: `ไฟล์ใหญ่เกิน 2 MB (${fmtSize(f.size)}) ลดจำนวนแถวหรือแบ่งเป็นหลายไฟล์` });
    const file = { name: f.name, size: f.size };
    setXl({ st: "checking", file });
    const fd = new FormData();
    fd.append("file", f);
    const r = await api<Preview>("stock-imports/preview", { method: "POST", body: fd });
    if (r.ok) setXl({ st: "preview", file, pv: r.data, at: Date.now(), filter: false, ack: false, err: null, busy: false });
    else setXl({ st: "pick", err: r.data?.error ?? "ตรวจไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
  };

  const downloadTemplate = async () => {
    const res = await fetch("/api/proxy/stock-imports/template", { cache: "no-store" });
    if (!res.ok) return toast("ดาวน์โหลด template ไม่สำเร็จ");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "stock-import-template.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const apply = async () => {
    if (xl.st !== "preview") return;
    const { pv, file, ack } = xl;
    setXl({ ...xl, busy: true, err: null });
    const r = await api<{ batchId: number; lotsCreated: number; totalQty: number }>("stock-imports/apply", { method: "POST", json: { previewId: pv.previewId, confirmDuplicate: ack } });
    if (r.ok) {
      setXl({ st: "done", file: file.name, id: r.data.batchId, lots: r.data.lotsCreated, qty: r.data.totalQty });
      setOpenBatch(r.data.batchId);
      toast(`นำเข้า ${r.data.lotsCreated} ล็อต รวม ${r.data.totalQty} ชิ้น เรียบร้อย`);
      onApplied();
    } else if (r.status === 410) setXl({ st: "expired" });
    else setXl({ ...xl, busy: false, err: r.data?.error ?? "นำเข้าไม่สำเร็จ" });
  };

  const reset = () => setXl({ st: "pick", err: null });

  return (
    <div className="mt-4">
      {xl.st === "pick" && (
        <div className="in-up rounded-xl bg-white border border-stone-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">อัปโหลดไฟล์ Excel</h2>
              <p className="text-sm text-stone-600 mt-0.5">ตรวจก่อนบันทึก ถ้ามีแถวผิดแม้แถวเดียว ระบบจะไม่นำเข้าเลยทั้งไฟล์</p>
            </div>
            <button onClick={downloadTemplate} className={`${btn.ghost} min-h-[40px]`}>ดาวน์โหลด template (.xlsx)</button>
          </div>
          <label
            htmlFor="xlFile"
            onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
            onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
            className={`dz ${drag ? "drag" : ""} mt-4 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-300 px-4 py-10 text-center cursor-pointer hover:bg-stone-50 focus-within:ring-2 focus-within:ring-emerald-600`}
          >
            <svg viewBox="0 0 24 24" className="w-9 h-9 text-emerald-700" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V5m0 0l-4 4m4-4l4 4M5 16v2.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V16" /></svg>
            <span className="font-medium">ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</span>
            <span className="text-sm text-stone-500">รองรับเฉพาะ .xlsx ขนาดไม่เกิน 2 MB</span>
            <input ref={fileInput} id="xlFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only-in"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {xl.err && (
            <Xp key={xl.err}><p role="alert" className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{xl.err}</p></Xp>
          )}
          <div className="mt-4 rounded-lg bg-stone-50 border border-stone-200 p-3 text-sm">
            <div className="font-medium">คอลัมน์ที่ต้องมี (แถวแรกเป็นหัวตาราง ในชีต &quot;นำเข้า&quot;)</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {["รหัสสินค้า", "จำนวน", "วันหมดอายุ (yyyy-mm-dd)"].map((c) => <span key={c} className="rounded-md bg-white border border-stone-300 px-2 py-1">{c}</span>)}
            </div>
            <p className="mt-2 text-stone-600">รหัสสินค้าต้องมีในระบบก่อน ถ้าเป็นสินค้าใหม่ให้ไปสร้างในหน้าสินค้าก่อนแล้วค่อยนำเข้า</p>
          </div>
        </div>
      )}

      {xl.st === "checking" && (
        <div className="in-up rounded-xl bg-white border border-stone-200 p-8 text-center" role="status" aria-live="polite">
          <div className="spinner mx-auto" aria-hidden="true" />
          <div className="mt-4 font-medium">กำลังตรวจไฟล์…</div>
          <div className="text-sm text-stone-600 mt-1 break-all">{xl.file.name} · {fmtSize(xl.file.size)}</div>
          <p className="text-xs text-stone-500 mt-3">ตรวจรหัสสินค้า จำนวน และวันหมดอายุทุกแถว ยังไม่มีการบันทึกใดๆ</p>
        </div>
      )}

      {xl.st === "preview" && <PreviewView xl={xl} setXl={setXl} onApply={apply} onNew={reset} />}

      {xl.st === "done" && (
        <div className="in-up rounded-xl bg-white border border-stone-200 p-5 sm:p-6">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-2xl font-semibold" aria-hidden="true">✓</div>
          <h2 className="text-xl font-semibold mt-3">นำเข้า {xl.lots} ล็อต รวม {xl.qty.toLocaleString("th-TH")} ชิ้น</h2>
          <p className="text-stone-600 mt-1 break-all"><span className="num">{batchNo(xl.id)}</span> · {xl.file} · บันทึกทั้งไฟล์เรียบร้อย</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => document.getElementById("xlHistory")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" })} className={`${btn.primary} min-h-[44px]`}>ดูประวัติการนำเข้า</button>
            <button onClick={reset} className={`${btn.ghost} min-h-[44px]`}>นำเข้าไฟล์อื่น</button>
          </div>
        </div>
      )}

      {xl.st === "expired" && (
        <div className="in-up rounded-xl bg-white border border-stone-200 p-5 sm:p-6">
          <Xp>
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <b>ผลตรวจหมดอายุ</b> อัปโหลดใหม่อีกครั้ง
              <div className="text-sm mt-0.5">ผลตรวจเก็บไว้ 10 นาที เพื่อป้องกันนำเข้าด้วยข้อมูลที่เปลี่ยนไปแล้ว ยังไม่มีการบันทึกใดๆ</div>
            </div>
          </Xp>
          <button onClick={reset} className={`${btn.primary} mt-4 min-h-[44px]`}>เลือกไฟล์ใหม่</button>
        </div>
      )}

      {["pick", "done", "expired"].includes(xl.st) && (
        <div id="xlHistory" className="mt-4 bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-200 font-medium">ประวัติการนำเข้า (รายไฟล์)</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-stone-50 text-stone-600 text-left"><tr><th className="font-medium px-4 py-2">ไฟล์</th><th className="font-medium px-2 text-right">จำนวนล็อต</th><th className="font-medium px-2 text-right">จำนวนรวม</th><th className="font-medium px-2">ผู้นำเข้า</th><th className="font-medium px-2">เวลา</th><th className="px-4" /></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {batches.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-stone-500">ยังไม่มีการนำเข้าแบบไฟล์</td></tr>}
                {batches.map((b) => {
                  const isOpen = openBatch === b.id;
                  return (
                    <BatchRow key={b.id} b={b} open={isOpen} onToggle={() => setOpenBatch(isOpen ? null : b.id)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function BatchRow({ b, open, onToggle }: { b: Batch; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr data-batch={b.id}>
        <td className="px-4 py-2.5"><div className="font-medium break-all">{b.fileName}</div><div className="text-xs text-stone-500 num">{batchNo(b.id)}</div></td>
        <td className="px-2 text-right num">{b.rowCount}</td>
        <td className="px-2 text-right num">{b.totalQty.toLocaleString("th-TH")}</td>
        <td className="px-2 whitespace-nowrap">{b.importedBy ?? "—"}</td>
        <td className="px-2 num whitespace-nowrap">{fmtDateTime(b.createdAt)}</td>
        <td className="px-4 text-right whitespace-nowrap"><button onClick={onToggle} aria-expanded={open} className={`${btn.link} min-h-[40px]`}>{open ? "ซ่อนล็อต" : "ดูล็อต"}</button></td>
      </tr>
      {open && (
        <tr className="bg-stone-50">
          <td colSpan={6} className="px-4 py-0">
            <Xp>
              <table className="w-full text-sm my-2">
                <thead className="text-stone-500 text-left"><tr><th className="font-medium py-1">รหัส</th><th className="font-medium">ชื่อสินค้า</th><th className="font-medium text-right">จำนวน</th><th className="font-medium text-right">exp</th></tr></thead>
                <tbody>
                  {b.lots.map((l, i) => (
                    <tr key={i} className="border-t border-stone-200"><td className="py-1.5 num whitespace-nowrap">{l.productCode}</td><td>{l.productName}</td><td className="text-right num">{l.qty}</td><td className="text-right num whitespace-nowrap pl-3">{fmtDate(l.expDate)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Xp>
          </td>
        </tr>
      )}
    </>
  );
}

function PreviewView({ xl, setXl, onApply, onNew }: {
  xl: Extract<Xl, { st: "preview" }>; setXl: (x: Xl) => void; onApply: () => void; onNew: () => void;
}) {
  const { pv, file } = xl;
  const s = pv.summary;
  const lots = s.ok + s.warning;
  const dup = pv.duplicateFile && s.error === 0;
  const rows = xl.filter ? pv.rows.filter((r) => r.status !== "ok") : pv.rows;
  const card = (l: string, v: number, cls: string) => (
    <div className={`rounded-xl border p-3 ${cls}`}><div className="text-xs">{l}</div><div className="text-2xl font-semibold num leading-tight">{v}</div></div>
  );
  const badgeOf = {
    ok: <Badge cls="bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">ผ่าน</Badge>,
    warning: <Badge cls="bg-amber-100 text-amber-800 ring-1 ring-amber-300">เตือน</Badge>,
    error: <Badge cls="bg-rose-100 text-rose-800 ring-1 ring-rose-300">ผิด</Badge>,
  };
  const rowBg = { ok: "", warning: "bg-amber-50/70", error: "bg-rose-50" };
  const disabled = s.error > 0 || (dup && !xl.ack) || xl.busy || lots === 0;

  return (
    <div className="in-up space-y-4">
      <div className="rounded-xl bg-white border border-stone-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-stone-500">ผลตรวจไฟล์</div>
          <div className="font-medium break-all">{file.name} <span className="text-sm text-stone-500 font-normal">· {fmtSize(file.size)}</span></div>
          <div className="text-xs text-stone-500 mt-0.5">ผลตรวจนี้ใช้ได้ 10 นาที (หมดอายุ {fmtTime(new Date(xl.at + 10 * 60 * 1000).toISOString())}) · ยังไม่ได้บันทึก</div>
        </div>
        <button onClick={onNew} className={`${btn.ghost} min-h-[40px]`}>เลือกไฟล์ใหม่</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
        {card("แถวทั้งหมด", s.total, "bg-white border-stone-200 text-stone-700")}
        {card("ผ่าน", s.ok, "bg-emerald-50 border-emerald-200 text-emerald-800")}
        {card("เตือน", s.warning, "bg-amber-50 border-amber-300 text-amber-900")}
        {card("ผิด", s.error, s.error ? "bg-rose-50 border-rose-300 text-rose-900" : "bg-white border-stone-200 text-stone-500")}
        <div className="col-span-2 sm:col-span-1 rounded-xl border p-3 bg-white border-stone-200 text-stone-700">
          <div className="text-xs">จำนวนรวมที่จะเข้า</div>
          <div className="text-2xl font-semibold num leading-tight">{s.totalQty.toLocaleString("th-TH")} <span className="text-sm font-normal">ชิ้น</span></div>
          <div className="text-xs text-stone-500">{lots} ล็อต{s.error ? " (เมื่อแก้ไฟล์ครบ)" : ""}</div>
        </div>
      </div>
      <div className="rounded-xl bg-white border border-stone-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium">รายแถว</div>
          <label className="inline-flex items-center gap-2 text-sm min-h-[40px]">
            <input type="checkbox" id="xlFilter" checked={xl.filter} onChange={(e) => setXl({ ...xl, filter: e.target.checked })} /> แสดงเฉพาะแถวที่ผิด/เตือน
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-stone-50 text-stone-600 text-left"><tr><th className="font-medium px-4 py-2 whitespace-nowrap">แถว Excel</th><th className="font-medium px-2">รหัส</th><th className="font-medium px-2">ชื่อสินค้า</th><th className="font-medium px-2 text-right">จำนวน</th><th className="font-medium px-2">exp</th><th className="font-medium px-2">สถานะ</th><th className="font-medium px-4">ข้อความ</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => {
                const msg = r.messages.join(" · ");
                return (
                  <tr key={r.row} data-row={r.row} className={rowBg[r.status]}>
                    <td className="px-4 py-2.5 num whitespace-nowrap font-medium">{r.row}</td>
                    <td className="px-2 num whitespace-nowrap">{r.code || <span className="text-rose-700">(ว่าง)</span>}</td>
                    <td className="px-2">{r.productName ?? <span className="text-stone-400">—</span>}</td>
                    <td className={`px-2 text-right num ${r.status === "error" && /จำนวน/.test(msg) ? "text-rose-700 font-medium" : ""}`}>{r.qty === "" ? <span className="text-rose-700">(ว่าง)</span> : r.qty}</td>
                    <td className={`px-2 num whitespace-nowrap ${r.status === "error" && /วัน/.test(msg) ? "text-rose-700 font-medium" : ""}`}>{r.expDate === "" ? <span className="text-rose-700">(ว่าง)</span> : r.expDate}</td>
                    <td className="px-2 whitespace-nowrap">{badgeOf[r.status]}</td>
                    <td className={`px-4 py-2 ${r.status === "error" ? "text-rose-900" : r.status === "warning" ? "text-amber-900" : "text-stone-600"}`}>
                      {r.status === "ok" ? "พร้อมนำเข้า" : msg}
                      {r.status === "error" && /ไม่พบรหัส/.test(msg) && r.code && <> <Link href={`/admin/products?new=${encodeURIComponent(r.code)}`} className={`${btn.link} min-h-[32px]`}>สร้างสินค้า</Link></>}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-stone-500">ไม่มีแถวที่ผิดหรือเตือน</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl bg-white border border-stone-200 p-4">
        {dup && (
          <Xp>
            <div role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <b>ไฟล์นี้เคยนำเข้าแล้ว</b> การนำเข้าซ้ำจะทำให้สต็อกเพิ่มเป็น 2 เท่า
              <label className="mt-2 flex items-start gap-2 min-h-[40px]"><input type="checkbox" id="xlAck" className="mt-1" checked={xl.ack} onChange={(e) => setXl({ ...xl, ack: e.target.checked })} /> <span>ยืนยันว่าตั้งใจนำเข้าซ้ำ</span></label>
            </div>
          </Xp>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button id="xlConfirm" onClick={onApply} disabled={disabled} className={`${btn.primary} min-h-[44px] px-5`}>{xl.busy ? "กำลังนำเข้า…" : `ยืนยันนำเข้า ${lots} ล็อต`}</button>
          {s.error > 0 ? (
            <span className="text-sm text-rose-800"><b>แก้ไฟล์แล้วอัปโหลดใหม่</b> พบ {s.error} แถวที่ผิด จึงยังนำเข้าไม่ได้ (นำเข้าทั้งไฟล์หรือไม่นำเข้าเลย)</span>
          ) : dup && !xl.ack ? (
            <span className="text-sm text-stone-600">ติ๊กยืนยันก่อนจึงจะนำเข้าได้</span>
          ) : (
            <span className="text-sm text-stone-600">ไม่พบแถวที่ผิด พร้อมนำเข้า</span>
          )}
          <button onClick={onNew} className={`${btn.ghost} min-h-[44px] sm:ml-auto`}>เลือกไฟล์ใหม่</button>
        </div>
        {xl.err && <p role="alert" className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{xl.err}</p>}
      </div>
    </div>
  );
}

export default function StockImportPage() {
  return (
    <Suspense>
      <ImportPage />
    </Suspense>
  );
}
