import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { observer, useCollection } from "@vantage-ui/client/react";
import { motion } from "motion/react";
import { ChevronRight, FolderInput, Pencil, Plus, Trash2 } from "lucide-react";
import { useDb } from "@/db";
import { fmtMoney } from "@/format";
import { Picker } from "@/editor/Picker";
import { runAction } from "@/shell/toast";

// The chart of accounts as a tree. Primary nominals carry the codes; sub-nominals live
// under them and can be added, renamed, moved within their primary nominal's tree, and
// deleted while nothing posts to them. The database enforces those rules
// (tests/schema.surql) and its message says why when it refuses.
//
// Keys: ↑↓ move · ←→ fold · Enter rename · A add under · M move · Delete (twice) delete ·
// L ledger. The whole chart is a few dozen rows, loaded at once.

type N = { id: string; code: string; name: string; path: string; parent: any; type: string; bp: string; rank: number | null; transactions: number | null };
type Flat = { n: N; depth: number; hasKids: boolean };

/** The parent's id, or null for a primary nominal (a reference reads as an object even when empty). */
export const parentId = (n: { parent: any }): string | null =>
  (typeof n.parent === "string" ? n.parent : n.parent?.id) || null;

export const NominalTree = observer(() => {
  const db = useDb() as any;
  const navigate = useNavigate();
  const all = useCollection(db.nominals.where({}).sort("code", "asc"));
  const tb = useCollection(db.trial_balance.where({}).sort("code", "asc"));
  const nodes = (all.items as N[]).filter(Boolean);
  const balance = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of (tb.items as any[]).filter(Boolean)) m.set(r.nominal_path, r.balance);
    return m;
  }, [tb.items]);

  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<{ id: string; mode: "rename" | "add" | "move" } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // depth-first, siblings by their order then name
  const flat: Flat[] = useMemo(() => {
    const kids = new Map<string | null, N[]>();
    for (const n of nodes) { const p = parentId(n); kids.set(p, [...(kids.get(p) ?? []), n]); }
    for (const list of kids.values()) list.sort((a, b) => (parentId(a) ?(a.rank ?? 0) - (b.rank ?? 0) || a.name.localeCompare(b.name) : a.code.localeCompare(b.code)));
    const out: Flat[] = [];
    const walk = (p: string | null, depth: number) => {
      for (const n of kids.get(p) ?? []) {
        const hasKids = (kids.get(n.id) ?? []).length > 0;
        out.push({ n, depth, hasKids });
        if (hasKids && !folded.has(n.id)) walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [nodes, folded]);

  const at = flat[Math.min(cursor, flat.length - 1)];
  useEffect(() => { if (!editing) listRef.current?.focus({ preventScroll: true }); }, [editing]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  useEffect(() => { if (armed) { const t = setTimeout(() => setArmed(null), 3500); return () => clearTimeout(t); } }, [armed]);

  const remove = async (n: N) => {
    if (armed !== n.id) { setArmed(n.id); return; }
    setArmed(null);
    await runAction(db, "delete_nominal", { id: n.id }, `Deleted ${n.path}`);
  };
  const toggle = (id: string) => setFolded((f) => { const g = new Set(f); if (g.has(id)) g.delete(id); else g.add(id); return g; });

  const onKey = (e: React.KeyboardEvent) => {
    if (editing || !at) return;
    const k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)); }
    else if (k === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (k === "ArrowLeft" && at.hasKids && !folded.has(at.n.id)) { e.preventDefault(); toggle(at.n.id); }
    else if (k === "ArrowRight" && at.hasKids && folded.has(at.n.id)) { e.preventDefault(); toggle(at.n.id); }
    else if (k === "Enter") { e.preventDefault(); setEditing({ id: at.n.id, mode: "rename" }); }
    else if (k === "a" || k === "Insert") { e.preventDefault(); setEditing({ id: at.n.id, mode: "add" }); }
    else if (k === "m" && parentId(at.n)) { e.preventDefault(); setEditing({ id: at.n.id, mode: "move" }); }
    else if (k === "Delete" || (k === "Backspace" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); void remove(at.n); }
    else if (k === "l") { e.preventDefault(); navigate(`/reports/ledger?nominal=${encodeURIComponent(at.n.code)}`); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-chrome px-3 py-2 text-xs text-ink-soft">
        <span>{nodes.length} nominals</span>
        <span className="ml-auto rounded border border-[#ece3b5] bg-[#fdfaea] px-2.5 py-1 text-[#5c5427]">
          <b>↑↓</b> move · <b>←→</b> fold · <b>↵</b> rename · <b>A</b> add under · <b>M</b> move · <b>Del</b>×2 delete · <b>L</b> ledger
        </span>
      </div>
      <div className="sticky top-0 z-10 flex border-b border-chrome bg-brand-dark px-3 text-xs font-medium text-white">
        <span className="w-20 py-1.5">Code</span><span className="flex-1 py-1.5">Nominal</span>
        <span className="w-40 py-1.5">Type</span><span className="w-12 py-1.5">B/P</span>
        <span className="w-28 py-1.5 text-right">Postings</span><span className="w-36 py-1.5 text-right">Balance</span>
        <span className="w-36" />
      </div>
      <div ref={listRef} tabIndex={0} role="tree" onKeyDown={onKey} className="min-h-0 flex-1 overflow-auto outline-none">
        {all.loadState !== "complete" && <p className="p-6 text-ink-soft">Loading the chart of accounts…</p>}
        {flat.map(({ n, depth, hasKids }, i) => {
          const sel = i === cursor;
          const ed = editing?.id === n.id ? editing.mode : null;
          const bal = balance.get(n.path);
          return (
            <div key={n.id}>
              <motion.div layout="position" data-i={i} role="treeitem" aria-selected={sel} aria-expanded={hasKids ? !folded.has(n.id) : undefined}
                onClick={() => setCursor(i)} onDoubleClick={() => setEditing({ id: n.id, mode: "rename" })}
                className={"group flex h-8 items-center border-b border-chrome-light px-3 text-sm " +
                  (sel ? "bg-highlight shadow-[inset_3px_0_0_var(--color-accent)] " : depth === 0 ? "bg-[#fafbfb] " : "bg-white ") +
                  (depth === 0 ? "font-semibold" : "")}>
                <span className="w-20 text-ink-soft">{depth === 0 || n.code !== flat.find((f) => f.n.id === parentId(n))?.n.code ? n.code : ""}</span>
                <span className="flex min-w-0 flex-1 items-center" style={{ paddingLeft: depth * 20 }}>
                  <button type="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); if (hasKids) toggle(n.id); }}
                    className={"mr-1 flex h-5 w-5 items-center justify-center text-muted " + (hasKids ? "" : "invisible")}>
                    <motion.span animate={{ rotate: folded.has(n.id) ? 0 : 90 }} transition={{ duration: 0.12 }}><ChevronRight size={14} /></motion.span>
                  </button>
                  {ed === "rename"
                    ? <InlineName initial={n.name} onCancel={() => setEditing(null)} onSave={async (name) => {
                        const ok = await runAction(db, "save_nominal", { id: n.id, name }, "Renamed");
                        if (ok) setEditing(null);
                      }} />
                    : <span className="truncate">{n.name}</span>}
                </span>
                <span className="w-40 truncate text-ink-soft">{depth === 0 ? n.type : ""}</span>
                <span className="w-12 text-ink-soft">{depth === 0 ? n.bp : ""}</span>
                <span className="num w-28 text-ink-soft">{n.transactions || ""}</span>
                <span className={"num w-36 " + (bal !== undefined && bal < 0 ? "text-danger" : "")}>{bal !== undefined ? fmtMoney(bal) : ""}</span>
                <span className="flex w-36 justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100">
                  <IconBtn title="Add a sub-nominal (A)" onClick={() => setEditing({ id: n.id, mode: "add" })}><Plus size={14} /></IconBtn>
                  <IconBtn title="Rename (Enter)" onClick={() => setEditing({ id: n.id, mode: "rename" })}><Pencil size={13} /></IconBtn>
                  {parentId(n) && <IconBtn title="Move (M)" onClick={() => setEditing({ id: n.id, mode: "move" })}><FolderInput size={14} /></IconBtn>}
                  {parentId(n) && (
                    <IconBtn title={armed === n.id ? "Click again to delete" : "Delete (Del twice)"} danger={armed === n.id} onClick={() => void remove(n)}>
                      <Trash2 size={13} />
                    </IconBtn>
                  )}
                </span>
              </motion.div>
              {ed === "add" && (
                <div className="flex h-9 items-center border-b border-chrome-light bg-highlight/50 px-3 text-sm" style={{ paddingLeft: 12 + 80 + (depth + 1) * 20 + 24 }}>
                  <InlineName initial="" placeholder={`New nominal under ${n.path}`} onCancel={() => setEditing(null)} onSave={async (name) => {
                    const ok = await runAction(db, "save_nominal", { parent: n.id, name }, `Added ${n.path}:${name}`);
                    if (ok) { setEditing(null); setFolded((f) => { const g = new Set(f); g.delete(n.id); return g; }); }
                  }} />
                </div>
              )}
              {ed === "move" && (
                <div className="flex h-10 items-center gap-2 border-b border-chrome-light bg-highlight/50 px-3 text-sm" style={{ paddingLeft: 12 + 80 + (depth + 1) * 20 }}
                  onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); } }}>
                  <span className="text-ink-soft">Move under</span>
                  <div className="w-96">
                    <Picker value="" placeholder={`A nominal in ${n.code}…`} autoFocus
                      collection={(t) => db.nominals.where(t ? { code: n.code, path: { like: t } } : { code: n.code }).sort("code", "asc")}
                      label={(r) => <span>{r.path}</span>}
                      pick={async (r) => {
                        const ok = await runAction(db, "save_nominal", { id: n.id, name: n.name, parent: r.id }, `Moved under ${r.path}`);
                        if (ok) setEditing(null);
                      }} />
                  </div>
                  <button type="button" onClick={() => setEditing(null)} className="text-ink-soft hover:text-ink">Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function IconBtn({ title, onClick, children, danger }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" tabIndex={-1} title={title} aria-label={title} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={"rounded p-1 " + (danger ? "bg-danger text-white" : "text-ink-soft hover:bg-white hover:text-ink")}>
      {children}
    </button>
  );
}

function InlineName({ initial, placeholder, onSave, onCancel }: {
  initial: string; placeholder?: string; onSave: (name: string) => Promise<void>; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <input className="field h-6 max-w-md" value={v} placeholder={placeholder} autoFocus disabled={busy}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => !busy && onCancel()}
      onKeyDown={async (e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        if (e.key === "Enter" && v.trim()) { e.preventDefault(); setBusy(true); await onSave(v.trim()); setBusy(false); }
      }} />
  );
}
