"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { mmss, useCountdown } from "@/lib/useCountdown";
import { Badge, btn } from "@/components/ui";

type Pending = {
  orderId: number; name: string; mode: "email" | "sms"; maskedTarget: string; expiresAt: string; sentAt: string;
  items: { code: string; name: string; qty: number; price: number }[];
};
type Outbox = { to: string; body: string; link: string; sentAt: string };

const DEV = process.env.NODE_ENV === "development";
const orderNo = (id: number) => "ORD-" + String(id).padStart(4, "0");

function loadPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem("pendingOrder");
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}

export default function SentPage() {
  const { toast } = useToast();
  const [pending, setPending] = useState<Pending | null | undefined>(undefined);
  const [cool, setCool] = useState(60);
  const [rateLeft, setRateLeft] = useCountdown(); // 429 from the API: seconds until resend is allowed again
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "warn" | "err"; text: string } | null>(null);
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [version, setVersion] = useState(0); // bumps after each (re)send so the dev outbox refetches

  useEffect(() => {
    const t = setTimeout(() => setPending(loadPending()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setCool((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  const orderId = pending?.orderId;
  useEffect(() => {
    if (!DEV || !orderId) return;
    let alive = true;
    api<Outbox>(`dev/outbox/latest?orderId=${orderId}`).then((r) => { if (alive && r.ok) setOutbox(r.data); });
    return () => { alive = false; };
  }, [orderId, version]);

  if (pending === undefined) return <div className="max-w-lg mx-auto" />;
  if (!pending)
    return (
      <div className="max-w-md mx-auto mt-10 bg-white border border-stone-200 rounded-xl p-8 text-center">
        <p className="text-sm text-stone-600">ไม่พบคำสั่งซื้อที่รอยืนยัน หน้านี้ใช้หลังสั่งซื้อในฐานะผู้เยี่ยมชม</p>
        <Link href="/shop" className={`${btn.primary} mt-4 min-h-[44px]`}>ไปเลือกสินค้า</Link>
      </div>
    );

  const resend = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ maskedTarget: string; expiresAt: string }>(`orders/guest/${pending.orderId}/resend`, { method: "POST" });
      if (r.status === 202) {
        const next = { ...pending, maskedTarget: r.data.maskedTarget, expiresAt: r.data.expiresAt, sentAt: new Date().toISOString() };
        setPending(next);
        try { sessionStorage.setItem("pendingOrder", JSON.stringify(next)); } catch { /* ignore */ }
        setCool(60);
        setVersion((v) => v + 1);
        toast("ส่งลิงก์ใหม่แล้ว ลิงก์เดิมใช้ไม่ได้อีก");
      } else if (r.status === 429) {
        const secs = parseInt(r.headers.get("retry-after") ?? "600", 10) || 600;
        setRateLeft(secs);
      } else if (r.status === 409) setMsg({ kind: "err", text: "คำสั่งซื้อนี้ไม่อยู่ในสถานะรอยืนยันแล้ว (อาจยืนยันไปแล้ว)" });
      else setMsg({ kind: "err", text: r.data?.error ?? "ส่งลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    } finally { setBusy(false); }
  };

  const linkPath = outbox ? new URL(outbox.link).pathname : null;
  return (
    <div className="max-w-lg mx-auto">
      <div className="rounded-xl bg-white border border-stone-200 p-5 sm:p-6">
        <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-2xl" aria-hidden="true">✉</div>
        <h1 className="text-2xl font-semibold mt-3">ตรวจสอบ {pending.mode === "email" ? "email" : "SMS"} ของคุณ</h1>
        <p className="text-stone-700 mt-2">เราส่งลิงก์ยืนยันไปที่ <b className="num break-all">{pending.maskedTarget}</b> แล้ว กดลิงก์เพื่อยืนยันคำสั่งซื้อ</p>
        <ul className="mt-4 space-y-2 text-sm">
          <li className="flex gap-2"><span className="text-amber-700">●</span><span>ลิงก์หมดอายุใน <b>30 นาที</b> (ส่งเมื่อ {fmtTime(pending.sentAt)} · หมดอายุ {fmtTime(pending.expiresAt)}) และใช้ยืนยันได้ครั้งเดียว</span></li>
          <li className="flex gap-2"><span className="text-stone-500">●</span><span>คำสั่งซื้อ <b className="num">{orderNo(pending.orderId)}</b> อยู่ในสถานะ <Badge cls="bg-amber-100 text-amber-800 ring-1 ring-amber-300">รอยืนยัน</Badge> ยังไม่มีการตัดสต็อกจนกว่าคุณจะกดลิงก์</span></li>
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button id="resendBtn" onClick={resend} disabled={cool > 0 || busy || rateLeft > 0} className={`${btn.ghost} min-h-[44px] px-4`}>
            {cool > 0 ? `ส่งอีกครั้งได้ใน ${cool} วินาที` : busy ? "กำลังส่ง…" : "ส่งลิงก์อีกครั้ง"}
          </button>
          <Link href="/cart" className={`${btn.link} min-h-[40px] inline-flex items-center`}>แก้ข้อมูลผู้สั่ง</Link>
        </div>
        {rateLeft > 0 && (
          <p role="alert" data-testid="rate-box" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <b>ส่งบ่อยเกินไป</b> ลองใหม่ได้ในอีก <span className="num" data-testid="rate-left">{mmss(rateLeft)}</span>
          </p>
        )}
        {msg && (
          <p role="alert" className={`mt-3 rounded-lg border px-3 py-2 text-sm ${msg.kind === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-rose-300 bg-rose-50 text-rose-900"}`}>{msg.text}</p>
        )}
        <p className="text-xs text-stone-500 mt-3">ไม่พบข้อความ? ตรวจโฟลเดอร์สแปม การส่งใหม่จะทำให้ลิงก์เดิมใช้ไม่ได้</p>
      </div>

      {DEV && (
        <details open className="mt-4 rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 text-sm">
          <summary className="cursor-pointer font-medium text-amber-900 min-h-[32px]">ดูข้อความใน outbox (dev)</summary>
          {outbox ? (
            <div className="mt-2 rounded-lg bg-white border border-amber-200 p-3 text-stone-700">
              <div className="text-xs text-stone-500">ถึง: <span className="num">{pending.maskedTarget}</span> · ส่ง {fmtTime(outbox.sentAt)}</div>
              <p className="mt-1 whitespace-pre-line">{outbox.body.split("\n").filter((l) => l && !l.startsWith("http")).slice(3, 7).join("\n")}</p>
              <p className="mt-1 num text-xs break-all text-emerald-800" data-testid="outbox-link">{linkPath}</p>
              <a href={linkPath ?? "#"} className={`${btn.primary} mt-3 min-h-[44px]`}>เปิดลิงก์ยืนยัน (จำลองการกดลิงก์)</a>
            </div>
          ) : (
            <p className="mt-2 text-stone-600">ยังไม่พบข้อความใน outbox</p>
          )}
        </details>
      )}
    </div>
  );
}
