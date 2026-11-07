import { useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { Plus } from "lucide-react";
import { useDb } from "@/db";
import { DataList, type Chip, type Col } from "./DataList";
import { money } from "./InvoiceList";
import { statusText, useDraftRows } from "./draftRows";
import { useDrafts, type ContactKind, type Draft } from "@/editor/store";
import { placeAfter } from "@/editor/InvoiceEditor";
import { ContactPanel, newContactDraft } from "@/editor/ContactEditor";
import { fromSegment, listPath, toSegment } from "@/editor/routes";

// Customers and suppliers: open one to edit it in place, N for a new one. The same list
// mechanics as invoices and payments (lists/draftRows.tsx).

type Kind = "customers" | "suppliers";

const cols: Col[] = [
  { key: "name", label: "Name", width: 220, grow: 2 },
  { key: "contact_name", label: "Contact", width: 150, grow: 1, drop: 4 },
  { key: "email", label: "Email", width: 200, grow: 1, drop: 3 },
  { key: "telephone", label: "Telephone", width: 130, drop: 1 },
  { key: "country", label: "Country", width: 140, drop: 5 },
  { key: "currency", label: "Cur", width: 60, drop: 2 },
  { key: "vat_registered", label: "VAT reg", width: 70, render: (r) => (r.vat_registered ? "Yes" : ""), drop: 6 },
  { key: "credit_terms", label: "Terms", width: 70, align: "right", render: (r) => (r.credit_terms != null ? `${r.credit_terms} d` : ""), drop: 7 },
  { key: "outstanding", label: "Outstanding", width: 120, align: "right", sortable: false, render: money("outstanding") },
];

const chips: Chip[] = [
  { key: "all", label: "All", where: {} },
  { key: "uk", label: "UK", where: { country: "United Kingdom" } },
  { key: "abroad", label: "Abroad", where: { country: { ne: "United Kingdom" } } },
  { key: "vat", label: "VAT registered", where: { vat_registered: true } },
];

function draftCell(d: Draft, col: Col) {
  const f = d.contact;
  if (!f) return undefined;
  if (col.key === "outstanding") {
    return statusText(d) ?? (d.doc ? undefined : <span className="text-ink-soft">New</span>);
  }
  if (col.key === "vat_registered") return <span>{f.vat_registered ? "Yes" : ""}</span>;
  if (col.key === "credit_terms") return <span>{f.credit_terms != null ? `${f.credit_terms} d` : ""}</span>;
  const v = (f as any)[col.key];
  return v === undefined ? undefined : <span className="truncate">{v}</span>;
}

export function ContactList({ kind }: { kind: Kind }) {
  useDrafts();
  const db = useDb() as any;
  const ck: ContactKind = kind === "customers" ? "client" : "supplier";
  const entity = kind === "customers" ? db.customers : db.suppliers;
  const base = listPath(ck);
  const { open } = useParams();
  const navigate = useNavigate();
  const openKey = open ? fromSegment(open, "contact") : null;
  const setOpenKey = (key: string | null) => navigate(key ? `${base}/${toSegment(key)}` : base);
  const cursor = useRef<string | null>(null);
  const startNew = (after: string | null = openKey ?? cursor.current) => setOpenKey(newContactDraft(ck, placeAfter(after)));

  const dr = useDraftRows({
    kind: ck, cols, openKey, setOpenKey, startNew, db, cell: draftCell,
    panel: (d) => <ContactPanel draftKey={d.key} kind={ck} onClose={() => setOpenKey(null)} onSaveAndNew={() => startNew(d.key)} />,
  });

  return (
    <DataList
      title={kind === "customers" ? "Customers" : "Suppliers"}
      actions={
        <button type="button" onClick={() => startNew()} title={`New ${kind === "customers" ? "customer" : "supplier"} (N)`}
          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-brand">
          <Plus size={15} /> New {kind === "customers" ? "customer" : "supplier"}
        </button>
      }
      collection={(where, sort) => entity.where(where).sort(sort.col, sort.dir)}
      cols={cols}
      chips={chips}
      defaultSort={{ col: "name", dir: "asc" }}
      noun={kind}
      filterHint="Filter: name"
      textFilter={(t) => (t ? { name: { like: t } } : {})}
      openKey={openKey}
      onOpenKey={setOpenKey}
      topRows={dr.topRows}
      after={dr.after}
      onSelect={(row) => { cursor.current = row?.id ?? null; }}
      expanded={dr.expanded}
      cell={dr.cellOf}
      rowClass={(row) => dr.rowClass(row, row.id)}
      ownChange={(row) => dr.ownChange(row, row.id)}
      pins={dr.pins}
      detail={(row) => <ContactPanel draftKey={row.id} kind={ck} row={row} onClose={() => setOpenKey(null)} />}
    />
  );
}
