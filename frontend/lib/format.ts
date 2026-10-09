export const baht = (n: number) => "฿" + n.toLocaleString("th-TH");

const midnight = (s: string) => new Date(s + "T00:00:00");
export const todayDate = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
export const daysTo = (s: string) => Math.round((midnight(s.slice(0, 10)).getTime() - todayDate().getTime()) / 86400000);
export const fmtDate = (s: string) =>
  midnight(s.slice(0, 10)).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
// server timestamps may come without a zone suffix (SQLite) - they are UTC
const asUtc = (iso: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
export const fmtDateTime = (iso: string) =>
  asUtc(iso).toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
export const fmtTime = (iso: string) => asUtc(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
export const fmtSize = (b: number) => (b < 1024 * 1024 ? (b / 1024).toFixed(0) + " KB" : (b / 1024 / 1024).toFixed(1) + " MB");
export const orderNo = (id: number) => "ORD-" + String(id).padStart(4, "0");
export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
