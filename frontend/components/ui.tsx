import Link from "next/link";

export const btn = {
  primary:
    "inline-flex items-center justify-center rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium px-4 py-2 disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed",
  ghost:
    "inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 text-sm font-medium px-3 py-1.5 disabled:opacity-50",
  link: "text-sm font-medium text-emerald-700 hover:text-emerald-900 underline underline-offset-2",
  danger: "text-sm font-medium text-rose-700 hover:text-rose-900",
};
export const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none";

export function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
export const B = {
  Near: () => <Badge cls="bg-amber-100 text-amber-800 ring-1 ring-amber-300">ใกล้หมดอายุ</Badge>,
  Out: () => <Badge cls="bg-stone-200 text-stone-700">หมด</Badge>,
  Expired: () => <Badge cls="bg-rose-100 text-rose-800 ring-1 ring-rose-300">หมดอายุ · ขายไม่ได้</Badge>,
  Ok: () => <Badge cls="bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">ปกติ</Badge>,
  On: () => <Badge cls="bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">เปิดขาย</Badge>,
  Off: () => <Badge cls="bg-stone-200 text-stone-600">ปิดการขาย</Badge>,
};

export const TRASH = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
    <path d="M3.5 5.5h13M8 5.5V4a1 1 0 011-1h2a1 1 0 011 1v1.5M5.5 5.5l.7 10a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4l.7-10M8.5 9v5M11.5 9v5" />
  </svg>
);

export function DelBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm font-medium">
      {TRASH}
      {label}
    </button>
  );
}

/** expand/collapse box (grid-template-rows 0fr<->1fr). `animate` plays the expand-in once on mount. */
export function Xp({ children, animate = true, collapsing = false, as: As = "div", className = "" }: {
  children: React.ReactNode; animate?: boolean; collapsing?: boolean; as?: "div" | "li"; className?: string;
}) {
  return (
    <As className={`xp ${animate ? "expand-in" : ""} ${collapsing ? "collapsing" : ""} ${className}`}>
      <div className="xp-in">{children}</div>
    </As>
  );
}

export function Forbidden({ code, title, text, href, cta }: { code: string; title: string; text: string; href: string; cta: string }) {
  return (
    <div className="max-w-md mx-auto mt-10 bg-white border border-stone-200 rounded-xl p-8 text-center">
      <div className="text-4xl font-semibold text-stone-300 num">{code}</div>
      <h1 className="text-lg font-semibold mt-2">{title}</h1>
      <p className="text-sm text-stone-600 mt-1">{text}</p>
      <Link href={href} className={`${btn.primary} mt-4 min-h-[44px]`}>{cta}</Link>
    </div>
  );
}
