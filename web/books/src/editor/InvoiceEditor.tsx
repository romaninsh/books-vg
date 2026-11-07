import { useEffect, useRef, useState } from "react";
import { AttachButton, AttachmentList, attachFiles } from "./Attachments";
import { DeleteButton } from "./PanelFooter";
import { runAction } from "@/shell/toast";
import { useCompany } from "@/setup/CompanySettings";
import { observer, useCollection } from "@vantage-ui/client/react";
import { AnimatePresence, motion } from "motion/react";
import { Copy, FileClock, Plus, Printer, Trash2, Undo2, UserPlus, X } from "lucide-react";
import { printInvoice } from "./print";
import { useDb } from "@/db";
import { fmtMoney } from "@/format";
import { Picker } from "./Picker";
import { DateField, NumberField } from "./fields";
import { allDrafts, editDraft, emptyLine, getDraft, isBusy, newKey, putDraft, removeDraft, useDrafts, type Draft, type Kind } from "./store";
import { deltas, draftTotals, lineNet, lineVat } from "./totals";
import { saveDraft } from "./save";

// The invoice editor: header fields edited in the row's own cells (HeaderField), lines and
// totals in the expander under it (EditorPanel). Every keystroke goes into the draft; the
// save goes through the queue and never blocks.

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export type Place = { anchor?: string; order: number };

/** Where a new draft goes so it shows right after `key`: a list row (first under it) or
 *  another new draft (next to it, before the drafts that followed it). */
export function placeAfter(key: string | null | undefined): Place {
  const isNew = !!key?.startsWith("new:");
  const src = isNew ? getDraft(key!) : undefined;
  const anchor = isNew ? src?.anchor : key ?? undefined;
  const siblings = allDrafts()
    .filter((d) => d.key.startsWith("new:") && d.anchor === anchor)
    .map((d) => d.order ?? d.createdAt);
  if (!src) return { anchor, order: siblings.length ? Math.min(...siblings) - 1 : 0 };
  const at = src.order ?? src.createdAt;
  const next = siblings.filter((o) => o > at).sort((a, b) => a - b)[0];
  return { anchor, order: next === undefined ? at + 1 : (at + next) / 2 };
}

/** The drafts in display order under one anchor. */
export function draftsUnder(kind: Draft["kind"], anchor: string | undefined): Draft[] {
  return allDrafts()
    .filter((d) => d.kind === kind && d.key.startsWith("new:") && d.anchor === anchor)
    .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

export function newInvoiceDraft(kind: Kind, place: Place = { order: 0 }): string {
  const key = `new:${newKey()}`;
  putDraft({
    key, kind, createdAt: Date.now(), ...place, dirty: false, status: "editing",
    header: { date: today(), number: "", reference: "", due_date: "", contact: "", contactName: "", newContact: null },
    lines: [emptyLine()],
  });
  return key;
}

/** Opening a saved invoice starts a clean draft from its row and lines. */
export function draftFromInvoice(kind: Kind, row: any, lines: readonly any[]): Draft {
  const d: Draft = {
    key: row.id, kind, doc: row.doc, createdAt: Date.now(), dirty: false, status: "editing",
    header: {
      date: (row["doc.date"] ?? "").slice(0, 10), number: row.number ?? "", reference: row["doc.reference"] ?? "",
      due_date: (row.due_date ?? "").slice(0, 10), contact: row.contact?.id ?? "", contactName: row["contact.name"] ?? "",
      newContact: null,
    },
    lines: lines.map((l) => ({
      key: l.id, description: l.description ?? "", nominal: l.nominal?.id ?? "", nominalPath: l["nominal.path"] ?? "",
      quantity: l.quantity, price: l.price, vat_rate: l.vat_rate, vat: l.vat,
      // keep the stored VAT unless it is exactly what the rate gives
      vatManual: Math.abs((l.vat ?? 0) - Math.round((l.quantity ?? 0) * (l.price ?? 0) * (l.vat_rate ?? 0)) / 100) > 0.005,
    })),
    base: { net: row.net ?? 0, vat: row.vat ?? 0, gross: row.gross ?? 0, paid: row.paid ?? 0, amount_due: row.amount_due ?? 0 },
  };
  putDraft(d);
  return d;
}

/** A copy of an invoice as a new draft, right after it: same contact and lines, dated
 *  today, no number. */
export function duplicateDraft(d: Draft): string {
  const key = `new:${newKey()}`;
  putDraft({
    key, kind: d.kind, createdAt: Date.now(), ...placeAfter(d.key), dirty: true, status: "editing",
    header: { ...d.header, date: today(), number: "", due_date: "" },
    lines: d.lines.map((l) => ({ ...l, key: newKey() })),
  });
  return key;
}

/** ⌘ on a Mac, Ctrl elsewhere: shortcuts accept both. */
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** ⌘/Ctrl+Enter save (and new), ⌘/Ctrl+Shift+Enter save & close, Esc close. */
export function editorKeys(e: React.KeyboardEvent, actions: { save: () => void; saveClose: () => void; close: () => void }) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); e.stopPropagation();
    if (e.shiftKey) actions.saveClose(); else actions.save();
  } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); actions.close(); }
}

