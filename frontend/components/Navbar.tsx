"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { Roll } from "@/components/Roll";
import { btn } from "@/components/ui";

const ROLE_TH = { Customer: "ลูกค้า", Staff: "เจ้าหน้าที่", guest: "ผู้เยี่ยมชม" } as const;

export function Navbar() {
  const { user, logout, setUser } = useAuth();
  const { badge, ready } = useCart();
  const pathname = usePathname();
  const router = useRouter();
  const role = user?.role ?? "guest";

  if (pathname === "/login") {
    return (
      <header className="sticky top-0 z-30 bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center">
          <span className="font-semibold text-emerald-800">Shop Cart</span>
        </div>
      </header>
    );
  }

  const bval = ready ? badge : 0;
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const link = (href: string, label: React.ReactNode, admin = false, extra?: Record<string, string>) => (
    <Link
      key={href}
      href={href}
      {...extra}
      aria-current={active(href) ? "page" : undefined}
      className={`inline-flex items-center whitespace-nowrap rounded-lg px-3 min-h-[36px] text-sm font-medium ${
        active(href) ? (admin ? "bg-stone-800 text-white" : "bg-emerald-50 text-emerald-800") : "text-stone-600 hover:bg-stone-100"
      }`}
    >
      {label}
    </Link>
  );

  const cartLabel = (
    <>
      ตะกร้า
      {bval > 0 && (
        <span className="cart-badge ml-1 inline-block rounded-full bg-emerald-700 text-white text-xs px-1.5 py-0.5 num">
          <Roll value={bval} />
        </span>
      )}
    </>
  );

  const shop = [
    link("/shop", "ร้านค้า"),
    link("/cart", cartLabel, false, { "data-nav-cart": "" }),
    ...(role !== "guest" ? [link("/orders", "คำสั่งซื้อของฉัน")] : []),
  ];
  const admin = role === "Staff" ? [link("/admin/products", "สินค้า", true), link("/admin/stock-import", "นำเข้าสต็อก", true)] : [];

  const doLogout = async () => {
    await logout();
    setUser(null);
    router.push("/shop");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-4">
        <div className="h-14 flex items-center gap-4">
          <span className="font-semibold text-emerald-800 shrink-0">Shop Cart</span>
          <nav className="hidden lg:flex items-center gap-1 flex-1" aria-label="เมนูหลัก">
            {role === "Staff" && <span className="text-[11px] font-medium text-stone-400 mr-1 whitespace-nowrap">ซื้อของ</span>}
            {shop}
            {admin.length > 0 && (
              <>
                <span className="mx-2 h-6 w-px bg-stone-200" aria-hidden="true" />
                <span className="text-[11px] font-medium text-stone-400 mr-1 whitespace-nowrap">จัดการร้าน</span>
                {admin}
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 min-w-0">
            <div className="text-right leading-tight min-w-0">
              <div className={`text-sm truncate max-w-[9.5rem] sm:max-w-none ${user ? "text-stone-800" : "text-stone-500"}`}>
                {user ? user.email : "ยังไม่ได้เข้าสู่ระบบ"}
              </div>
              <div className="text-xs text-stone-500">{ROLE_TH[role]}</div>
            </div>
            {user ? (
              <button onClick={doLogout} className={`${btn.ghost} shrink-0`}>ออกจากระบบ</button>
            ) : (
              <Link href="/login" className={`${btn.primary} shrink-0`}>เข้าสู่ระบบ</Link>
            )}
          </div>
        </div>
        <nav className="lg:hidden pb-2 space-y-1" aria-label="เมนูหลัก (มือถือ)">
          <div className="flex items-center gap-1">
            {role === "Staff" && <span className="w-16 shrink-0 text-[11px] font-medium text-stone-400">ซื้อของ</span>}
            <div className="flex gap-1 overflow-x-auto">{shop}</div>
          </div>
          {admin.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="w-16 shrink-0 text-[11px] font-medium text-stone-400">จัดการร้าน</span>
              <div className="flex gap-1 overflow-x-auto">{admin}</div>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
