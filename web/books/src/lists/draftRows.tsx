import { useEffect, useRef, type ReactNode } from "react";
import { motion } from "motion/react";
import { Expander, RowCells, ROW, type Col, type Pin } from "./DataList";
import { allDrafts, getDraft, justSaved, removeDraft, type Draft } from "@/editor/store";
import { draftsUnder } from "@/editor/InvoiceEditor";
import { saveDraft } from "@/editor/save";

// What every editable list shares: new records as rows of their own (under the cursor, or
// above the list), open while edited and while saving; unsaved ones pinned in sight; state
// classes; the keys (N new, Esc close, ⌘↵ save & new, ⇧⌘↵ save & close); and dropping an
// untouched draft when its row closes. A list supplies its cells and its editor.

/** The words for a record's save state in its status cell, or null when it has none. */
export function statusText(d: Draft): ReactNode | null {
  if (d.status === "saving") return <span className="font-medium text-accent">Saving…</span>;
  if (d.status === "saved") return <span className="font-medium text-success">Saved ✓</span>;
  if (d.status === "failed") return <span className="font-medium text-danger">Not saved</span>;
  return null;
}

/** A record's state as one class, the same everywhere (styles.css, "Record state"):
 *  draft (changed, not saved) → saving → saved (held until read back) → fades; or failed. */
export const stateClass = (d: Draft | undefined, saved?: string) =>
  d?.status === "saving" ? "row-saving"
    : d?.status === "saved" ? "row-held"
    : d?.status === "failed" ? "row-failed"
    : d?.dirty ? "row-dirty"
    : justSaved(saved) ? "row-saved" : "";

export function useDraftRows({ kind, cols, openKey, setOpenKey, startNew, cell, panel, db }: {
  kind: Draft["kind"];
  cols: Col[];
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
  startNew: (after?: string | null) => void;
  cell: (d: Draft, col: Col) => ReactNode | undefined;
  panel: (d: Draft) => ReactNode;
  db: any;
}) {
  // Leaving a row drops its draft if nothing was changed.
  const prevOpen = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevOpen.current;
    if (prev && prev !== openKey) {
      const d = getDraft(prev);
      if (d && !d.dirty && d.status === "editing") removeDraft(prev);
    }
    prevOpen.current = openKey;
  }, [openKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // a picker or the panel already handled it
      const inInput = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (e.key === "n" && !inInput && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startNew(); }
      else if (openKey && e.key === "Escape") { e.preventDefault(); setOpenKey(null); }
      else if (openKey && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveDraft(db, openKey);
        if (openKey.startsWith("new:") && !e.shiftKey) startNew(openKey); else setOpenKey(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const mine = allDrafts().filter((d) => d.kind === kind && !d.flipOf);
  const byOrder = (a: Draft, b: Draft) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt);

  const rows = (drafts: Draft[]) => drafts.map((d) => {
    const isOpen = openKey === d.key || d.status === "saving";
    return (
      <motion.div key={d.key} data-dock={openKey === d.key ? d.key : undefined}
        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.15 }}>
        <div role="row" data-pin={d.key} aria-expanded={isOpen} onClick={() => setOpenKey(openKey === d.key ? null : d.key)}
          className={"relative flex border-b border-chrome-light " + (isOpen ? "bg-highlight " : "bg-highlight/60 ") + stateClass(d)}
          style={{ height: ROW }}>
          <RowCells cols={cols} row={{ id: d.key }} isOpen={isOpen} withChevron cell={(_r, c) => cell(d, c)} />
        </div>
        <Expander open={isOpen}>{isOpen && panel(d)}</Expander>
      </motion.div>
    );
  });

  const pins: Pin[] = mine
    .filter((d) => d.key.startsWith("new:") || d.dirty || d.status !== "editing")
    .sort(byOrder)
    .map((d) => ({
      key: d.key, anchor: d.key.startsWith("new:") ? d.anchor : d.key,
      render: () => <RowCells cols={cols} row={{ id: d.key }} isOpen={false} withChevron cell={(_r, c) => cell(d, c)} />,
    }));

  const newOnes = mine.filter((d) => d.key.startsWith("new:"));
  return {
    pins,
    topRows: (loaded: Set<string>) => rows(newOnes.filter((d) => !d.anchor || !loaded.has(d.anchor)).sort(byOrder)),
    after: (row: any) => rows(draftsUnder(kind, row.id)),
    expanded: (row: any) => getDraft(row.id)?.status === "saving", // read-only while it saves
    rowClass: (row: any, saved?: string) => stateClass(getDraft(row.id), saved),
    ownChange: (row: any, saved?: string) => !!getDraft(row.id) || justSaved(saved),
    cellOf: (row: any, col: Col) => { const d = getDraft(row.id); return d ? cell(d, col) : undefined; },
  };
}
