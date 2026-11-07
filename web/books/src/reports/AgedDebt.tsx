import { useNavigate } from "react-router";
import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb } from "@/db";
import { DataList, type Col } from "@/lists/DataList";
import { money } from "@/lists/InvoiceList";
import { toSegment } from "@/editor/routes";
import { Amount } from "./common";

// Aged debtors (who owes us) and aged creditors (whom we owe): unpaid invoices by how long
// they are past due, per customer or supplier (table/aged_debt.yaml). A row opens the contact,
// whose open invoices are listed beside its details.

const cols: Col[] = [
  { key: "name", label: "Name", width: 240, grow: 3 },
  { key: "current", label: "Not yet due", width: 130, align: "right", render: money("current"), drop: 1 },
  { key: "d30", label: "1–30 days", width: 120, align: "right", render: money("d30"), drop: 2 },
  { key: "d60", label: "31–60 days", width: 120, align: "right", render: money("d60"), drop: 3 },
  { key: "d90", label: "61–90 days", width: 120, align: "right", render: money("d90"), drop: 4 },
  { key: "older", label: "Over 90 days", width: 130, align: "right", render: money("older") },
  { key: "total", label: "Total", width: 140, align: "right", render: (r) => <b>{money("total")(r)}</b> },
];

const Totals = observer(({ ctype }: { ctype: string }) => {
  const db = useDb() as any;
  const all = useCollection(db.aged_debt.where({ ctype }));
  const rows = (all.items as any[]).filter(Boolean);
  const t = (k: string) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  return (
    <div className="flex items-center gap-6 px-4 py-2 text-sm font-semibold">
      <span>{rows.length} {ctype === "client" ? "customers" : "suppliers"}</span>
      <span className="ml-auto flex gap-6">
        {[["Not yet due", "current"], ["1–30", "d30"], ["31–60", "d60"], ["61–90", "d90"], ["Over 90", "older"]].map(([l, k]) => (
          <span key={k} className="font-normal text-ink-soft">{l} <Amount v={t(k!)} /></span>
        ))}
        <span>Total <Amount v={t("total")} strong /></span>
      </span>
    </div>
  );
});

export function AgedDebt({ side }: { side: "debtors" | "creditors" }) {
  const db = useDb() as any;
  const navigate = useNavigate();
  const ctype = side === "debtors" ? "client" : "supplier";
  const contacts = side === "debtors" ? "/sales/customers" : "/purchases/suppliers";
  return (
    <DataList
      key={side}
      title={side === "debtors" ? "Aged debtors" : "Aged creditors"}
      collection={(where, sort) => db.aged_debt.where({ ...where, ctype }).sort(sort.col, sort.dir)}
      cols={cols}
      defaultSort={{ col: "name", dir: "asc" }}
      noun={side === "debtors" ? "customers owing" : "suppliers owed"}
      filterHint="Filter: name"
      textFilter={() => ({})}
      onActivate={(row) => navigate(`${contacts}/${toSegment(row.contact?.id ?? row.contact)}?q=${encodeURIComponent(row.name ?? "")}`)}
      footer={<Totals ctype={ctype} />}
    />
  );
}
