import { useSearchParams } from "react-router";
import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb } from "@/db";
import { fmtDate, fmtMoney } from "@/format";
import { DataList, type Chip, type Col } from "@/lists/DataList";
import { Picker } from "@/editor/Picker";
import { Cr, Dr, useOpenDocument } from "./common";

// The nominal ledger: every posting, newest first, as debit or credit; pick a nominal to see
// only its postings (sub-nominals included) and its balance. Enter or a click opens the
// document behind a posting. The nominal is in the URL (?nominal=41000), so the trial
// balance and search link straight here.

const typeLabel: Record<string, string> = {
  sale: "Sales invoice", purchase: "Purchase invoice", lodgement: "Payment received", payment: "Payment made",
  misc_payment: "Misc payment", misc_lodgement: "Misc lodgement",
};

const cols: Col[] = [
  { key: "date", label: "Date", width: 110, render: (r) => fmtDate(r.date) },
  { key: "doc_type", label: "Document", width: 150, render: (r) => typeLabel[r.doc_type] ?? r.doc_type },
  { key: "reference", label: "Reference", width: 220, grow: 3, drop: 2 },
  { key: "nominal_path", label: "Nominal", width: 200, grow: 2, drop: 3 },
  { key: "bank", label: "Bank", width: 150, drop: 1 },
  { key: "debit", label: "Debit", width: 130, align: "right", sortable: false, render: (r) => <Dr v={r.amount} /> },
  { key: "credit", label: "Credit", width: 130, align: "right", sortable: false, render: (r) => <Cr v={r.amount} /> },
];

const chips: Chip[] = [
  { key: "all", label: "All", where: {} },
  { key: "invoices", label: "Invoices", where: { doc_type: ["sale", "purchase"] } },
  { key: "payments", label: "Payments", where: { doc_type: ["lodgement", "payment"] } },
  { key: "misc", label: "Misc", where: { doc_type: ["misc_payment", "misc_lodgement"] } },
];

const Balance = observer(({ code }: { code: string }) => {
  const db = useDb() as any;
  const tb = useCollection(db.trial_balance.where({ code }));
  const r = tb.items[0] as any;
  if (!r) return null;
  return (
    <div className="flex items-center gap-6 px-4 py-2 text-sm">
      <span>{r.postings} postings</span>
      <span className="ml-auto font-semibold">
        Balance <span className="num">{fmtMoney(Math.abs(r.balance))} {r.balance >= 0 ? "Dr" : "Cr"}</span>
      </span>
    </div>
  );
});

export function Ledger() {
  const db = useDb() as any;
  const [params, setParams] = useSearchParams();
  const code = params.get("nominal") ?? "";
  const open = useOpenDocument(db);
  const nominal = useCollection(db.nominals.where({ code: code || "none" }));
  const picked = nominal.items[0] as any;

  return (
    <DataList
      key={code}
      title="Nominal ledger"
      actions={
        <div className="flex items-center gap-2">
          <div className="w-96">
            <Picker
              value={picked ? `${picked.code} · ${picked.path}` : code}
              placeholder="All nominals: type to pick one…"
              collection={(t) => db.nominals.where(t ? { path: { like: t } } : {}).sort("code", "asc")}
              label={(r) => <span className="flex gap-3"><span className="w-12 text-ink-soft">{r.code}</span><span>{r.path}</span></span>}
              pick={(r) => setParams({ nominal: r.code })}
            />
          </div>
          {code && (
            <button type="button" onClick={() => setParams({})}
              className="rounded-md border border-chrome px-2.5 py-1 text-xs text-ink-soft hover:bg-chrome-light hover:text-ink">
              All nominals
            </button>
          )}
        </div>
      }
      // no nominal picked: every posting, the whole general ledger
      collection={(where, sort) => db.ledger.where(code ? { ...where, nominal_code: code } : where).sort(sort.col, sort.dir)}
      cols={cols}
      chips={chips}
      defaultSort={{ col: "date", dir: "desc" }}
      noun="postings"
      filterHint="Filter: reference"
      textFilter={(t) => (t ? { reference: { like: t } } : {})}
      onActivate={(row) => void open(row.doc, row.doc_type)}
      footer={code ? <Balance code={code} /> : undefined}
    />
  );
}
