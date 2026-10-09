"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type RevealInfo = { d: number; now: boolean };
const EMPTY: Record<string, RevealInfo> = {};
// .rv-on is set in layout.tsx only when IO exists and motion is allowed; without it cards are plain visible -> do nothing
// (revealing anyway would fade an already visible card from 0 under reduced motion)
const revealOn = () => document.documentElement.classList.contains("rv-on");

/**
 * Card reveal on enter (IntersectionObserver) with a stagger counted per batch of cards entering together.
 * mode "page": cards already in the viewport on the first batch appear instantly (no empty beat).
 * mode "grid": every card goes through the stagger (filter / search).
 */
export function useReveal(resetKey: string, mode: "page" | "grid", itemCount: number) {
  const [st, setSt] = useState<{ key: string; map: Record<string, RevealInfo> }>({ key: resetKey, map: EMPTY });
  const map = st.key === resetKey ? st.map : EMPTY;
  const els = useRef(new Set<HTMLElement>());
  const io = useRef<IntersectionObserver | null>(null);
  const firstBatch = useRef(mode === "page");

  // observe on mount (not from an effect keyed on counts: a new result set of the same length would never be observed).
  // "in" on the element = already revealed. observe() twice on the same target is a no-op, so StrictMode's
  // mount -> cleanup -> mount ends observed. If the IO does not exist yet, the IO effect below picks the element up.
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    els.current.add(el);
    if (!el.classList.contains("in")) io.current?.observe(el);
    return () => {
      els.current.delete(el);
      io.current?.unobserve(el);
    };
  }, []);

  useEffect(() => {
    firstBatch.current = mode === "page";
    if (!("IntersectionObserver" in window) || !revealOn()) return;
    const o = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting && !(e.target as HTMLElement).classList.contains("in"))
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
        if (!hit.length) return;
        const now = firstBatch.current;
        firstBatch.current = false;
        setSt((prev) => {
          const base = prev.key === resetKey ? prev.map : {};
          const next = { ...base };
          hit.forEach((e, i) => {
            const id = (e.target as HTMLElement).dataset.code!;
            if (!next[id]) next[id] = { d: Math.min(i * 35, 280), now }; // never overwrite: changing now/d replays the animation
          });
          return { key: resetKey, map: next };
        });
        hit.forEach((e) => o.unobserve(e.target));
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    io.current = o;
    // a new IO (resetKey / mode changed) starts empty: observe every card already mounted and not yet revealed
    els.current.forEach((el) => { if (!el.classList.contains("in")) o.observe(el); });
    return () => { o.disconnect(); io.current = null; };
  }, [resetKey, mode]);

  // safety net: a card on screen for > 1s without "in" is revealed instantly (no motion is fine, an invisible card is not)
  useEffect(() => {
    if (!("IntersectionObserver" in window) || !revealOn()) return;
    const seen = new Map<HTMLElement, number>();
    const t = setInterval(() => {
      const late: HTMLElement[] = [];
      const ts = performance.now();
      els.current.forEach((el) => {
        if (el.classList.contains("in")) return void seen.delete(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.bottom <= 0 || r.top >= window.innerHeight) return void seen.delete(el);
        const since = seen.get(el);
        if (since === undefined) seen.set(el, ts);
        else if (ts - since >= 1000) late.push(el);
      });
      if (!late.length) return;
      late.forEach((el) => { seen.delete(el); io.current?.unobserve(el); });
      setSt((prev) => {
        const next = { ...(prev.key === resetKey ? prev.map : {}) };
        late.forEach((el) => { next[el.dataset.code!] ??= { d: 0, now: true }; });
        return { key: resetKey, map: next };
      });
    }, 250);
    return () => clearInterval(t);
  }, [resetKey]);

  // observe cards added later (infinite scroll page 2+)
  useEffect(() => {
    els.current.forEach((el) => {
      if (!map[el.dataset.code!]) io.current?.observe(el);
    });
  }, [itemCount, resetKey, map]);

  return { ref, map };
}
