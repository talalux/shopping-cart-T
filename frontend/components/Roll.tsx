"use client";
import { useEffect, useState } from "react";

/** Rolling digit (odometer): old number slides up and out, new one slides in from below. */
export function Roll({ value }: { value: number }) {
  const [prev, setPrev] = useState(value);
  const [from, setFrom] = useState<number | null>(null);
  const [key, setKey] = useState(0);
  if (value !== prev) {
    // adjust state during render (no effect needed)
    setPrev(value);
    setFrom(prev);
    setKey((k) => k + 1);
  }
  useEffect(() => {
    if (from === null) return;
    const t = setTimeout(() => setFrom(null), 280);
    return () => clearTimeout(t);
  }, [from, key]);

  if (from === null) return <span className="roll roll-static"><span>{value}</span></span>;
  return (
    <span key={key} className="roll" style={{ ["--w0" as string]: `${Math.max(1, String(from).length)}ch`, ["--w1" as string]: `${String(value).length}ch` }}>
      <span className="roll-old" aria-hidden="true">{from}</span>
      <span className="roll-new">{value}</span>
    </span>
  );
}
