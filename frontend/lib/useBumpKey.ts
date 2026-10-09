"use client";
import { useState } from "react";

/** Returns a counter that increments whenever `value` changes after mount (use as React key to replay num-bump). */
export function useBumpKey(value: unknown) {
  const [prev, setPrev] = useState(value);
  const [n, setN] = useState(0);
  if (prev !== value) {
    setPrev(value);
    setN((x) => x + 1);
  }
  return n;
}
