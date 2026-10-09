"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { reducedMotion } from "@/lib/format";

export type CartItem = { productId: number; code: string; name: string; price: number; qty: number };
type ProductLite = { id: number; code: string; name: string; price: number };
type Chip = { hold: boolean; badgeVal: number; chips: number; pend: Record<string, number> };

type CartCtx = {
  items: CartItem[];
  ready: boolean;
  count: number;
  /** number shown in the navbar badge (held back while chips are in flight) */
  badge: number;
  /** quantity of each code still "in flight" (not yet shown on the card) */
  pend: Record<string, number>;
  add: (p: ProductLite, n: number) => void;
  addWithChip: (p: ProductLite, n: number, numEl: Element | null) => void;
  setQty: (productId: number, qty: number) => void;
  remove: (productId: number) => { item: CartItem; idx: number } | null;
  restore: (item: CartItem, idx: number) => void;
  replace: (items: CartItem[]) => void;
  clear: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
const keyFor = (email?: string | null) => `cart:${email ?? "guest"}`;

function read(key: string): CartItem[] {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(key: string, items: CartItem[]) {
  try {
    if (items.length) localStorage.setItem(key, JSON.stringify(items));
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable: cart lives in memory only */
  }
}

/** Merge the guest cart into the user's cart (call right after login). */
export function mergeGuestCart(email: string) {
  const guest = read(keyFor(null));
  if (!guest.length) return;
  const mine = read(keyFor(email));
  for (const g of guest) {
    const m = mine.find((x) => x.productId === g.productId);
    if (m) m.qty += g.qty;
    else mine.push(g);
  }
  write(keyFor(email), mine);
  try { localStorage.removeItem(keyFor(null)); } catch { /* ignore */ }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const key = keyFor(user?.email);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [chip, setChip] = useState<Chip>({ hold: false, badgeVal: 0, chips: 0, pend: {} });
  const keyRef = useRef(key);
  useEffect(() => { keyRef.current = key; }, [key]);

  // (re)load when the user changes. state is set inside a microtask-free callback via queueMicrotask to avoid sync setState in effect
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      setItems(read(key));
      setLoadedKey(key);
    });
    return () => { alive = false; };
  }, [key]);
  const ready = loadedKey === key;

  const update = useCallback((fn: (prev: CartItem[]) => CartItem[]) => {
    setItems((prev) => {
      const next = fn(prev);
      write(keyRef.current, next);
      return next;
    });
  }, []);

  const add = useCallback((p: ProductLite, n: number) => {
    update((prev) => {
      const i = prev.findIndex((x) => x.productId === p.id);
      if (i >= 0) return prev.map((x, j) => (j === i ? { ...x, qty: x.qty + n, price: p.price, name: p.name } : x));
      return [...prev, { productId: p.id, code: p.code, name: p.name, price: p.price, qty: n }];
    });
  }, [update]);

  const count = useMemo(() => items.reduce((s, i) => s + i.qty, 0), [items]);

  const addWithChip = useCallback((p: ProductLite, n: number, numEl: Element | null) => {
    const before = count;
    add(p, n);
    if (reducedMotion() || !numEl) return;
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const tgt = [...document.querySelectorAll(".cart-badge")].find(vis) ?? [...document.querySelectorAll("[data-nav-cart]")].find(vis);
    if (!tgt) return;
    const rect = numEl.getBoundingClientRect();
    const r = tgt.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(numEl).fontSize) || 14;
    setChip((s) => ({ hold: true, badgeVal: s.hold ? s.badgeVal : before, chips: s.chips + 1, pend: { ...s.pend, [p.code]: (s.pend[p.code] || 0) + n } }));
    const c = document.createElement("div");
    c.className = "chip";
    c.setAttribute("aria-hidden", "true");
    c.style.cssText = `--x0:${rect.left + rect.width / 2}px;--y0:${rect.top + rect.height / 2}px;--x1:${r.left + r.width / 2}px;--y1:${r.top + r.height / 2}px;--s0:${fs / 12}`;
    c.innerHTML = `<span class="chip-y"><span class="chip-s num"><span class="chip-bg"></span><span class="chip-n">${n}</span><span class="chip-p">+${n}</span></span></span>`;
    document.body.appendChild(c);
    setTimeout(() => {
      c.remove();
      setChip((s) => {
        const chips = s.chips - 1;
        if (chips <= 0) return { hold: false, badgeVal: 0, chips: 0, pend: {} };
        return { hold: true, badgeVal: s.badgeVal + n, chips, pend: { ...s.pend, [p.code]: (s.pend[p.code] || 0) - n } };
      });
    }, 460);
  }, [add, count]);

  const setQty = useCallback((productId: number, qty: number) => {
    update((prev) => prev.map((x) => (x.productId === productId ? { ...x, qty: Math.max(1, qty) } : x)));
  }, [update]);

  const remove = useCallback((productId: number) => {
    const idx = items.findIndex((x) => x.productId === productId);
    if (idx < 0) return null;
    const item = items[idx];
    update((prev) => prev.filter((x) => x.productId !== productId));
    return { item, idx };
  }, [items, update]);

  const restore = useCallback((item: CartItem, idx: number) => {
    update((prev) => {
      if (prev.some((x) => x.productId === item.productId)) return prev;
      const next = [...prev];
      next.splice(Math.min(idx, next.length), 0, item);
      return next;
    });
  }, [update]);

  const replace = useCallback((next: CartItem[]) => update(() => next), [update]);
  const clear = useCallback(() => update(() => []), [update]);

  const value: CartCtx = {
    items, ready, count,
    badge: chip.hold ? chip.badgeVal : count,
    pend: chip.pend,
    add, addWithChip, setQty, remove, restore, replace, clear,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
