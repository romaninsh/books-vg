import type { Draft, Line, Totals } from "./store";

// Totals of a draft, computed the way the server does (net per line rounded to pence),
// so the preview matches what the save will produce.

const r2 = (v: number) => Math.round(v * 100) / 100;

export const lineNet = (l: Line) => r2((l.quantity ?? 0) * (l.price ?? 0));

/** VAT from the rate, unless typed by hand. */
export const lineVat = (l: Line) => (l.vatManual ? l.vat ?? 0 : r2((lineNet(l) * (l.vat_rate ?? 0)) / 100));

export function draftTotals(d: Draft): Totals {
  const net = r2(d.lines.reduce((a, l) => a + lineNet(l), 0));
  const vat = r2(d.lines.reduce((a, l) => a + lineVat(l), 0));
  const gross = r2(net + vat);
  const paid = d.base?.paid ?? 0;
  return { net, vat, gross, paid, amount_due: r2(gross - paid) };
}

/** What will change on save: draft − saved, per total (0 for a new invoice's base). */
export function deltas(d: Draft): Totals {
  const t = draftTotals(d);
  const b = d.base ?? { net: 0, vat: 0, gross: 0, paid: 0, amount_due: 0 };
  return {
    net: r2(t.net - b.net), vat: r2(t.vat - b.vat), gross: r2(t.gross - b.gross),
    paid: 0, amount_due: r2(t.amount_due - b.amount_due),
  };
}