// ---- header fields, drawn inside the row's cells ------------------------------------

export const HeaderField = observer(({ draftKey, field, autoFocus }: {
  draftKey: string; field: "date" | "number" | "contact" | "reference" | "due_date"; autoFocus?: boolean;
}) => {
  useDrafts();
  const db = useDb() as any;
  const d = getDraft(draftKey);
  if (!d) return null;
  const h = d.header;
  const err = d.fieldErrors?.[field];
  const set = (patch: Partial<Draft["header"]>) => editDraft(draftKey, (x) => ({ ...x, header: { ...x.header, ...patch } }));
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (field === "contact") {
    const entity = d.kind === "sale" ? db.customers : db.suppliers;
    const who = d.kind === "sale" ? "customer" : "supplier";
    return (
      <div onClick={stop} className="w-full">
        <Picker
          autoFocus={autoFocus}
          value={h.newContact ? h.newContact.name : h.contactName}
          placeholder={`Type a ${who}…`}
          invalid={err}
          collection={(t) => entity.where(t ? { name: { like: t } } : {}).sort("name", "asc")}
          label={(r) => (
            <span className="flex gap-3"><span>{r.name}</span><span className="text-ink-soft">{r.country}</span></span>
          )}
          pick={(r) => set({
            contact: r.id, contactName: r.name, newContact: null,
            due_date: h.due_date || addDays(h.date || today(), r.credit_terms ?? 30),
          })}
          create={{
            label: (t) => `Create ${who} "${t}"`,
            onCreate: (t) => {
              set({
                contact: "", contactName: "",
                newContact: { name: t, country: "United Kingdom", currency: "GBP", vat_no: "", email: "", credit_terms: 30 },
                due_date: h.due_date || addDays(h.date || today(), 30),
              });
              // straight on to the new customer's details (the name is already there)
              setTimeout(() => document.getElementById(`nc-country-${draftKey}`)?.focus(), 60);
            },
          }}
        />
      </div>
    );
  }
  if (field === "date" || field === "due_date") {
    return (
      <div onClick={stop} className="w-full">
        <DateField
          autoFocus={autoFocus}
          value={h[field]}
          base={field === "due_date" ? h.date : undefined}
          invalid={err}
          onChange={(v) => set({ [field]: v } as Partial<Draft["header"]>)}
        />
      </div>
    );
  }
  return (
    <input
      onClick={stop}
      autoFocus={autoFocus}
      value={h[field]}
      aria-invalid={!!err}
      title={err}
      onChange={(e) => set({ [field]: e.target.value } as Partial<Draft["header"]>)}
      className="field"
    />
  );
});

/** A total cell: what the draft will change it by, then the saved value. The value keeps
 *  the right edge, so it never moves when the change appears or grows. */
export function TotalCell({ value, delta }: { value: number | null | undefined; delta: number }) {
  return (
    <span className="flex items-baseline justify-end gap-1.5">
      {Math.abs(delta) >= 0.005 && (
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={"text-xs font-semibold " + (delta > 0 ? "delta-up" : "delta-down")}
        >
          {delta > 0 ? "+" : "−"}{fmtMoney(Math.abs(delta))}
        </motion.span>
      )}
      <span>{fmtMoney(value ?? 0)}</span>
    </span>
  );
}
export { deltas };

// ---- the expander ------------------------------------------------------------------


