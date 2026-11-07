import { useEffect, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { MOD } from "./InvoiceEditor";
import { isBusy, removeDraft, type Draft } from "./store";

// The bottom row every editor shares: Discard and Delete on the left, the keyboard note,
// Close / Save & new / Save on the right (Save is always the main button). Delete asks for
// a second click within a few seconds instead of a dialog.

export function DeleteButton({ label = "Delete", onDelete }: { label?: string; onDelete: () => Promise<boolean> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" disabled={busy}
      onClick={async () => {
        if (!armed) { setArmed(true); return; }
        setBusy(true);
        const ok = await onDelete();
        setBusy(false);
        if (!ok) setArmed(false);
      }}
      className={"flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm disabled:opacity-60 " +
        (armed ? "border-danger bg-danger text-white" : "border-[#e3b4b0] bg-white text-danger hover:bg-[#fde8e6]")}>
      <Trash2 size={14} /> {busy ? "Deleting…" : armed ? "Click again to delete" : label}
    </button>
  );
}

export function PanelFooter({ d, onClose, onSave, onSaveClose, onSaveAndNew, saveLabel = "Save", left, onDelete, deleteLabel }: {
  d: Draft; onClose: () => void; onSave: () => void; onSaveClose: () => void; onSaveAndNew?: () => void;
  saveLabel?: string; left?: ReactNode; onDelete?: () => Promise<boolean>; deleteLabel?: string;
}) {
  const saving = isBusy(d);
  return (
    <footer className="flex items-center gap-2 border-t border-chrome bg-chrome-light/60 px-5 py-2.5">
      {left}
      {d.dirty && !saving && (
        <button type="button" onClick={() => { removeDraft(d.key); onClose(); }}
          className="rounded-md border border-[#9aa3a6] bg-white px-3 py-1.5 text-sm text-ink hover:bg-chrome-light">Discard changes</button>
      )}
      {onDelete && !saving && <DeleteButton label={deleteLabel} onDelete={onDelete} />}
      <div className="mx-3 min-w-0 flex-1 truncate rounded border border-[#ece3b5] bg-[#fdfaea] px-2.5 py-1 text-xs text-[#5c5427]">
        {d.status === "saved" ? "Saved ✓" : saving ? "Saving… carry on with the next one."
          : <><b>{MOD}↵</b> {onSaveAndNew ? "save & new" : "save"} · <b>⇧{MOD}↵</b> save & close · <b>Esc</b> close</>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!saving && (
          <button type="button" onClick={onClose}
            className="rounded-md border border-[#9aa3a6] bg-white px-3 py-1.5 text-sm text-ink hover:bg-chrome-light">Close</button>
        )}
        {onSaveAndNew && (
          <button type="button" disabled={saving} onClick={onSave}
            className="rounded-md border border-accent bg-white px-3 py-1.5 text-sm font-semibold text-accent hover:bg-highlight disabled:opacity-60">
            Save & new
          </button>
        )}
        <button type="button" disabled={saving} onClick={onSaveClose}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand disabled:opacity-60">
          {saving ? "Saving…" : saveLabel}
        </button>
      </div>
    </footer>
  );
}
