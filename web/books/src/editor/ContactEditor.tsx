import { useEffect } from "react";
import { useNavigate } from "react-router";
import { observer, useCollection } from "@vantage-ui/client/react";
import { FilePlus2 } from "lucide-react";
import { useDb } from "@/db";
import { fmtDate, fmtMoney } from "@/format";
import { NumberField } from "./fields";
import { MOD, editorKeys, newInvoiceDraft, type Place } from "./InvoiceEditor";
import { editDraft, getDraft, isBusy, newKey, putDraft, removeDraft, updateDraft, useDrafts, type ContactForm, type ContactKind, type Draft } from "./store";
import { saveDraft } from "./save";
import { PanelFooter } from "./PanelFooter";
import { runAction } from "@/shell/toast";
import { listPath, toSegment } from "./routes";

// The customer / supplier editor: the same draft, save queue and keys as invoices, with a
// plain form. Beside it, what they owe (or are owed) and their open invoices; a new invoice
// for them starts from here.

const blank: ContactForm = {
  name: "", contact_name: "", email: "", telephone: "", address: "", city: "", county: "", country: "United Kingdom",
  currency: "GBP", vat_registered: false, vat_no: "", credit_terms: 30, note: "",
};

const draftOf = (kind: ContactKind, key: string, extra: Partial<Draft>): Draft => ({
  key, kind, createdAt: Date.now(), dirty: false, status: "editing",
  header: { date: "", number: "", reference: "", due_date: "", contact: "", contactName: "", newContact: null },
  lines: [], contact: { ...blank }, ...extra,
});

export function newContactDraft(kind: ContactKind, place: Place = { order: 0 }): string {
  const key = `new:${newKey()}`;
  putDraft(draftOf(kind, key, place));
  return key;
}

function contactDraftFromRow(kind: ContactKind, row: any) {
  const f = { ...blank };
  for (const k of Object.keys(blank) as (keyof ContactForm)[]) {
    const v = row[k];
    if (v !== null && v !== undefined) (f as any)[k] = v;
  }
  putDraft(draftOf(kind, row.id, { doc: row.id, contact: f }));
}

const TEXT: [keyof ContactForm, string, string][] = [
  ["name", "Name", "col-span-2"], ["contact_name", "Contact person", ""], ["email", "Email", ""],
  ["telephone", "Telephone", ""], ["address", "Address", "col-span-2"], ["city", "City", ""],
  ["county", "County", ""], ["country", "Country", ""], ["vat_no", "VAT number", ""],
];

