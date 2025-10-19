export function objectToRows(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).map(([name, stats]) => ({ name, ...stats }));
}

export function asNum(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}