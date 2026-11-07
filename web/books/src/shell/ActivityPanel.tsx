import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { observer, useWindow } from "@vantage-ui/client/react";
import { AnimatePresence, motion } from "motion/react";
import { Activity as ActivityIcon } from "lucide-react";
import { useDb } from "@/db";
import { fmtDate, fmtMoney } from "@/format";
import { isOwnDoc, useDrafts } from "@/editor/store";
import { toSegment } from "@/editor/routes";
import { ScopeToggle, useScope } from "./Scope";

// Activity: what changed in the books, newest first, from the audit log (application.yaml
// log_changes / log_events). One entry per run: a saved invoice is its document, invoice
// row and lines together. The badge counts changes made elsewhere since the panel was last
// looked at.

type Entry = {
  id: string; logged_at: string | null; who: string | null; action: string | null; table: string | null;
  record: string | null; group: string | null; before: string | null; after: string | null;
  doc: string | null; contact: string | null;
};
type Group = { key: string; at: string; who: string; doc: string | null; contact: string | null; entries: Entry[] };

const SEEN_KEY = "books.activity.seen";
const plainId = (id: string | null) => (id ? id.replace(/`/g, "") : null);

const json = (s: string | null): Record<string, any> => {
  try { return s ? JSON.parse(s) ?? {} : {}; } catch { return {}; }
};

function groupEntries(rows: readonly (Entry | undefined)[]): Group[] {
  const out: Group[] = [];
  const byKey = new Map<string, Group>();
  for (const e of rows) {
    if (!e) continue;
    const key = e.group ?? e.id;
    let g = byKey.get(key);
    if (!g) {
      g = { key, at: e.logged_at ?? "", who: e.who ?? "", doc: null, contact: null, entries: [] };
      byKey.set(key, g);
      out.push(g);
    }
    g.entries.push(e);
    g.doc ??= plainId(e.doc);
    g.contact ??= e.contact;
  }
  return out;
}

const docLabel: Record<string, string> = {
  sale: "Sales invoice", purchase: "Purchase invoice", misc_payment: "Misc payment",
  misc_lodgement: "Misc lodgement", lodgement: "Payment received", payment: "Payment made",
};
// The page each kind of change belongs to ("This page" in the panel).
const pageOfType: Record<string, string> = {
  sale: "/sales/invoices", purchase: "/purchases/invoices", lodgement: "/sales/payments", payment: "/purchases/payments",
  misc_payment: "/accounts/misc", misc_lodgement: "/accounts/misc",
};
const verb: Record<string, string> = { new: "added", edit: "changed", delete: "deleted" };
const fieldLabel: Record<string, string> = {
  date: "date", due_date: "due", number: "number", reference: "reference", contact: "customer",
  description: "description", contact_name: "name",
};
const showValue = (k: string, v: unknown) =>
  v === null || v === undefined || v === "" ? "—"
    : /date/.test(k) && typeof v === "string" ? fmtDate(v)
    : typeof v === "number" ? fmtMoney(v) : String(v).replace(/^\w+:/, "");

/** "Sales invoice #54 changed", plus what changed in it. */
function describe(g: Group): { title: string; details: string[]; kind?: string; pages: string[] } {
  const d = describeOnly(g);
  const c = g.entries.find((e) => e.table === "contact");
  const ctype = c ? { ...json(c.before), ...json(c.after) }.type : undefined;
  const pages = d.kind ? [pageOfType[d.kind] ?? ""]
    : c ? (ctype === "supplier" ? ["/purchases/suppliers"] : ctype === "client" ? ["/sales/customers"] : ["/sales/customers", "/purchases/suppliers"])
    : [];
  return { ...d, pages };
}

function describeOnly(g: Group): { title: string; details: string[]; kind?: string } {
  const by = (t: string) => g.entries.filter((e) => e.table === t);
  const docE = by("doc")[0];
  const invE = by("invoice")[0];
  const lines = by("invoice_line");
  const head = docE ?? invE;
  const type = docE ? json(docE.after).type ?? json(docE.before).type : undefined;
  const number = invE ? json(invE.after).number ?? json(invE.before).number : undefined;
  const details: string[] = [];

  if (head) {
    const what = (type && docLabel[type]) || "Invoice";
    const v = head.action === "new" || head.action === "delete" ? verb[head.action] : "changed";
    if (head.action === "edit" || !head.action) {
      for (const e of [docE, invE]) {
        if (e?.action !== "edit") continue;
        const b = json(e.before), a = json(e.after);
        for (const k of Object.keys(a)) {
          if (k === "id" || k === "doc") continue;
          details.push(`${fieldLabel[k] ?? k} ${showValue(k, b[k])} → ${showValue(k, a[k])}`);
        }
      }
    }
    if (lines.length && head.action !== "new" && head.action !== "delete") {
      const n = (act: string) => lines.filter((l) => l.action === act).length;
      const parts = [n("new") && `${n("new")} added`, n("edit") && `${n("edit")} changed`, n("delete") && `${n("delete")} removed`].filter(Boolean);
      details.push(`lines: ${parts.join(", ")}`);
    }
    return { title: `${what}${number ? ` #${number}` : ""} ${v}`, details, kind: type };
  }
  if (lines.length) return { title: `Invoice lines changed (${lines.length})`, details };
  const contactE = by("contact")[0];
  if (contactE) {
    const c = { ...json(contactE.before), ...json(contactE.after) };
    const who = c.type === "supplier" ? "Supplier" : "Customer";
    return { title: `${who} ${c.name ?? ""} ${verb[contactE.action ?? ""] ?? "changed"}`.replace(/\s+/g, " "), details };
  }
  const first = g.entries[0]!;
  if (first.table) return { title: `${first.table.replace(/_/g, " ")} ${verb[first.action ?? ""] ?? first.action}`, details };
  return { title: `Ran ${(first.action ?? "action").replace(/[-_]/g, " ")}`, details };
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(iso);
}

const ContactName = observer(({ id }: { id: string }) => {
  const db = useDb() as any;
  const c = db.customers.ref(id).value ?? db.suppliers.ref(id).value;
  return <>{c?.name ?? ""}</>;
});

export const ActivityButton = observer(() => {
  useDrafts(); // own saves land through the draft store
  const db = useDb() as any;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => localStorage.getItem(SEEN_KEY) ?? new Date().toISOString());
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The API re-reads the log every few seconds (api/books.yaml `refresh:`) and pushes new rows.
  const page = useWindow(db.activity.sort("logged_at", "desc"), 0, 150);
  const groups = groupEntries(page.items as any);
  const fresh = groups.filter((g) => g.at > seen && !isOwnDoc(g.doc));

  // A change from elsewhere arriving makes the button glow, like the row it touched.
  const newest = groups.find((g) => !isOwnDoc(g.doc))?.key;
  const [flash, setFlash] = useState(0);
  const lastNewest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastNewest.current !== undefined && newest !== lastNewest.current && fresh.length > 0) setFlash((n) => n + 1);
    if (newest !== undefined) lastNewest.current = newest;
  }, [newest]); // eslint-disable-line react-hooks/exhaustive-deps

  const markSeen = () => {
    const now = groups[0]?.at ?? new Date().toISOString();
    localStorage.setItem(SEEN_KEY, now);
    setSeen(now);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "j" && (e.metaKey || e.ctrlKey)) {
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
  // Closing the panel marks what was shown as seen; opening puts the keyboard on the list.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) setTimeout(() => panelRef.current?.querySelector<HTMLElement>("[data-entry]")?.focus(), 0);
    else if (wasOpen.current) markSeen();
    wasOpen.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Opens the record a change belongs to on its list, filtered so its row is loaded. */
  const openDoc = async (doc: string) => {
    const ids = [doc, doc.replace(/^doc:(.*)$/, "doc:`$1`")];
    const lists = [
      ["sales_invoices", "/sales/invoices"], ["purchase_invoices", "/purchases/invoices"],
      ["lodgements", "/sales/payments"], ["supplier_payments", "/purchases/payments"], ["misc", "/accounts/misc"],
    ] as const;
    for (const [entity, path] of lists) {
      const rows = db[entity].where({ doc: ids });
      await rows.load();
      const row = rows.map((r: any) => r)[0];
      if (row?.id) {
        const q = row.number ? `#${row.number}` : row["contact.name"] ?? row["doc.contact_name"] ?? "";
        setOpen(false);
        navigate(`${path}/${toSegment(row.id)}?q=${encodeURIComponent(q)}`);
        return;
      }
    }
  };
  const openContact = (id: string, pages: string[]) => {
    setOpen(false);
    navigate(`${pages[0] ?? "/sales/customers"}/${toSegment(id)}`);
  };
  const { scope, setScope, shows } = useScope("activity");
  const shown = groups.map((g) => ({ g, d: describe(g) })).filter(({ d }) => scope === "all" || d.pages.some((p) => shows(p)));
  const moveFocus = (dir: 1 | -1) => {
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-entry]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[Math.max(0, Math.min(items.length - 1, i + dir))]?.focus();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        title="Activity: recent changes (⌘J)"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={"relative flex h-7 items-center gap-1.5 rounded px-2 hover:bg-white/10 hover:text-white " + (open ? "bg-white/15 text-white" : "text-white/85")}
      >
        {flash > 0 && <span key={flash} aria-hidden className="activity-flash pointer-events-none absolute inset-0 rounded" />}
        <ActivityIcon size={15} />
        <span className="hidden text-xs xl:inline">Activity</span>
        {fresh.length > 0 && (
          <motion.span key={fresh.length} initial={{ scale: 0.6 }} animate={{ scale: 1 }}
            className="min-w-[18px] rounded-full bg-[#ffd666] px-1 text-center text-[11px] font-semibold leading-[18px] text-ink">
            {fresh.length}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-label="Activity"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
              if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
            }}
            className="absolute right-0 top-9 z-50 w-[32rem] overflow-hidden rounded-md border border-[#9fb3b0] bg-white text-ink shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-chrome bg-chrome-light px-3 py-2 text-xs text-ink-soft">
              <span className="font-semibold text-ink">Activity</span>
              <span className="ml-3 mr-auto">{page.error ? <span className="text-danger">{page.error}</span> : "newest first"}</span>
              <ScopeToggle scope={scope} setScope={setScope} />
            </div>
            {shown.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-ink-soft">
                {!page.settled ? "Loading…" : groups.length ? "No changes on this page yet." : "No changes recorded yet."}
              </p>
            )}
            <ul className="max-h-[65vh] overflow-auto">
              <AnimatePresence initial={false}>
                {shown.map(({ g, d }) => {
                  const isNew = g.at > seen && !isOwnDoc(g.doc);
                  const contactOnly = !g.doc && g.contact;
                  return (
                    <motion.li key={g.key} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                      className="border-b border-chrome-light last:border-b-0">
                      <button
                        type="button"
                        data-entry
                        disabled={!g.doc && !contactOnly}
                        onClick={() => (g.doc ? void openDoc(g.doc) : contactOnly && openContact(g.contact!, d.pages))}
                        className="flex w-full gap-2 px-3 py-2 text-left outline-none hover:bg-highlight focus:bg-highlight disabled:cursor-default"
                      >
                        <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (isNew ? "bg-[#e0a100]" : "bg-transparent")} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-baseline gap-2 text-sm">
                            <span className="truncate font-medium">{d.title}</span>
                            {g.contact && <span className="truncate text-ink-soft"><ContactName id={g.contact} /></span>}
                            <span className="ml-auto shrink-0 text-xs text-ink-soft" title={g.at}>{ago(g.at)}</span>
                          </span>
                          {d.details.length > 0 && <span className="truncate text-xs text-ink-soft">{d.details.join(" · ")}</span>}
                          <span className="text-xs text-muted">by {g.who || "someone"}</span>
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            <div className="border-t border-chrome bg-[#fdfaea] px-3 py-1.5 text-xs text-[#5c5427]">
              <b>↑↓</b> move · <b>↵</b> open the invoice · <b>Esc</b> close
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
