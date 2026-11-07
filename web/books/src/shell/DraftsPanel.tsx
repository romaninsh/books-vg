import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, FileClock, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useDb } from "@/db";
import { fmtMoney } from "@/format";
import { allDrafts, removeDraft, setSide, useDrafts, type Draft } from "@/editor/store";
import { draftTotals } from "@/editor/totals";
import { saveDraft } from "@/editor/save";
import { draftPath } from "@/editor/routes";
import { showDate } from "@/editor/fields";
import { ScopeToggle, useScope } from "./Scope";

// Drafts: everything not yet in the books, from any page. Unsaved changes, saves on their
// way and saves that failed; open one, retry it or throw it away. The button's badge says
// how many, red when a save failed.

const pending = () =>
  allDrafts()
    .filter((d) => d.status !== "saved" && (d.dirty || d.status !== "editing")) // saved ones are in the books
    .sort((a, b) => b.createdAt - a.createdAt);

/** "Sales invoice #54", "Payment received · new", "Credit note against #54". */
export function draftLabel(d: Draft) {
  const n = d.header.number;
  if (d.kind === "misc") return `${d.misc?.type === "misc_lodgement" ? "Misc lodgement" : "Misc payment"}${d.doc ? "" : " · new"}`;
  if (d.kind === "client" || d.kind === "supplier") return `${d.kind === "client" ? "Customer" : "Supplier"}${d.doc ? "" : " · new"}`;
  if (d.creditFor) return `Credit note against ${d.creditFor.number || "invoice"}`;
  if (d.kind === "lodgement") return `Payment received${d.flipOf ? " against an invoice" : d.doc ? "" : " · new"}`;
  if (d.kind === "payment") return `Payment made${d.flipOf ? " against an invoice" : d.doc ? "" : " · new"}`;
  return `${d.kind === "sale" ? "Sales" : "Purchase"} invoice ${n ? `#${n}` : d.doc ? "" : "· new"}`;
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function DraftsButton() {
  useDrafts();
  const db = useDb() as any;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const all = pending();
  const failed = all.filter((d) => d.status === "failed").length;
  const saving = all.filter((d) => d.status === "saving").length;
  const { scope, setScope, shows } = useScope("drafts");
  const list = all.filter((d) => shows(draftPath(d)));

  // D opens it from anywhere outside a field; Esc or a click elsewhere closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement;
      const inField = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
      if (e.key === "d" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (open && e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("mousedown", onDown); };
  }, [open]);
  // Opening puts the keyboard on the first draft.
  useEffect(() => {
    if (open) setTimeout(() => panelRef.current?.querySelector<HTMLElement>("[data-draft]")?.focus(), 0);
  }, [open]);

  const go = (d: Draft) => {
    setOpen(false);
    if (d.flipOf) setSide(d.flipOf, d.creditFor ? "credit" : "payment"); // open the card on that page
    navigate(draftPath(d));
  };
  const moveFocus = (dir: 1 | -1) => {
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-draft]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[Math.max(0, Math.min(items.length - 1, i + dir))]?.focus();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        title="Drafts: unsaved and failed invoices (D)"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={"flex h-7 items-center gap-1.5 rounded px-2 hover:bg-white/10 hover:text-white " + (open ? "bg-white/15 text-white" : "text-white/85")}
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <FileClock size={15} />}
        <span className="hidden text-xs xl:inline">Drafts</span>
        {all.length > 0 && (
          <motion.span
            key={all.length}
            initial={{ scale: 0.6 }}
            animate={{ scale: 1 }}
            className={"min-w-[18px] rounded-full px-1 text-center text-[11px] font-semibold leading-[18px] " +
              (failed ? "bg-danger text-white" : "bg-[#f3e7a8] text-ink")}
          >
            {all.length}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-label="Drafts"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
              if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
            }}
            className="absolute right-0 top-9 z-50 w-[30rem] overflow-hidden rounded-md border border-[#9fb3b0] bg-white text-ink shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-chrome bg-chrome-light px-3 py-2 text-xs text-ink-soft">
              <span className="font-semibold text-ink">Drafts</span>
              <span className="ml-3 mr-auto">kept on this computer until saved or discarded</span>
              <ScopeToggle scope={scope} setScope={setScope} />
            </div>
            {list.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-ink-soft">
                {all.length && scope === "page" ? `Nothing on this page; ${all.length} elsewhere.` : "Nothing waiting. Everything is saved."}
              </p>
            )}
            <ul className="max-h-[60vh] overflow-auto">
              <AnimatePresence initial={false}>
                {list.map((d) => {
                  const h = d.header;
                  const who = d.contact ? d.contact.name || "No name yet"
                    : d.misc ? d.misc.contact_name || d.misc.description || "Misc"
                    : h.newContact?.name || h.contactName || "No customer yet";
                  return (
                    <motion.li
                      key={d.key}
                      layout="position"
                      exit={{ opacity: 0, x: 16 }}
                      transition={{ duration: 0.15 }}
                      className="group flex items-center gap-2 border-b border-chrome-light px-3 py-2 last:border-b-0"
                    >
                      <button
                        type="button"
                        data-draft
                        onClick={() => go(d)}
                        onKeyDown={(e) => {
                          if (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) {
                            e.preventDefault();
                            if (d.status !== "saving") { moveFocus(1); removeDraft(d.key); }
                          }
                        }}
                        className="flex min-w-0 flex-1 flex-col items-start rounded px-1 py-0.5 text-left outline-none hover:bg-highlight focus:bg-highlight"
                      >
                        <span className="flex w-full items-baseline gap-2 text-sm">
                          <span className="truncate font-medium">{who}</span>
                          <span className="ml-auto num shrink-0">{d.contact ? "" : fmtMoney(d.pay ? d.pay.amount ?? 0 : d.misc ? d.misc.amount ?? 0 : draftTotals(d).gross)}</span>
                        </span>
                        <span className="flex w-full gap-2 text-xs text-ink-soft">
                          <span>{draftLabel(d)}</span>
                          <span>{showDate(h.date)}</span>
                          <span className="ml-auto">{ago(d.createdAt)}</span>
                        </span>
                        {d.status === "saving" && <span className="text-xs text-accent">Saving…</span>}
                        {d.status === "failed" && (
                          <span className="flex items-center gap-1 text-xs font-medium text-danger">
                            <AlertCircle size={12} /> Not saved: {d.error}
                          </span>
                        )}
                      </button>
                      {d.status === "failed" && (
                        <button type="button" tabIndex={-1} title="Try the save again" onClick={() => saveDraft(db, d.key)}
                          className="rounded p-1.5 text-accent hover:bg-highlight"><RotateCcw size={15} /></button>
                      )}
                      {d.status !== "saving" && (
                        <button type="button" tabIndex={-1} title="Discard this draft (Delete)" onClick={() => removeDraft(d.key)}
                          className="rounded p-1.5 text-ink-soft hover:bg-[#fde8e6] hover:text-danger"><Trash2 size={15} /></button>
                      )}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            <div className="border-t border-chrome bg-[#fdfaea] px-3 py-1.5 text-xs text-[#5c5427]">
              <b>↑↓</b> move · <b>↵</b> open · <b>Del</b> discard · <b>Esc</b> close
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