export const EditorPanel = observer(({ draftKey, kind, row, onClose, onSaveAndNew, onDuplicate }: {
  draftKey: string; kind: Kind; row?: any; onClose: () => void; onSaveAndNew?: () => void;
  onDuplicate: (newKey: string) => void;
}) => {
  useDrafts();
  const db = useDb() as any;
  // An existing invoice: load its lines, then start a clean draft from them.
  const lines = useCollection(db.invoice_lines.where({ doc: row?.doc ?? "doc:none" }).sort("rank", "asc"));
  useEffect(() => {
    if (row && !getDraft(draftKey) && lines.loadState === "complete") draftFromInvoice(kind, row, [...lines.items]);
  }, [row, draftKey, lines.loadState]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = getDraft(draftKey);
  const panelRef = useRef<HTMLDivElement>(null);
  const company = useCompany();
  const [dropping, setDropping] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  if (!d) return <p className="px-6 py-4 text-ink-soft">Loading lines…</p>;

  const saving = isBusy(d);
  const fe = d.fieldErrors ?? {};
  const t = draftTotals(d);
  const dl = deltas(d);
  const who = d.kind === "sale" ? "customer" : "supplier";
  const saveClose = () => { saveDraft(db, draftKey); onClose(); };
  const save = () => { saveDraft(db, draftKey); if (onSaveAndNew) onSaveAndNew(); else onClose(); };
  const hasContent = (l: Draft["lines"][number]) => !!(l.description || l.nominal || l.price !== null);
  const setLine = (i: number, patch: Partial<Draft["lines"][number]>) =>
    editDraft(draftKey, (x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const addLine = (focus = true) => {
    editDraft(draftKey, (x) => ({ ...x, lines: [...x.lines, emptyLine()] }));
    if (focus) setTimeout(() => {
      const inputs = panelRef.current?.querySelectorAll<HTMLInputElement>("[data-line-first]");
      inputs?.[inputs.length - 1]?.focus();
    }, 30);
  };
  const removeLine = (i: number) => editDraft(draftKey, (x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }));
  const nc = d.header.newContact;
  const setNc = (patch: Partial<NonNullable<typeof nc>>) =>
    editDraft(draftKey, (x) => ({ ...x, header: { ...x.header, newContact: { ...x.header.newContact!, ...patch } } }));

  return (
    <div
      ref={panelRef}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => editorKeys(e, { save, saveClose, close: onClose })}
      // files dropped anywhere on the invoice are attached to it
      onDragOver={(e) => { if (!saving && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
      onDrop={async (e) => {
        e.preventDefault();
        setDropping(false);
        if (!saving && e.dataTransfer.files.length) setFileError(await attachFiles(draftKey, e.dataTransfer.files));
      }}
      className={"text-[13.5px] " + (dropping ? "bg-highlight outline-2 outline-dashed outline-accent -outline-offset-4" : "")}
    >
      {/* while it saves the invoice stays in view, read-only; the user carries on elsewhere */}
      <fieldset disabled={saving} className={"m-0 min-w-0 border-0 p-0 " + (saving ? "opacity-75" : "")}>
      {/* new contact, inline: only what is needed now; Tab flows through it */}
      <AnimatePresence initial={false}>
        {nc && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-chrome bg-highlight/50"
          >
            <div className="flex flex-wrap items-end gap-3 px-5 py-3">
              <div className="flex items-center gap-2 self-center font-semibold text-accent">
                <UserPlus size={16} /> New {who}
              </div>
              <label className="flex w-56 flex-col gap-0.5 text-xs font-medium text-ink">Name
                <input className="field" value={nc.name} onChange={(e) => setNc({ name: e.target.value })} aria-invalid={!!fe.contact} />
              </label>
              <label className="flex w-44 flex-col gap-0.5 text-xs font-medium text-ink">Country
                <input id={`nc-country-${draftKey}`} className="field" value={nc.country} onChange={(e) => setNc({ country: e.target.value })} />
              </label>
              <label className="flex w-20 flex-col gap-0.5 text-xs font-medium text-ink">Currency
                <input className="field" value={nc.currency} onChange={(e) => setNc({ currency: e.target.value.toUpperCase() })} />
              </label>
              <label className="flex w-40 flex-col gap-0.5 text-xs font-medium text-ink">VAT number
                <input className="field" value={nc.vat_no} onChange={(e) => setNc({ vat_no: e.target.value })} />
              </label>
              <label className="flex w-56 flex-col gap-0.5 text-xs font-medium text-ink">Email
                <input className="field" type="email" value={nc.email} onChange={(e) => setNc({ email: e.target.value })} />
              </label>
              <label className="flex w-20 flex-col gap-0.5 text-xs font-medium text-ink">Terms (d)
                <NumberField
                  value={nc.credit_terms}
                  onChange={(v) => {
                    // a due date that came from the old terms follows the new ones
                    const h = d.header;
                    const auto = h.due_date === addDays(h.date || today(), nc.credit_terms ?? 30);
                    editDraft(draftKey, (x) => ({
                      ...x,
                      header: {
                        ...x.header,
                        newContact: { ...x.header.newContact!, credit_terms: v },
                        due_date: auto && v !== null ? addDays(h.date || today(), v) : x.header.due_date,
                      },
                    }));
                  }}
                />
              </label>
              <button
                type="button"
                tabIndex={-1}
                title="Pick an existing one instead"
                onClick={() => editDraft(draftKey, (x) => ({ ...x, header: { ...x.header, newContact: null } }))}
                className="mb-1 rounded p-1 text-ink-soft hover:bg-white hover:text-ink"
              >
                <X size={16} />
              </button>
              <span className="mb-1.5 text-xs text-ink-soft">Saved together with this invoice.</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-[minmax(0,1fr)_17rem] gap-6 px-5 py-3">
        <section>
          <table className="w-full border-separate border-spacing-y-1">
            {/* labels sit over the text inside the fields: inputs are padded 8px + 1px border,
                cells add 8px on the right */}
            <thead>
              <tr className="text-left text-xs font-semibold text-ink">
                <th className="w-[34%] pb-1 pl-[9px]">Description</th>
                <th className="w-[24%] pb-1 pl-[9px]">Nominal</th>
                <th className="w-16 pb-1 pr-[17px] text-right">Qty</th>
                <th className="w-24 pb-1 pr-[17px] text-right">Price</th>
                <th className="w-16 pb-1 pr-[17px] text-right">VAT %</th>
                <th className="w-24 pb-1 pr-[17px] text-right">VAT</th>
                <th className="w-24 pb-1 pr-2 text-right">Net</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {d.lines.map((l, i) => {
                  const last = i === d.lines.length - 1;
                  const err = (f: string) => fe[`lines.${i}.${f}`];
                  return (
                    <motion.tr
                      key={l.key}
                      layout="position"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{ duration: 0.16 }}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); removeLine(i); }
                      }}
                    >
                      <td className="pr-2">
                        <input data-line-first className="field" value={l.description} placeholder="Description"
                          onChange={(e) => setLine(i, { description: e.target.value })} />
                      </td>
                      <td className="pr-2">
                        <Picker
                          value={l.nominalPath}
                          placeholder="Nominal…"
                          invalid={err("nominal")}
                          collection={(text) => db.nominals.where(text ? { path: { like: text } } : {}).sort("code", "asc")}
                          label={(r) => <span className="flex gap-3"><span className="w-12 text-ink-soft">{r.code}</span><span>{r.path}</span></span>}
                          pick={(r) => setLine(i, { nominal: r.id, nominalPath: r.path })}
                        />
                      </td>
                      <td className="pr-2"><NumberField value={l.quantity} invalid={err("quantity")}
                        onChange={(v) => setLine(i, { quantity: v })} /></td>
                      <td className="pr-2"><NumberField value={l.price} invalid={err("price")} placeholder="0.00"
                        onChange={(v) => setLine(i, { price: v })} /></td>
                      <td className="pr-2"><NumberField value={l.vat_rate}
                        onChange={(v) => setLine(i, { vat_rate: v })} /></td>
                      <td className="pr-2" title={l.vatManual ? "Typed by hand (clear it to use the rate)" : "From the rate; type to override"}>
                        <NumberField
                          className={l.vatManual ? "font-semibold" : ""}
                          value={l.vatManual ? l.vat : lineVat(l)}
                          onChange={(v) => setLine(i, v === null ? { vatManual: false, vat: null } : { vatManual: true, vat: v })}
                          onKeyDown={(e) => {
                            // Enter, or Tab out of a filled-in last line, starts the next line
                            const next = (e.key === "Enter" && !e.ctrlKey && !e.metaKey)
                              || (e.key === "Tab" && !e.shiftKey && hasContent(l));
                            if (next && last) { e.preventDefault(); addLine(); }
                          }}
                        />
                      </td>
                      <td className="num pr-2 font-medium">{fmtMoney(lineNet(l))}</td>
                      <td>
                        <button type="button" tabIndex={-1} title={`Remove line (${MOD}+Backspace)`} onClick={() => removeLine(i)}
                          className="rounded p-1 text-ink-soft hover:bg-[#fde8e6] hover:text-danger">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => addLine()}
              className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-accent hover:bg-highlight">
              <Plus size={14} /> Add line
            </button>
            <AttachButton draftKey={draftKey} onError={setFileError} />
            <span className="mt-1 text-xs text-ink-soft">or drop files here</span>
          </div>
          {fe.lines && <p className="mt-1 text-sm text-danger">{fe.lines}</p>}
          <AttachmentList draftKey={draftKey} doc={d.doc} />
          {(fileError || fe.files) && <p className="mt-1 text-sm text-danger">{fileError ?? fe.files}</p>}
        </section>

        <aside className="flex flex-col gap-3">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-chrome-light p-3">
            <dt>Net</dt><dd className="num"><TotalCell value={d.base ? d.base.net : t.net} delta={d.base ? dl.net : 0} /></dd>
            <dt>VAT</dt><dd className="num"><TotalCell value={d.base ? d.base.vat : t.vat} delta={d.base ? dl.vat : 0} /></dd>
            <dt>Gross</dt><dd className="num"><TotalCell value={d.base ? d.base.gross : t.gross} delta={d.base ? dl.gross : 0} /></dd>
            <dt>Paid</dt><dd className="num">{fmtMoney(t.paid)}</dd>
            <dt className="border-t border-chrome pt-1 font-semibold">Amount due</dt>
            <dd className="num border-t border-chrome pt-1 font-semibold">
              <TotalCell value={d.base ? d.base.amount_due : t.amount_due} delta={d.base ? dl.amount_due : 0} />
            </dd>
          </dl>
          {d.error && <p role="alert" className="rounded bg-[#fde8e6] px-2 py-1.5 text-sm text-danger">{d.error}</p>}
        </aside>
      </div>
      </fieldset>

      {/* the action bar: document actions on the left, the keyboard note, saving on the right */}
      <footer className="flex items-center gap-2 border-t border-chrome bg-chrome-light/60 px-5 py-2.5">
        <FooterButton icon={<Copy size={14} />} label="Duplicate" onClick={() => onDuplicate(duplicateDraft(d))} />
        <FooterButton icon={<FileClock size={14} />} label="Keep as draft" onClick={onClose}
          title="Close it; the draft stays until you save or discard it (Esc)" />
        <FooterButton icon={<Printer size={14} />} label="Print" onClick={() => printInvoice(d, company)} />
        {d.dirty && !saving && (
          <FooterButton icon={<Undo2 size={14} />} label="Discard changes" danger
            onClick={() => { removeDraft(draftKey); onClose(); }} />
        )}
        {d.doc && !saving && (
          <DeleteButton label={d.kind === "sale" ? "Delete invoice" : "Delete"} onDelete={async () => {
            const ok = await runAction(db, "delete_doc", { doc: d.doc }, `Deleted ${d.header.number ? `invoice ${d.header.number}` : "the invoice"}`);
            if (ok) { removeDraft(draftKey); onClose(); }
            return !!ok;
          }} />
        )}

        {/* the keyboard note: quiet, one line, never pushes the buttons down */}
        <div className="mx-3 min-w-0 flex-1 truncate rounded border border-[#ece3b5] bg-[#fdfaea] px-2.5 py-1 text-xs text-[#5c5427]"
          title={`${MOD}+Enter ${onSaveAndNew ? "save & new" : "save"} · ${MOD}+Shift+Enter save & close · Esc close, keeping the draft · Tab past the last line adds one · ${MOD}+Backspace removes a line`}>
          {saving ? "Saving… carry on with the next one."
            : <><b>{MOD}↵</b> {onSaveAndNew ? "save & new" : "save"} · <b>⇧{MOD}↵</b> save & close · <b>Esc</b> close · <b>{MOD}⌫</b> remove line</>}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!saving && (
            <button type="button" onClick={onClose}
              className="rounded-md border border-[#9aa3a6] bg-white px-3 py-1.5 text-sm text-ink hover:bg-chrome-light">Close</button>
          )}
          {onSaveAndNew && (
            <button type="button" disabled={saving} onClick={save} title={`${MOD}+Enter`}
              className="rounded-md border border-accent bg-white px-3 py-1.5 text-sm font-semibold text-accent hover:bg-highlight disabled:opacity-60">
              Save & new
            </button>
          )}
          {/* Save is always the main button */}
          <button type="button" disabled={saving} onClick={saveClose} title={onSaveAndNew ? `${MOD}+Shift+Enter` : `${MOD}+Enter`}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </footer>
    </div>
  );
});

function FooterButton({ icon, label, onClick, title, danger }: {
  icon: React.ReactNode; label: string; onClick: () => void; title?: string; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={"flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-sm " +
        (danger ? "border-[#e6b4ae] text-danger hover:bg-[#fde8e6]" : "border-[#9aa3a6] text-ink hover:bg-chrome-light")}>
      {icon}{label}
    </button>
  );
}
