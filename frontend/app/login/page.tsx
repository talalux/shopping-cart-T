"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { mergeGuestCart } from "@/lib/cart";
import { btn, inputCls } from "@/components/ui";

const DEV = process.env.NODE_ENV === "development";
const ACCOUNTS = [
  { label: "ลูกค้า", email: "customer@example.com" },
  { label: "เจ้าหน้าที่", email: "staff@example.com" },
];

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: pass }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(res.status === 401 ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : data?.error ?? "เข้าสู่ระบบไม่สำเร็จ");
        return;
      }
      mergeGuestCart(data.email);
      setUser({ email: data.email, role: data.role });
      const next = sp.get("next");
      const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.push(safe ?? (data.role === "Staff" ? "/admin/products" : "/shop"));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto pt-4 sm:pt-10">
      <h1 className="text-2xl font-semibold">เข้าสู่ระบบ</h1>
      <p className="text-sm text-stone-600 mt-1">ใช้อีเมลและรหัสผ่านที่ได้รับจากร้าน</p>
      <form onSubmit={submit} className="mt-6 bg-white border border-stone-200 rounded-xl p-5 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">อีเมล</span>
          <input id="lEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1`} placeholder="name@example.com" autoComplete="username" required />
        </label>
        <label className="block">
          <span className="text-sm font-medium">รหัสผ่าน</span>
          <input id="lPass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} className={`${inputCls} mt-1`} autoComplete="current-password" required />
        </label>
        {err && <p role="alert" className="text-sm text-rose-700">{err}</p>}
        <button disabled={busy} className={`${btn.primary} w-full py-2.5`}>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>
      </form>
      {DEV && (
        <div className="mt-4 rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 text-sm">
          <div className="font-medium text-amber-900">บัญชีทดสอบ <span className="font-normal text-amber-800">(เฉพาะช่วงพัฒนา)</span></div>
          <ul className="mt-2 space-y-2">
            {ACCOUNTS.map((a) => (
              <li key={a.email} className="flex items-center justify-between gap-3 flex-wrap">
                <span><span className="text-stone-600">{a.label}</span> <code className="num">{a.email}</code> / <code>Test1234!</code></span>
                <button type="button" onClick={() => { setEmail(a.email); setPass("Test1234!"); }} className={btn.link}>ใช้บัญชีนี้</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
