import { useState } from "react";
import { useNavigate } from "react-router";
import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb } from "@/db";
import { Amount, ReportPage } from "./common";
import { MONTHS, useCompany } from "@/setup/CompanySettings";

// Profit and loss, and the balance sheet, one column per calendar year, from each nominal's
// yearly movement (table/nominal_year.yaml). Credits show as positive where that is how they
// read (income, liabilities, capital). The balance sheet adds the years up to each year end;
// the profit of all years so far appears as retained profit, so net assets equal capital.
// A row opens its nominal's ledger.

type Row = { code: string; nominal_path: string; nominal_type: string; bp: string; year: number; total: number };
type Line = { code?: string; label: string; values: number[]; kind?: "total" | "grand" };

/** Rows of one section: one per nominal, values per year, signed for reading. */
function section(rows: Row[], types: string[], years: number[], sign: 1 | -1, cumulative: boolean): Line[] {
  const byNominal = new Map<string, Line>();
  for (const r of rows) {
    if (!types.includes(r.nominal_type)) continue;
    const line = byNominal.get(r.code + r.nominal_path) ?? { code: r.code, label: r.nominal_path, values: years.map(() => 0) };
    years.forEach((y, i) => {
      if (cumulative ? r.year <= y : r.year === y) line.values[i]! += sign * r.total;
    });
    byNominal.set(r.code + r.nominal_path, line);
  }
  return [...byNominal.values()].filter((l) => l.values.some((v) => Math.abs(v) >= 0.005)).sort((a, b) => a.code!.localeCompare(b.code!));
}
const sum = (lines: Line[], n: number) => Array.from({ length: n }, (_, i) => lines.reduce((s, l) => s + l.values[i]!, 0));
const add = (a: number[], b: number[], k = 1) => a.map((v, i) => v + k * b[i]!);

function Statement({ title, years, label, blocks, check }: {
  title: string; years: number[]; label: (y: number) => string; blocks: [string | null, Line[]][]; check?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-5xl px-6 py-5">
      <h2 className="mb-3 text-lg font-semibold text-brand">{title}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-brand text-xs text-ink-soft">
            <th className="py-1 text-left font-semibold">£</th>
            {years.map((y) => <th key={y} className="w-36 py-1 text-right font-semibold">{label(y)}</th>)}
          </tr>
        </thead>
        <tbody>
          {blocks.map(([head, lines], bi) => [
            head && (
              <tr key={`h${bi}`}><td colSpan={years.length + 1} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-ink-soft">{head}</td></tr>
            ),
            ...lines.map((l, li) => (
              <tr key={`${bi}-${li}`}
                onClick={() => l.code && navigate(`/reports/ledger?nominal=${encodeURIComponent(l.code)}`)}
                className={
                  l.kind === "grand" ? "border-y-2 border-brand font-semibold"
                    : l.kind === "total" ? "border-t border-chrome font-semibold"
                    : "cursor-pointer hover:bg-highlight"
                }>
                <td className={"py-1 " + (l.kind ? "" : "pl-4")}>{l.code && <span className="mr-3 text-xs text-ink-soft">{l.code}</span>}{l.label}</td>
                {l.values.map((v, i) => <td key={i} className="py-1 text-right"><Amount v={v} strong={!!l.kind} /></td>)}
              </tr>
            )),
          ])}
        </tbody>
      </table>
      {check && <p className="mt-3 text-sm text-success">{check}</p>}
    </div>
  );
}

