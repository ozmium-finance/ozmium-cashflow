// Daml's JSON API tends to encode Numeric/Decimal as strings so it
// doesn't lose precision going through a JSON number -- accept either.
export function num(v) {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? parseFloat(v) : v;
}

export function money(v, currency) {
  const n = num(v);
  if (n === null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? " " + currency : ""}`;
}

// Party ids come back as "DisplayName::fingerprint" -- show just the
// display name, the fingerprint is only useful for debugging.
export function partyLabel(p) {
  if (!p) return "—";
  return String(p).split("::")[0];
}

export function shortCid(cid) {
  if (!cid) return "";
  return cid.slice(0, 10) + "…" + cid.slice(-6);
}
