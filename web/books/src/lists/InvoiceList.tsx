import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { Plus } from "lucide-react";
import { useDb } from "@/db";
import { fmtDate, fmtMoney } from "@/format";
import { DataList, Expander, RowCells, ROW, type Chip, type Col, type Pin } from "./DataList";
import { allDrafts, getDraft, isBusy, justSaved, removeDraft, useDrafts, type Draft } from "@/editor/store";
import { stateClass, statusText } from "./draftRows";
import { motion } from "motion/react";
import { EditorPanel, HeaderField, TotalCell, deltas, draftsUnder, newInvoiceDraft, placeAfter } from "@/editor/InvoiceEditor";
import { draftTotals } from "@/editor/totals";
import { saveDraft } from "@/editor/save";
import { fromSegment, listPath, toSegment } from "@/editor/routes";
import { InvoiceCard } from "@/editor/InvoiceCard";

type Kind = "sales" | "purchases";

const statusStyle: Record<string, string> = {
  overdue: "text-danger font-medium", partial: "text-warning", active: "text-ink-soft",
  paid: "text-success", overpaid: "text-accent",
};
const statusLabel: Record<string, string> = {
  overdue: "Overdue", partial: "Part paid", active: "Unpaid", paid: "Paid", overpaid: "Overpaid",
};

export const money = (key: string) => (row: any) => {
  const v = row?.[key] as number | null;
  return <span className={v !== null && v < -0.004 ? "text-danger" : ""}>{fmtMoney(v)}</span>;
};

function columns(kind: Kind): Col[] {
  return [
    { key: "doc.date", label: "Date", width: 118, render: (r) => fmtDate(r["doc.date"]) },
    // `drop`: the order columns give way on a narrow window (paid first: amount due says it)
    { key: "number", label: "Invoice No", width: 110, drop: 7 },
    { key: "contact.name", label: kind === "sales" ? "Customer" : "Supplier", width: 180, grow: 2 },
    { key: "doc.reference", label: "Reference", width: 130, grow: 1, drop: 2 },
    { key: "due_date", label: "Due", width: 118, render: (r) => fmtDate(r.due_date), drop: 3 },
    // room for a pending change before the saved value ("+330.00 12,150.00")
    { key: "net", label: "Net", width: 140, align: "right", render: money("net"), drop: 6 },
    { key: "vat", label: "VAT", width: 120, align: "right", render: money("vat"), drop: 5 },
    { key: "gross", label: "Gross", width: 140, align: "right", render: money("gross") },
    { key: "paid", label: "Paid", width: 96, align: "right", render: money("paid"), drop: 1 },
    { key: "amount_due", label: "Amount due", width: 140, align: "right", render: money("amount_due"), drop: 4 },
    {
      key: "status", label: "Status", width: 86,
      render: (r) => r.status && <span className={statusStyle[r.status] ?? ""}>{statusLabel[r.status] ?? r.status}</span>,
    },
  ];
}

const chips: Chip[] = [
  { key: "all", label: "All", where: {} },
  { key: "unpaid", label: "Unpaid", where: { status: ["active", "partial", "overdue"] } },
  { key: "overdue", label: "Overdue", where: { status: "overdue" } },
  { key: "paid", label: "Paid", where: { status: "paid" } },
];

// Header columns that become inputs when a row is open, mapped to draft fields.
const headerFields: Record<string, "date" | "number" | "contact" | "reference" | "due_date"> = {
  "doc.date": "date", number: "number", "contact.name": "contact", "doc.reference": "reference", due_date: "due_date",
};
const totalFields = ["net", "vat", "gross", "amount_due"] as const;

/** A cell of a row that has a draft: editors when open, the draft's values when not. */
function draftCell(d: Draft, col: Col, isOpen: boolean, focusField?: string) {
  const hf = headerFields[col.key];
  if (hf) {
    if (isOpen && !isBusy(d)) return <HeaderField draftKey={d.key} field={hf} autoFocus={hf === focusField} />;
    const h = d.header;
    const text = hf === "contact" ? (h.newContact?.name ?? h.contactName)
      : hf === "date" || hf === "due_date" ? fmtDate(h[hf]) : h[hf];
    return <span className={hf === "contact" && h.newContact ? "italic" : ""}>{text}</span>;
  }
  if ((totalFields as readonly string[]).includes(col.key)) {
    const k = col.key as (typeof totalFields)[number];
    // saved: the new totals, no longer a change to come
    if (d.base && d.status !== "saved") return <TotalCell value={d.base[k]} delta={deltas(d)[k]} />;
    return <span>{fmtMoney(draftTotals(d)[k])}</span>;
  }
  if (col.key === "status") {
    const s = statusText(d);
    if (s) return s;
    if (!d.base) return <span className="text-ink-soft">New</span>;
  }
  if (col.key === "paid" && !d.base) return <span>{fmtMoney(0)}</span>;
  return undefined;
}

const rowStateClass = stateClass;