export const Statements = observer(({ which }: { which: "pnl" | "balance" }) => {
  const db = useDb() as any;
  const all = useCollection(db.nominal_months.where({}).sort("code", "asc"));
  const company = useCompany();
  const start = company?.fy_start_month ?? 1;
  // months into financial years, named by the year they start in
  const rows = (all.items as (Row & { month: number })[]).filter(Boolean)
    .map((r) => ({ ...r, year: r.month >= start ? r.year : r.year - 1 }));
  const allYears = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const [span, setSpan] = useState(4);
  const years = allYears.slice(-span);
  const n = years.length;
  const label = (y: number) => (start === 1 ? String(y) : `${y}/${String((y + 1) % 100).padStart(2, "0")}`);
  const yearEnd = start === 1 ? "31 December" : `the end of ${MONTHS[(start + 10) % 12]}`;

  if (all.loadState !== "complete" || !company) return <ReportPage><p className="p-6 text-ink-soft">Adding up the ledger…</p></ReportPage>;

  const toolbar = (
    <>
      <span className="text-xs text-ink-soft">
        Financial years starting in {MONTHS[start - 1]} (Setup → Company) · a row opens its ledger
      </span>
      <div className="ml-auto flex rounded-md border border-chrome bg-chrome-light p-0.5">
        {[1, 2, 4, 8].map((s) => (
          <button key={s} type="button" onClick={() => setSpan(s)}
            className={"rounded px-2.5 py-0.5 text-xs " + (span === s ? "bg-white font-medium text-ink shadow-sm" : "text-ink-soft hover:text-ink")}>
            {s === 1 ? "Last year" : `${s} years`}
          </button>
        ))}
      </div>
    </>
  );

  if (which === "pnl") {
    const income = section(rows, ["Income"], years, -1, false);
    const cos = section(rows, ["Cost of Sales"], years, 1, false);
    const gross = add(sum(income, n), sum(cos, n), -1);
    const expenses = section(rows, ["Expense"], years, 1, false);
    const operating = add(gross, sum(expenses, n), -1);
    const otherIncome = section(rows, ["Other income"], years, -1, false);
    const otherExpense = section(rows, ["Other expense"], years, 1, false);
    const beforeTax = add(add(operating, sum(otherIncome, n)), sum(otherExpense, n), -1);
    const tax = section(rows, ["Taxation"], years, 1, false);
    const net = add(beforeTax, sum(tax, n), -1);
    return (
      <ReportPage toolbar={toolbar}>
        <Statement title="Profit and loss" years={years} label={label} blocks={[
          ["Income", [...income, { label: "Total income", values: sum(income, n), kind: "total" }]],
          ["Cost of sales", [...cos, { label: "Gross profit", values: gross, kind: "total" }]],
          ["Expenses", [...expenses, { label: "Operating profit", values: operating, kind: "total" }]],
          ["Other income and charges", [...otherIncome, ...otherExpense, { label: "Profit before tax", values: beforeTax, kind: "total" }]],
          ["Taxation", [...tax, { label: "Profit for the year", values: net, kind: "grand" }]],
        ]} />
      </ReportPage>
    );
  }

  const fixed = section(rows, ["Fixed asset"], years, 1, true);
  const current = section(rows, ["Current asset"], years, 1, true);
  const liabilities = section(rows, ["Current liability"], years, -1, true);
  const netCurrent = add(sum(current, n), sum(liabilities, n), -1);
  const longTerm = section(rows, ["Long term liability"], years, -1, true);
  const netAssets = add(add(sum(fixed, n), netCurrent), sum(longTerm, n), -1);
  const capital = section(rows, ["Capital & Reserves"], years, -1, true);
  // every P nominal up to the year end, as one line: profit kept in the business
  const retained = years.map((y) => -rows.filter((r) => r.bp === "P" && r.year <= y).reduce((s, r) => s + r.total, 0));
  const equity = add(sum(capital, n), retained);
  const balanced = netAssets.every((v, i) => Math.abs(v - equity[i]!) < 0.01);
  return (
    <ReportPage toolbar={toolbar}>
      <Statement title={`Balance sheet at ${yearEnd}`} years={years} label={label} blocks={[
        ["Fixed assets", [...fixed, { label: "Total fixed assets", values: sum(fixed, n), kind: "total" }]],
        ["Current assets", [...current, { label: "Total current assets", values: sum(current, n), kind: "total" }]],
        ["Creditors due within a year", [...liabilities, { label: "Net current assets", values: netCurrent, kind: "total" }]],
        ["Creditors due after a year", [...longTerm, { label: "Net assets", values: netAssets, kind: "grand" }]],
        ["Capital and reserves", [...capital, { label: "Retained profit", values: retained }, { label: "Total capital and reserves", values: equity, kind: "grand" }]],
      ]} check={balanced ? "✓ Net assets equal capital and reserves in every year." : undefined} />
      {!balanced && <p className="px-6 text-sm font-semibold text-danger">Net assets and capital differ: the ledger doesn't balance.</p>}
    </ReportPage>
  );
});
