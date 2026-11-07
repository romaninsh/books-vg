import { useNavigate } from "react-router";
import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb } from "@/db";
import { fmtMoney } from "@/format";
import { DataList, type Chip, type Col } from "@/lists/DataList";
import { Cr, Dr } from "./common";

// Trial balance: every nominal's balance as debit or credit. The two columns must agree;
// the footer says so. Enter or a click opens the nominal's ledger.

const cols: Col[] = [
  { key: "code", label: "Code", width: 90 },
  { key: "nominal_path", label: "Nominal", width: 240, grow: 3 },
  { key: "nominal_type", label: "Type", width: 160, drop: 2 },
  { key: "bp", label: "B/P", width: 50, drop: 1 },
  { key: "postings", label: "Postings", width: 90, align: "right", drop: 3 },
  { key: "debit", label: "Debit", width: 140, align: "right", sortable: false, render: (r) => <Dr v={r.balance} /> },
  { key: "credit", label: "Credit", width: 140, align: "right", sortable: false, render: (r) => <Cr v={r.balance} /> },
];

const chips: Chip[] = [
  { key: "all", label: "All", where: {} },
  { key: "bs", label: "Balance sheet", where: { bp: "B" } },
  { key: "pl", label: "Profit & loss", where: { bp: "P" } },
];

const Totals = observer(() => {
  const db = useDb() as any;
  const all = useCollection(db.trial_balance.where({}).sort("code", "asc"));
  const rows = all.items as any[];
  const dr = rows.reduce((s, r) => s + (r?.balance > 0 ? r.balance : 0), 0);
  const cr = rows.reduce((s, r) => s + (r?.balance < 0 ? -r.balance : 0), 0);
  const ok = Math.abs(dr - cr) < 0.01;
  return (
    <div className="flex items-center gap-6 px-4 py-2 text-sm">
      <span className={ok ? "text-success" : "font-semibold text-danger"}>
        {all.loadState !== "complete" ? "Adding up…" : ok ? "✓ Debits equal credits" : `Out of balance by ${fmtMoney(dr - cr)}`}
      </span>
      <span className="ml-auto font-semibold">Total debit <span className="num">{fmtMoney(dr)}</span></span>
      <span className="font-semibold">Total credit <span className="num">{fmtMoney(cr)}</span></span>
    </div>
  );
});

export function TrialBalance() {
  const db = useDb() as any;
  const navigate = useNavigate();
  return (
    <DataList
      title="Trial balance"
      collection={(where, sort) => db.trial_balance.where(where).sort(sort.col, sort.dir)}
      cols={cols}
      chips={chips}
      defaultSort={{ col: "code", dir: "asc" }}
      noun="nominals"
      filterHint="Filter: code"
      textFilter={(t) => (t ? { code: { like: t } } : {})}
      onActivate={(row) => navigate(`/reports/ledger?nominal=${encodeURIComponent(row.code)}`)}
      footer={<Totals />}
    />
  );
}