export function InvoiceList({ kind }: { kind: Kind }) {
  useDrafts();
  const db = useDb() as any;
  const entity = kind === "sales" ? db.sales_invoices : db.purchase_invoices;
  const docKind = kind === "sales" ? "sale" : "purchase";
  const base = listPath(docKind);
  const cols = columns(kind);
  const { open } = useParams();
  const navigate = useNavigate();
  const openKey = open ? fromSegment(open) : null;

  // Leaving a row (closing it, opening another, going Back) drops its draft if nothing was
  // changed; changed drafts stay.
  const prevOpen = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevOpen.current;
    if (prev && prev !== openKey) {
      const d = getDraft(prev);
      if (d && !d.dirty && d.status === "editing") removeDraft(prev);
    }
    prevOpen.current = openKey;
  }, [openKey]);

  const setOpenKey = (key: string | null) => navigate(key ? `${base}/${toSegment(key)}` : base);
  // New invoices start under the cursor row (or under the draft just saved), and take their
  // sorted place once saved.
  const cursor = useRef<string | null>(null);
  const startNew = (after: string | null = openKey ?? cursor.current) => setOpenKey(newInvoiceDraft(docKind, placeAfter(after)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // a picker or the panel already handled it
      const inInput = document.activeElement instanceof HTMLInputElement;
      if (e.key === "n" && !inInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        startNew();
      } else if (openKey && e.key === "Escape") {
        // Esc anywhere in the open invoice (its row fields included) closes it; Back reopens
        e.preventDefault();
        setOpenKey(null);
      } else if (openKey && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveDraft(db, openKey);
        if (openKey.startsWith("new:") && !e.shiftKey) startNew(openKey); else setOpenKey(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A new draft is a row of its own: open while edited, and also while it saves (read-only).
  const draftRows = (drafts: Draft[]) => drafts.map((d) => {
    const isOpen = openKey === d.key || d.status === "saving";
    return (
      <motion.div key={d.key} data-dock={openKey === d.key ? d.key : undefined}
        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.15 }}>
        <div
          role="row"
          data-pin={d.key}
          aria-expanded={isOpen}
          onClick={() => setOpenKey(openKey === d.key ? null : d.key)}
          className={"relative flex border-b border-chrome-light " + (isOpen ? "bg-highlight " : "bg-highlight/60 ") + rowStateClass(d)}
          style={{ height: ROW }}
        >
          <RowCells cols={cols} row={{ id: d.key }} isOpen={isOpen} withChevron
            cell={(_r, c) => draftCell(d, c, isOpen, "contact")} />
        </div>
        <Expander open={isOpen}>
          {isOpen && (
            <EditorPanel draftKey={d.key} kind={docKind} onClose={() => setOpenKey(null)} onSaveAndNew={() => startNew(d.key)}
              onDuplicate={setOpenKey} />
          )}
        </Expander>
      </motion.div>
    );
  });
  const newDrafts = allDrafts().filter((d) => d.kind === docKind && d.key.startsWith("new:"));

  // Work not yet in the books stays in sight: new drafts, and invoices with unsaved changes.
  const pins: Pin[] = allDrafts()
    .filter((d) => d.kind === docKind && (d.key.startsWith("new:") || d.dirty || d.status !== "editing"))
    .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt))
    .map((d) => ({
      key: d.key,
      anchor: d.key.startsWith("new:") ? d.anchor : d.key,
      render: () => <RowCells cols={cols} row={{ id: d.key }} isOpen={false} withChevron cell={(_r, c) => draftCell(d, c, false)} />,
    }));

  return (
    <DataList
      title={kind === "sales" ? "Sales invoices" : "Purchase invoices"}
      actions={
        <button
          type="button"
          onClick={() => startNew()}
          title="New invoice (N)"
          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-brand"
        >
          <Plus size={15} /> New invoice
        </button>
      }
      collection={(where, sort) => entity.where(where).sort(sort.col, sort.dir)}
      cols={cols}
      chips={chips}
      defaultSort={{ col: "doc.date", dir: "desc" }}
      noun="invoices"
      filterHint={`Filter: ${kind === "sales" ? "customer" : "supplier"} name, or #number`}
      textFilter={(t) => (t.startsWith("#") && t.length > 1 ? { number: { like: t.slice(1) } } : t ? { "contact.name": { like: t } } : {})}
      openKey={openKey}
      onOpenKey={setOpenKey}
      // drafts under a row that isn't loaded (filtered out, far away) wait above the list
      topRows={(loaded) => draftRows(newDrafts
        .filter((d) => !d.anchor || !loaded.has(d.anchor))
        .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt)))}
      after={(row) => draftRows(draftsUnder(docKind, row.id))}
      onSelect={(row) => { cursor.current = row?.id ?? null; }}
      expanded={(row) => getDraft(row.id)?.status === "saving"}
      cell={(row, col, isOpen) => {
        const d = getDraft(row.id);
        return d ? draftCell(d, col, isOpen, "date") : undefined;
      }}
      rowClass={(row) => rowStateClass(getDraft(row.id), row.doc)}
      ownChange={(row) => !!getDraft(row.id) || justSaved(row.doc)}
      pins={pins}
      detail={(row) => (
        <InvoiceCard row={row} kind={docKind} onClose={() => setOpenKey(null)} onDuplicate={setOpenKey} />
      )}
    />
  );
}
