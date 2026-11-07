import { useEffect } from "react";
import { observer, useCollection } from "@vantage-ui/client/react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useDb } from "@/db";
import { Picker } from "./Picker";
import { DateField, NumberField } from "./fields";
import { editorKeys, type Place } from "./InvoiceEditor";
import { editDraft, getDraft, isBusy, newKey, putDraft, removeDraft, useDrafts, type Draft, type MiscFields } from "./store";
import { saveDraft } from "./save";
import { PanelFooter } from "./PanelFooter";
import { runAction } from "@/shell/toast";

// Misc payments and lodgements: money out of (or into) a bank account straight to a nominal,
// with no customer or supplier (bank charges, a director's expense, interest received).

const today = () => new Date().toISOString().slice(0, 10);

function draftOf(key: string, extra: Partial<Draft>, misc?: Partial<MiscFields>): Draft {
  return {
    key, kind: "misc", createdAt: Date.now(), dirty: false, status: "editing",
    header: { date: today(), number: "", reference: "", due_date: "", contact: "", contactName: "", newContact: null },
    lines: [],
    misc: { type: "misc_payment", contact_name: "", description: "", bank_account: "", bankName: "", nominal: "", nominalPath: "", amount: null, ...misc },
    ...extra,
  };
}

export function newMiscDraft(place: Place = { order: 0 }): string {
  const key = `new:${newKey()}`;
  putDraft(draftOf(key, place));
  return key;
}

function miscDraftFromRow(row: any) {
  putDraft(draftOf(row.id, {
    doc: row.doc,
    header: {
      date: (row["doc.date"] ?? "").slice(0, 10), number: "", reference: row["doc.reference"] ?? "", due_date: "",
      contact: "", contactName: "", newContact: null,
    },
  }, {
    type: row["doc.type"], contact_name: row["doc.contact_name"] ?? "", description: row["doc.description"] ?? "",
    bank_account: row.bank_account?.id ?? row.bank_account ?? "", bankName: row["bank_account.name"] ?? "",
    nominal: row.nominal?.id ?? row.nominal ?? "", nominalPath: row["nominal.path"] ?? "", amount: row["doc.total"] ?? null,
  }));
}

export const MiscPanel = observer(({ draftKey, row, onClose, onSaveAndNew }: {
  draftKey: string; row?: any; onClose: () => void; onSaveAndNew?: () => void;
}) => {
  useDrafts();
  const db = useDb() as any;
  useEffect(() => { if (row && !getDraft(draftKey)) miscDraftFromRow(row); }, [row, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const banks = useCollection(db.bank_accounts.where({}).sort("name", "asc"));
  const d = getDraft(draftKey);
  // a new one starts on the first bank account (not a change the user made)
  useEffect(() => {
    const b = banks.items[0] as any;
    if (d?.misc && !d.misc.bank_account && b?.id) putDraft({ ...d, misc: { ...d.misc, bank_account: b.id, bankName: b.name } });
  }, [banks.items.length, d?.misc?.bank_account]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d?.misc) return <p className="px-6 py-4 text-ink-soft">Loading…</p>;
  const m = d.misc, h = d.header;
  const saving = isBusy(d);
  const fe = d.fieldErrors ?? {};
  const set = (patch: Partial<MiscFields>) => editDraft(draftKey, (x) => ({ ...x, misc: { ...x.misc!, ...patch } }));
  const setH = (patch: Partial<Draft["header"]>) => editDraft(draftKey, (x) => ({ ...x, header: { ...x.header, ...patch } }));
  const save = () => { saveDraft(db, draftKey); if (onSaveAndNew) onSaveAndNew(); else onClose(); };
  const saveClose = () => { saveDraft(db, draftKey); onClose(); };
  const out = m.type === "misc_payment";
  const label = "flex flex-col gap-0.5 text-xs font-semibold text-ink";

  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => editorKeys(e, { save, saveClose, close: onClose })} className="text-[13.5px]">
      <fieldset disabled={saving} className={"m-0 min-w-0 border-0 p-0 " + (saving ? "opacity-75" : "")}>
        <div className="flex flex-wrap items-end gap-3 px-5 py-3">
          <div className="flex rounded-md border border-chrome bg-chrome-light p-0.5" role="radiogroup" aria-label="Direction">
            {([["misc_payment", "Money out", ArrowUpRight], ["misc_lodgement", "Money in", ArrowDownLeft]] as const).map(([t, l, Icon]) => (
              <button key={t} type="button" role="radio" aria-checked={m.type === t} onClick={() => set({ type: t })}
                className={"flex items-center gap-1 rounded px-3 py-1 text-sm " + (m.type === t ? "bg-white font-semibold text-ink shadow-sm" : "text-ink-soft hover:text-ink")}>
                <Icon size={14} /> {l}
              </button>
            ))}
          </div>
          <label className={label + " w-36"}>Date<DateField value={h.date} invalid={fe.date} onChange={(v) => setH({ date: v })} /></label>
          <label className={label + " w-56"}>{out ? "Paid to" : "Received from"}
            <input className="field" value={m.contact_name} autoFocus={!d.doc} onChange={(e) => set({ contact_name: e.target.value })} />
          </label>
          <label className={label + " w-56"}>{out ? "From" : "Into"} bank account
            <Picker value={m.bankName} placeholder="Bank account…" invalid={fe.bank_account}
              collection={(t) => db.bank_accounts.where(t ? { name: { like: t } } : {}).sort("name", "asc")}
              label={(r) => <span className="flex gap-3"><span>{r.name}</span><span className="text-ink-soft">{r.code}</span></span>}
              pick={(r) => set({ bank_account: r.id, bankName: r.name })} />
          </label>
          <label className={label + " min-w-64 flex-1"}>Nominal
            <Picker value={m.nominalPath} placeholder="Nominal…" invalid={fe.nominal}
              collection={(t) => db.nominals.where(t ? { path: { like: t } } : {}).sort("code", "asc")}
              label={(r) => <span className="flex gap-3"><span className="w-12 text-ink-soft">{r.code}</span><span>{r.path}</span></span>}
              pick={(r) => set({ nominal: r.id, nominalPath: r.path })} />
          </label>
          <label className={label + " w-32"}>Amount
            <NumberField value={m.amount} invalid={fe.amount} placeholder="0.00" onChange={(v) => set({ amount: v })} />
          </label>
        </div>
        <div className="flex gap-3 px-5 pb-3">
          <label className={label + " w-56"}>Reference<input className="field" value={h.reference} onChange={(e) => setH({ reference: e.target.value })} /></label>
          <label className={label + " flex-1"}>Description<input className="field" value={m.description} onChange={(e) => set({ description: e.target.value })} /></label>
        </div>
        {d.error && <p role="alert" className="mx-5 mb-3 rounded bg-[#fde8e6] px-2 py-1.5 text-sm text-danger">{d.error}</p>}
      </fieldset>
      <PanelFooter d={d} onClose={onClose} onSave={save} onSaveClose={saveClose} onSaveAndNew={onSaveAndNew}
        onDelete={d.doc ? async () => {
          const ok = await runAction(db, "delete_doc", { doc: d.doc }, "Deleted");
          if (ok) { removeDraft(draftKey); onClose(); }
          return !!ok;
        } : undefined} />
    </div>
  );
});
