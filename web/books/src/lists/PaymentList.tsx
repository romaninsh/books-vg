import { useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { Plus } from "lucide-react";
import { useDb } from "@/db";
import { fmtDate, fmtMoney } from "@/format";
import { DataList, type Chip, type Col } from "./DataList";
import { money } from "./InvoiceList";
import { statusText, useDraftRows } from "./draftRows";
import { useDrafts, type Draft, type PayKind } from "@/editor/store";
import { placeAfter } from "@/editor/InvoiceEditor";
import { PaymentPanel, newPaymentDraft } from "@/editor/PaymentEditor";
import { fromSegment, listPath, toSegment } from "@/editor/routes";

// Money received from customers (lodgements) or paid to suppliers, with what each settled.
// The same list mechanics as invoices (lists/draftRows.tsx).

type Side = "sales" | "purchases";

function columns(side: Side): Col[] {
  return [
    { key: "doc.date", label: "Date", width: 118, render: (r) => fmtDate(r["doc.date"]) },
    { key: "contact.name", label: side === "sales" ? "Customer" : "Supplier", width: 200, grow: 2 },
    { key: "doc.reference", label: "Reference", width: 160, grow: 2, drop: 2 },
    { key: "bank_account.name", label: "Bank account", width: 160, drop: 3 },
    { key: "doc.total", label: "Amount", width: 130, align: "right", render: money("doc.total") },
    { key: "allocated", label: "Allocated", width: 130, align: "right", render: money("allocated"), drop: 1 },
    { key: "unallocated", label: "On account", width: 130, align: "right", render: money("unallocated") },
  ];
}

const chips: Chip[] = [
  { key: "all", label: "All", where: {} },
  { key: "on-account", label: "On account", where: { unallocated: { gt: 0.004 } } },
];

function draftCell(d: Draft, col: Col) {
  const h = d.header, p = d.pay;
  switch (col.key) {
    case "doc.date": return <span>{fmtDate(h.date)}</span>;
    case "contact.name": return <span>{h.contactName}</span>;
    case "doc.reference": return <span>{h.reference}</span>;
    case "bank_account.name": return <span>{p?.bankName}</span>;
    case "doc.total": return <span>{fmtMoney(p?.amount ?? 0)}</span>;
    case "allocated": return <span>{fmtMoney(p?.allocations.reduce((s, a) => s + (a.amount ?? 0), 0) ?? 0)}</span>;
    case "unallocated":
      return statusText(d) ?? (d.doc ? undefined : <span className="text-ink-soft">New</span>);
  }
  return undefined;
}

export function PaymentList({ side }: { side: Side }) {
  useDrafts();
  const db = useDb() as any;
  const kind: PayKind = side === "sales" ? "lodgement" : "payment";
  const entity = side === "sales" ? db.lodgements : db.supplier_payments;
  const base = listPath(kind);
  const cols = columns(side);
  const { open } = useParams();
  const navigate = useNavigate();
  const openKey = open ? fromSegment(open, "payment") : null;
  const setOpenKey = (key: string | null) => navigate(key ? `${base}/${toSegment(key)}` : base);
  const cursor = useRef<string | null>(null);
  const startNew = (after: string | null = openKey ?? cursor.current) => setOpenKey(newPaymentDraft(kind, placeAfter(after)));

  const dr = useDraftRows({
    kind, cols, openKey, setOpenKey, startNew, db, cell: draftCell,
    panel: (d) => <PaymentPanel draftKey={d.key} kind={kind} onClose={() => setOpenKey(null)} onSaveAndNew={() => startNew(d.key)} />,
  });

  return (
    <DataList
      title={side === "sales" ? "Payments received" : "Payments made"}
      actions={
        <button type="button" onClick={() => startNew()} title="New payment (N)"
          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-brand">
          <Plus size={15} /> {side === "sales" ? "Money received" : "Money paid"}
        </button>
      }
      collection={(where, sort) => entity.where(where).sort(sort.col, sort.dir)}
      cols={cols}
      chips={chips}
      defaultSort={{ col: "doc.date", dir: "desc" }}
      noun="payments"
      filterHint={`Filter: ${side === "sales" ? "customer" : "supplier"} name, or "ref`}
      textFilter={(t) => (t.startsWith('"') && t.length > 1 ? { "doc.reference": { like: t.slice(1) } } : t ? { "contact.name": { like: t } } : {})}
      openKey={openKey}
      onOpenKey={setOpenKey}
      topRows={dr.topRows}
      after={dr.after}
      onSelect={(row) => { cursor.current = row?.id ?? null; }}
      expanded={dr.expanded}
      cell={dr.cellOf}
      rowClass={(row) => dr.rowClass(row, row.doc)}
      ownChange={(row) => dr.ownChange(row, row.doc)}
      pins={dr.pins}
      detail={(row) => <PaymentPanel draftKey={row.id} kind={kind} row={row} onClose={() => setOpenKey(null)} />}
    />
  );
}
