import { useEffect } from "react";
import { observer, useCollection } from "@vantage-ui/client/react";
import { AnimatePresence, motion } from "motion/react";
import { Wand2 } from "lucide-react";
import { useDb } from "@/db";
import { fmtDate, fmtMoney } from "@/format";
import { Picker } from "./Picker";
import { DateField, NumberField } from "./fields";
import { MOD, editorKeys, type Place } from "./InvoiceEditor";
import {
  editDraft, getDraft, isBusy, newKey, putDraft, removeDraft, useDrafts,
  type Allocation, type Draft, type PayKind,
} from "./store";
import { saveDraft } from "./save";
import { PanelFooter } from "./PanelFooter";
import { runAction } from "@/shell/toast";

// The payment editor: money received from a customer (lodgement) or paid to a supplier
// (payment), and the invoices it settles. Used on the payment lists, and on the back of an
// invoice's card (the cheque-book flip). Whatever isn't allocated stays on account.

const today = () => new Date().toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

function emptyPay(kind: PayKind, key: string, extra: Partial<Draft> = {}): Draft {
  return {
    key, kind, createdAt: Date.now(), dirty: false, status: "editing",
    header: { date: today(), number: "", reference: "", due_date: "", contact: "", contactName: "", newContact: null },
    lines: [],
    pay: { bank_account: "", bankName: "", amount: null, allocations: [] },
    ...extra,
  };
}

export function newPaymentDraft(kind: PayKind, place: Place = { order: 0 }): string {
  const key = `new:${newKey()}`;
  putDraft(emptyPay(kind, key, place));
  return key;
}

/** Opening a saved payment starts a clean draft from its row and allocations. */
export function payDraftFromRow(kind: PayKind, row: any, allocs: readonly any[]): Draft {
  const d = emptyPay(kind, row.id, {
    doc: row.doc,
    header: {
      date: (row["doc.date"] ?? "").slice(0, 10), number: "", reference: row["doc.reference"] ?? "", due_date: "",
      contact: row.contact?.id ?? row.contact ?? "", contactName: row["contact.name"] ?? "", newContact: null,
    },
    pay: {
      bank_account: row.bank_account?.id ?? row.bank_account ?? "", bankName: row["bank_account.name"] ?? "",
      amount: row["doc.total"] ?? null,
      allocations: allocs.map((a) => ({
        invoice: a.invoice?.id ?? a.invoice, number: a.invoice_number ?? "", date: (a["invoice.date"] ?? "").slice(0, 10),
        due: a.amount ?? 0, amount: a.amount ?? 0,
      })),
    },
  });
  putDraft(d);
  return d;
}

/** The back of an invoice's card: a payment of what is due on it. */
export function flipPaymentDraft(key: string, kind: PayKind, row: any): void {
  if (getDraft(key)) return;
  const due = r2(row.amount_due ?? 0);
  putDraft(emptyPay(kind, key, {
    flipOf: row.id,
    header: {
      date: today(), number: "", reference: "", due_date: "",
      contact: row.contact?.id ?? row.contact ?? "", contactName: row["contact.name"] ?? "", newContact: null,
    },
    pay: {
      bank_account: "", bankName: "", amount: due > 0 ? due : null,
      allocations: due > 0
        ? [{ invoice: row.doc, number: row.number ?? "", date: (row["doc.date"] ?? "").slice(0, 10), due, amount: due }]
        : [],
    },
  }));
}

/** Oldest first, up to the amount. */
function autoAllocate(amount: number, rows: Allocation[]): Allocation[] {
  let left = amount;
  return rows.map((a) => {
    const take = r2(Math.max(0, Math.min(left, a.due)));
    left = r2(left - take);
    return { ...a, amount: take > 0 ? take : null };
  });
}

