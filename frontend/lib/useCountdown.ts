"use client";
import { useEffect, useState } from "react";

/** Whole-second countdown. `start(secs)` begins it (e.g. from Retry-After); reaches 0 and stops. */
export function useCountdown(): [number, (secs: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
}

export const mmss = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
