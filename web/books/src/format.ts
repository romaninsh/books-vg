// Display helpers. Money in GBP, two decimals, thousands separators; dates dd/mm/yyyy.

const money = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return money.format(Math.abs(v) < 0.005 ? 0 : v); // no "-0.00"
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = v.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : v;
}