export const PaymentPanel = observer(({ draftKey, kind, row, onClose, onSaveAndNew }: {
  draftKey: string; kind: PayKind; row?: any; onClose: () => void; onSaveAndNew?: () => void;
}) => {
  useDrafts();
  const db = useDb() as any;
  // A saved payment: load its allocations, then start a clean draft from them.
  const saved = useCollection(db.allocations.where({ payment: row?.doc ?? "doc:none" }));
  useEffect(() => {
    if (row && !getDraft(draftKey) && saved.loadState === "complete") payDraftFromRow(kind, row, [...saved.items]);
  }, [row, draftKey, saved.loadState]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new payment gets the first bank account until one is picked.
  const banks = useCollection(db.bank_accounts.sort("name", "asc"));
  const d = getDraft(draftKey);
  useEffect(() => {
    const b = banks.items[0] as any;
    if (d?.pay && !d.pay.bank_account && b?.id) {
      editDraftQuiet(draftKey, (x) => ({ ...x, pay: { ...x.pay!, bank_account: b.id, bankName: b.name } }));
    }
  }, [banks.items.length, d?.pay?.bank_account]); // eslint-disable-line react-hooks/exhaustive-deps

  const customer = kind === "lodgement";
  const invoices = customer ? db.sales_invoices : db.purchase_invoices;
  const open = useCollection(
    invoices.where({ contact: d?.header.contact || "contact:none", status: ["active", "partial", "overdue"] }).sort("doc.date", "asc"),
  );

  if (!d?.pay) return <p className="px-6 py-4 text-ink-soft">Loading…</p>;
  const p = d.pay, h = d.header;
  const saving = isBusy(d);
  const fe = d.fieldErrors ?? {};

  // The invoices to show: those already allocated, then the customer's other open ones.
  const have = new Set(p.allocations.map((a) => a.invoice));
  const rows: Allocation[] = [
    ...p.allocations,
    ...(open.items as any[])
      .filter((r) => r && !have.has(r.doc))
      .map((r) => ({ invoice: r.doc, number: r.number ?? "", date: (r["doc.date"] ?? "").slice(0, 10), due: r2(r.amount_due ?? 0), amount: null })),
  ];
  const allocated = r2(rows.reduce((s, a) => s + (a.amount ?? 0), 0));
  const onAccount = r2((p.amount ?? 0) - allocated);

  const setPay = (patch: Partial<NonNullable<Draft["pay"]>>) => editDraft(draftKey, (x) => ({ ...x, pay: { ...x.pay!, ...patch } }));
  const setAlloc = (inv: string, amount: number | null) => setPay({
    allocations: rows.map((a) => (a.invoice === inv ? { ...a, amount } : a)).filter((a) => a.amount !== null),
  });
  const save = () => { saveDraft(db, draftKey); if (onSaveAndNew) onSaveAndNew(); else onClose(); };
  const saveClose = () => { saveDraft(db, draftKey); onClose(); };
  const who = customer ? "customer" : "supplier";

  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => editorKeys(e, { save, saveClose, close: onClose })} className="text-[13.5px]">
      <fieldset disabled={saving} className={"m-0 min-w-0 border-0 p-0 " + (saving ? "opacity-75" : "")}>
        <div className="grid grid-cols-[minmax(0,1fr)_17rem] gap-6 px-5 py-3">
          <section>
            <div className="grid grid-cols-[8.5rem_minmax(12rem,1.4fr)_minmax(10rem,1fr)_8rem_minmax(8rem,1fr)] gap-3">
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-ink">Date
                <DateField value={h.date} invalid={fe.date}
                  onChange={(v) => editDraft(draftKey, (x) => ({ ...x, header: { ...x.header, date: v } }))} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-ink">{customer ? "Received from" : "Paid to"}
                <Picker
                  value={h.contactName}
                  placeholder={`Type a ${who}…`}
                  invalid={fe.contact}
                  autoFocus={!h.contact}
                  collection={(t) => (customer ? db.customers : db.suppliers).where(t ? { name: { like: t } } : {}).sort("name", "asc")}
                  label={(r) => <span>{r.name}</span>}
                  pick={(r) => editDraft(draftKey, (x) => ({
                    ...x, header: { ...x.header, contact: r.id, contactName: r.name },
                    pay: { ...x.pay!, allocations: r.id === x.header.contact ? x.pay!.allocations : [] },
                  }))}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-ink">{customer ? "Into" : "From"} bank account
                <Picker
                  value={p.bankName}
                  placeholder="Bank account…"
                  invalid={fe.bank_account}
                  collection={(t) => db.bank_accounts.where(t ? { name: { like: t } } : {}).sort("name", "asc")}
                  label={(r) => <span className="flex gap-3"><span>{r.name}</span><span className="text-ink-soft">{r.code}</span></span>}
                  pick={(r) => setPay({ bank_account: r.id, bankName: r.name })}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-ink">Amount
                <NumberField value={p.amount} invalid={fe.amount} placeholder="0.00" onChange={(v) => setPay({ amount: v })} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-ink">Reference
                <input className="field" value={h.reference}
                  onChange={(e) => editDraft(draftKey, (x) => ({ ...x, header: { ...x.header, reference: e.target.value } }))} />
              </label>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <h3 className="text-xs font-semibold text-ink">Settles</h3>
              <button type="button" disabled={!p.amount || !rows.length}
                onClick={() => setPay({ allocations: autoAllocate(p.amount ?? 0, rows).filter((a) => a.amount !== null) })}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-highlight disabled:opacity-40">
                <Wand2 size={13} /> Oldest first
              </button>
              {fe.allocations && <span className="text-sm text-danger">{fe.allocations}</span>}
            </div>
            {!h.contact && <p className="mt-1 text-sm text-ink-soft">Pick the {who} to see their open invoices.</p>}
            {h.contact && rows.length === 0 && open.loadState === "complete" && (
              <p className="mt-1 text-sm text-ink-soft">No open invoices: the whole amount goes on account.</p>
            )}
            {rows.length > 0 && (
              <table className="mt-1 w-full border-separate border-spacing-y-1">
                <thead>
                  <tr className="text-left text-xs font-semibold text-ink">
                    <th className="w-28 pl-1">Date</th><th className="pl-1">Invoice</th>
                    <th className="w-32 pr-2 text-right">Due</th><th className="w-36 pr-[17px] text-right">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {rows.map((a) => (
                      <motion.tr key={a.invoice} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className={(a.amount ?? 0) > 0 ? "font-medium" : "text-ink-soft"}>
                        <td className="pl-1">{fmtDate(a.date)}</td>
                        <td className="pl-1">{a.number || "—"}</td>
                        <td className="num pr-2">{fmtMoney(a.due)}</td>
                        <td><NumberField value={a.amount} placeholder="0.00" onChange={(v) => setAlloc(a.invoice, v)} /></td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            )}
          </section>

          <aside>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-chrome-light p-3">
              <dt>Amount</dt><dd className="num">{fmtMoney(p.amount ?? 0)}</dd>
              <dt>Allocated</dt><dd className="num">{fmtMoney(allocated)}</dd>
              <dt className="border-t border-chrome pt-1 font-semibold">On account</dt>
              <dd className={"num border-t border-chrome pt-1 font-semibold " + (onAccount < -0.004 ? "text-danger" : "")}>{fmtMoney(onAccount)}</dd>
            </dl>
            {d.error && <p role="alert" className="mt-3 rounded bg-[#fde8e6] px-2 py-1.5 text-sm text-danger">{d.error}</p>}
          </aside>
        </div>
      </fieldset>

      <PanelFooter d={d} onClose={onClose} onSave={save} onSaveClose={saveClose} onSaveAndNew={onSaveAndNew}
        saveLabel={customer ? "Save receipt" : "Save payment"} deleteLabel="Delete payment"
        onDelete={d.doc ? async () => {
          const ok = await runAction(db, "delete_doc", { doc: d.doc }, "Payment deleted; its invoices are open again");
          if (ok) { removeDraft(draftKey); onClose(); }
          return !!ok;
        } : undefined} />
    </div>
  );
});

/** A change the program makes (a default), not the user: doesn't mark the draft dirty. */
function editDraftQuiet(key: string, fn: (d: Draft) => Draft) {
  const d = getDraft(key);
  if (d && !isBusy(d)) putDraft(fn(d));
}
