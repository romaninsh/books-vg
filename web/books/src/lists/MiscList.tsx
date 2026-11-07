import { useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { Plus } from "lucide-react";
import { useDb } from "@/db";
import { fmtDate, fmtMoney } from "@/format";
import { DataList, type Chip, type Col } from "./DataList";
import { statusText, useDraftRows } from "./draftRows";
import { useDrafts, type Draft } from "@/editor/store";
import { placeAfter } from "@/editor/InvoiceEditor";
import { MiscPanel, newMiscDraft } from "@/editor/MiscEditor";
import { fromSegment, listPath, toSegment } from "@/editor/routes";

// Misc payments and lodgements: bank ↔ nominal, no customer or supplier. The same list
// mechanics as everywhere else (lists/draftRows.tsx). Money out shows negative.

const signed = (r: any) => (r["doc.type"] === "misc_payment" ? -1 : 1) * (r["doc.total"] ?? 0);

const cols: Col[] = [
  { key: "doc.date", label: "Date", width: 110, render: (r) => fmtDate(r["doc.date"]) },
  { key: "doc.contact_name", label: "Paid to / from", width: 180, grow: 2 },
  { key: "doc.description", label: "Description", width: 180, grow: 2, drop: 2 },
  { key: "doc.reference", label: "Reference", width: 150, grow: 1, drop: 1 },
  { key: "nominal.path", label: "Nominal", width: 200, grow: 2, drop: 3 },
  { key: "bank_account.name", label: "Bank", width: 150, drop: 4 },
  {
    key: "doc.total", label: "Amount", width: 130, align: "right",
    render: (r) => <span className={signed(r) < 0 ? "text-danger" : "text-success"}>{fmtMoney(signed(r))}</span>,
  },
];

const chips: Chip[] = [
  { key: "all", label: "All", where: {} },
  { key: "out", label: "Money out", where: { "doc.type": "misc_payment" } },
  { key: "in", label: "Money in", where: { "doc.type": "misc_lodgement" } },
];

function draftCell(d: Draft, col: Col) {
  const m = d.misc, h = d.header;
  if (!m) return undefined;
  switch (col.key) {
    case "doc.date": return <span>{fmtDate(h.date)}</span>;
    case "doc.contact_name": return <span>{m.contact_name}</span>;
    case "doc.description": return <span>{m.description}</span>;
    case "doc.reference": return <span>{h.reference}</span>;
    case "nominal.path": return <span>{m.nominalPath}</span>;
    case "bank_account.name": return <span>{m.bankName}</span>;
    case "doc.total":
      if (d.status === "saving" || d.status === "failed") return statusText(d);
      return <span>{fmtMoney((m.type === "misc_payment" ? -1 : 1) * (m.amount ?? 0))}</span>;
  }
  return undefined;
}

export function MiscList() {
  useDrafts();
  const db = useDb() as any;
  const base = listPath("misc");
  const { open } = useParams();
  const navigate = useNavigate();
  const openKey = open ? fromSegment(open, "misc") : null;
  const setOpenKey = (key: string | null) => navigate(key ? `${base}/${toSegment(key)}` : base);
  const cursor = useRef<string | null>(null);
  const startNew = (after: string | null = openKey ?? cursor.current) => setOpenKey(newMiscDraft(placeAfter(after)));
  const dr = useDraftRows({
    kind: "misc", cols, openKey, setOpenKey, startNew, db, cell: draftCell,
    panel: (d) => <MiscPanel draftKey={d.key} onClose={() => setOpenKey(null)} onSaveAndNew={() => startNew(d.key)} />,
  });

  return (
    <DataList
      title="Misc payments"
      actions={
        <button type="button" onClick={() => startNew()} title="New misc payment (N)"
          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-brand">
          <Plus size={15} /> New misc payment
        </button>
      }
      collection={(where, sort) => db.misc.where(where).sort(sort.col, sort.dir)}
      cols={cols}
      chips={chips}
      defaultSort={{ col: "doc.date", dir: "desc" }}
      noun="misc payments"
      filterHint='Filter: paid to / from, or "reference'
      textFilter={(t) => (t.startsWith('"') && t.length > 1 ? { "doc.reference": { like: t.slice(1) } } : t ? { "doc.contact_name": { like: t } } : {})}
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
      detail={(row) => <MiscPanel draftKey={row.id} row={row} onClose={() => setOpenKey(null)} />}
    />
  );
}
