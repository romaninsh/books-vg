import type { Draft } from "./store";
import { draftTotals, lineNet, lineVat } from "./totals";
import { fmtMoney } from "@/format";
import { showDate } from "./fields";

// A plain printable invoice from what is on screen (draft values), in a new window, headed
// with the company's details from Setup → Company.

type Company = { name: string; address?: string; vat_no?: string; email?: string } | undefined;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function printInvoice(d: Draft, company: Company) {
  const h = d.header;
  const t = draftTotals(d);
  const title = d.creditFor ? "Credit note" : d.kind === "sale" ? "Invoice" : "Purchase invoice";
  const who = h.newContact?.name ?? h.contactName;
  const rows = d.lines
    .filter((l) => l.nominal || l.price !== null || l.description)
    .map((l) => `<tr><td>${esc(l.description || "")}</td><td class="n">${l.quantity ?? ""}</td>
      <td class="n">${fmtMoney(l.price)}</td><td class="n">${l.vat_rate ?? 0}%</td>
      <td class="n">${fmtMoney(lineVat(l))}</td><td class="n">${fmtMoney(lineNet(l))}</td></tr>`)
    .join("");
  const from = company
    ? `<div class="from"><b>${esc(company.name)}</b>${company.address ? `<br>${esc(company.address).replace(/\n/g, "<br>")}` : ""}
       ${company.vat_no ? `<br>VAT ${esc(company.vat_no)}` : ""}${company.email ? `<br>${esc(company.email)}` : ""}</div>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title} ${esc(h.number)}</title>
<style>
  body { font: 13px/1.45 system-ui, Arial, sans-serif; color: #272b2d; margin: 40px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { color: #40625f; margin: 0 0 4px; font-size: 26px; }
  .from { text-align: right; }
  .meta { display: grid; grid-template-columns: auto 1fr; gap: 2px 16px; margin: 18px 0 24px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; border-bottom: 2px solid #40625f; padding: 6px 4px; font-size: 12px; }
  td { border-bottom: 1px solid #d6dadd; padding: 6px 4px; vertical-align: top; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-left: auto; margin-top: 16px; width: 280px; }
  .totals td { border: 0; padding: 3px 4px; }
  .due td { font-weight: 700; border-top: 2px solid #40625f; font-size: 15px; }
</style></head><body>
  <header><h1>${title}</h1>${from}</header>
  <div class="meta">
    <b>${d.kind === "sale" ? "To" : "From"}</b><span>${esc(who)}</span>
    <b>Number</b><span>${esc(h.number || "—")}</span>
    <b>Date</b><span>${showDate(h.date)}</span>
    ${h.due_date ? `<b>Due</b><span>${showDate(h.due_date)}</span>` : ""}
    ${h.reference ? `<b>Reference</b><span>${esc(h.reference)}</span>` : ""}
  </div>
  <table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Price</th><th class="n">VAT %</th><th class="n">VAT</th><th class="n">Net</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <table class="totals">
    <tr><td>Net</td><td class="n">£${fmtMoney(t.net)}</td></tr>
    <tr><td>VAT</td><td class="n">£${fmtMoney(t.vat)}</td></tr>
    <tr class="due"><td>Total</td><td class="n">£${fmtMoney(t.gross)}</td></tr>
  </table>
  <script>window.onload = () => window.print();</script>
</body></html>`;
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