export const ContactPanel = observer(({ draftKey, kind, row, onClose, onSaveAndNew }: {
  draftKey: string; kind: ContactKind; row?: any; onClose: () => void; onSaveAndNew?: () => void;
}) => {
  useDrafts();
  const db = useDb() as any;
  const navigate = useNavigate();
  useEffect(() => { if (row && !getDraft(draftKey)) contactDraftFromRow(kind, row); }, [row, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const customer = kind === "client";
  const invoices = useCollection(
    (customer ? db.sales_invoices : db.purchase_invoices)
      .where({ contact: row?.id ?? "contact:none", status: ["active", "partial", "overdue"] })
      .sort("doc.date", "asc"),
  );

  const d = getDraft(draftKey);
  if (!d?.contact) return <p className="px-6 py-4 text-ink-soft">Loading…</p>;
  const f = d.contact;
  const saving = isBusy(d);
  const fe = d.fieldErrors ?? {};
  const set = (patch: Partial<ContactForm>) => editDraft(draftKey, (x) => ({ ...x, contact: { ...x.contact!, ...patch } }));
  const save = () => { saveDraft(db, draftKey); if (onSaveAndNew) onSaveAndNew(); else onClose(); };
  const saveClose = () => { saveDraft(db, draftKey); onClose(); };
  const invKind = customer ? "sale" : "purchase";
  const newInvoice = () => {
    const key = newInvoiceDraft(invKind);
    updateDraft(key, (x) => ({ ...x, header: { ...x.header, contact: row.id, contactName: row.name } }));
    navigate(`${listPath(invKind)}/${toSegment(key)}`);
  };

  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => editorKeys(e, { save, saveClose, close: onClose })} className="text-[13.5px]">
      <fieldset disabled={saving} className={"m-0 min-w-0 border-0 p-0 " + (saving ? "opacity-75" : "")}>
        <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-6 px-5 py-3">
          <section className="grid grid-cols-4 gap-x-3 gap-y-2 self-start">
            {TEXT.map(([k, label, span]) => (
              <label key={k} className={"flex flex-col gap-0.5 text-xs font-semibold text-ink " + span}>{label}
                <input className="field" value={f[k] as string} aria-invalid={!!fe[k]} autoFocus={k === "name" && !d.doc}
                  onChange={(e) => set({ [k]: e.target.value } as Partial<ContactForm>)} />
                {fe[k] && <span className="font-normal text-danger">{fe[k]}</span>}
              </label>
            ))}
            <label className="flex flex-col gap-0.5 text-xs font-semibold text-ink">Currency
              <select className="field" value={f.currency} onChange={(e) => set({ currency: e.target.value })}>
                {["GBP", "EUR", "USD"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-xs font-semibold text-ink">Credit terms (days)
              <NumberField value={f.credit_terms} invalid={fe.credit_terms} onChange={(v) => set({ credit_terms: v })} />
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-ink">
              <input type="checkbox" checked={f.vat_registered} onChange={(e) => set({ vat_registered: e.target.checked })}
                className="h-4 w-4 accent-[var(--color-accent)]" />
              VAT registered
            </label>
            <label className="col-span-4 flex flex-col gap-0.5 text-xs font-semibold text-ink">Note
              <textarea className="field h-14 py-1" value={f.note} onChange={(e) => set({ note: e.target.value })} />
            </label>
          </section>

          <aside className="flex flex-col gap-3">
            {row && (
              <div className="rounded-md bg-chrome-light p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{customer ? "Owes us" : "We owe"}</span>
                  <span className="num text-lg font-semibold">{fmtMoney(row.outstanding ?? 0)}</span>
                </div>
                <ul className="mt-2 max-h-40 overflow-auto text-sm">
                  {(invoices.items as any[]).map((r) => r && (
                    <li key={r.id}>
                      <button type="button" onClick={() => navigate(`${listPath(invKind)}/${toSegment(r.id)}`)}
                        className="flex w-full gap-2 rounded px-1 py-0.5 text-left hover:bg-white">
                        <span className="w-20 text-ink-soft">{fmtDate(r["doc.date"])}</span>
                        <span className="flex-1 truncate">{r.number || "—"}</span>
                        <span className={"num " + (r.status === "overdue" ? "text-danger" : "")}>{fmtMoney(r.amount_due)}</span>
                      </button>
                    </li>
                  ))}
                  {invoices.loadState === "complete" && invoices.items.length === 0 && <li className="text-ink-soft">No open invoices.</li>}
                </ul>
                <button type="button" onClick={newInvoice}
                  className="mt-2 flex items-center gap-1 rounded px-1 py-0.5 text-sm font-medium text-accent hover:bg-white">
                  <FilePlus2 size={14} /> New invoice for {row.name}
                </button>
              </div>
            )}
            {d.error && <p role="alert" className="rounded bg-[#fde8e6] px-2 py-1.5 text-sm text-danger">{d.error}</p>}
          </aside>
        </div>
      </fieldset>

      <PanelFooter d={d} onClose={onClose} onSave={save} onSaveClose={saveClose} onSaveAndNew={onSaveAndNew}
        deleteLabel={`Delete ${customer ? "customer" : "supplier"}`}
        onDelete={d.doc ? async () => {
          const ok = await runAction(db, "delete_contact", { id: d.doc }, `Deleted ${f.name}`);
          if (ok) { removeDraft(draftKey); onClose(); }
          return !!ok;
        } : undefined} />
    </div>
  );
});
