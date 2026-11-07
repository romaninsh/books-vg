import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { observer, useWindow } from "@vantage-ui/client/react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, ChevronRight, Search } from "lucide-react";
import { settleSaved } from "@/editor/store";

// A live list over one API entity: the server sorts, filters and pages; the page asks for
// the window around what is on screen. Rows open in place to show `detail`. Pages can put
// extra rows right under any row (`after`: new drafts and duplicates), keep more rows open
// (`expanded`: saves in progress), override cells (inline editing) and add per-row state
// classes (dirty, saving, saved, failed). Columns fill the page width; when it is too
// narrow, columns give way in their `drop` order instead of scrolling sideways.

export type Col = {
  key: string;            // column used for sorting; also the default cell value
  label: string;
  width: number;          // minimum width
  grow?: number;          // share of the spare width (text columns)
  drop?: number;          // hidden when space runs out, lowest first; absent: always shown
  align?: "right";
  sortable?: boolean;     // default true
  render?: (row: any) => ReactNode;
};

export type Chip = { key: string; label: string; where: Record<string, unknown> };

type Props = {
  title: string;
  actions?: ReactNode;                            // buttons at the start of the toolbar (New …)
  collection: (where: Record<string, unknown>, sort: { col: string; dir: "asc" | "desc" }) => any;
  cols: Col[];
  chips?: Chip[];
  defaultSort: { col: string; dir: "asc" | "desc" };
  noun: string;
  filterHint: string;
  textFilter: (text: string) => Record<string, unknown>;
  detail?: (row: any) => ReactNode;
  openKey?: string | null;                        // controlled open row
  onOpenKey?: (key: string | null) => void;
  expanded?: (row: any) => boolean;               // also shown open (e.g. while saving)
  topRows?: (loaded: Set<string>) => ReactNode;   // rows above the list; `loaded`: ids in the window
  after?: (row: any) => ReactNode;                // rows right under a list row (drafts anchored to it)
  onSelect?: (row: any | null) => void;           // the cursor row, for anchoring new rows
  cell?: (row: any, col: Col, isOpen: boolean) => ReactNode | undefined;
  rowClass?: (row: any) => string;
  ownChange?: (row: any) => boolean;              // a change this page made (not flagged as remote)
  pins?: Pin[];                                   // rows that stay in sight (drafts, unsaved work)
  onActivate?: (row: any) => void;                // Enter / click on a row without `detail` (go to it)
  footer?: ReactNode;                             // a line under the list (report totals)
};

/** A row that must not be lost from sight: scrolled out of view, a copy sticks to the top or
 *  bottom edge of the list. `key` is its row's `data-pin`; `anchor` the list row it sits
 *  under (or is), for when that part of the list isn't drawn. */
export type Pin = { key: string; anchor?: string; render: () => ReactNode };

export const ROW = 30;
const WINDOW = 200;

export const colStyle = (c: Col) => ({ flex: `${c.grow ?? 0} 0 ${c.width}px`, minWidth: c.width });

/** The columns that fit `width`: droppable ones go, lowest `drop` first, until the rest fit. */
export function fitCols(cols: Col[], width: number): Col[] {
  const gone = new Set<string>();
  let total = cols.reduce((a, c) => a + c.width, 0);
  for (const c of cols.filter((c) => c.drop !== undefined).sort((a, b) => a.drop! - b.drop!)) {
    if (total <= width) break;
    gone.add(c.key);
    total -= c.width;
  }
  return cols.filter((c) => !gone.has(c.key));
}

// The columns on show, for rows drawn inside the list (drafts) to line up with it.
const ShownCols = createContext<Col[] | null>(null);

/** One row's cells: shared by list rows and draft rows so columns line up. */
export function RowCells({ cols: allCols, row, cell, isOpen, withChevron, changed }: {
  cols: Col[]; row: any; cell?: Props["cell"]; isOpen: boolean; withChevron: boolean; changed?: boolean;
}) {
  const cols = useContext(ShownCols) ?? allCols;
  return (
    <>
      {withChevron && (
        <div className="relative flex w-6 shrink-0 items-center justify-center text-muted">
          {row && (
            <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
              <ChevronRight size={14} />
            </motion.span>
          )}
          {changed && (
            <span title="Changed by someone else (see Activity)"
              className="absolute left-0.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#e0a100]" />
          )}
        </div>
      )}
      {cols.map((c) => {
        const custom = row ? cell?.(row, c, isOpen) : undefined;
        return (
          <div
            key={c.key}
            role="gridcell"
            style={colStyle(c)}
            className={"flex items-center overflow-hidden whitespace-nowrap px-2 " + (c.align === "right" ? "num justify-end" : "")}
          >
            {custom !== undefined
              ? custom
              : row
                ? <span className="truncate">{c.render ? c.render(row) : row[c.key]}</span>
                : <span className="h-2.5 w-3/4 animate-pulse rounded bg-chrome-light" />}
          </div>
        );
      })}
    </>
  );
}

/** The opened area under a row: white, framed, high-contrast; animated open and closed. */
export function Expander({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="detail"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="overflow-hidden"
        >
          {/* stays within the visible width even when the columns scroll sideways */}
          <div
            style={{ position: "sticky", left: 8, width: "var(--list-w, calc(100% - 16px))" }}
            className="mb-3 mt-1 rounded-md border border-[#9fb3b0] border-l-4 border-l-accent bg-white text-ink shadow-md"
          >
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const DataList = observer((props: Props) => {
  const { chips = [], noun, filterHint, detail } = props;
  const [chip, setChip] = useState(chips[0]?.key ?? "");
  // `?q=` starts the list filtered (search opens a record this way, so its row is loaded)
  const [params] = useSearchParams();
  const [text, setText] = useState(() => params.get("q") ?? "");
  useEffect(() => { const q = params.get("q"); if (q !== null) setText(q); }, [params]);
  const [sort, setSort] = useState(props.defaultSort);
  const [selected, setSelected] = useState(0);
  const [ownOpen, setOwnOpen] = useState<string | null>(null);
  const openKey = props.openKey !== undefined ? props.openKey : ownOpen;
  const setOpenKey = props.onOpenKey ?? setOwnOpen;

  const where = useMemo(
    () => ({ ...(chips.find((c) => c.key === chip)?.where ?? {}), ...props.textFilter(text.trim()) }),
    [chip, text], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const collection = props.collection(where, sort);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Expanders follow the visible width of the list (--list-w), not the columns' width.
  const [listW, setListW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      el.style.setProperty("--list-w", `${el.clientWidth - 16}px`);
      setListW(el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = useMemo(
    () => (listW ? fitCols(props.cols, listW - (detail ? 24 : 0)) : props.cols),
    [props.cols, listW, !!detail], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [windowStart, setWindowStart] = useState(0);
  const page = useWindow(collection, windowStart, WINDOW);
  const count = page.lengthExact ? page.length : page.length + 50;

  // The list index the open record lives at: its own row, or the row a draft sits under.
  // That item is always drawn (however far it is scrolled), so it can dock (see `dock`).
  const openAt = (() => {
    if (!openKey) return -1;
    let i = page.items.findIndex((r: any) => r?.id === openKey);
    if (i < 0) {
      const anchor = (props.pins ?? []).find((p) => p.key === openKey)?.anchor;
      i = anchor ? page.items.findIndex((r: any) => r?.id === anchor) : -1;
    }
    return i < 0 ? -1 : i + windowStart;
  })();

  const virt = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 20,
    getItemKey: (i) => (page.items[i - windowStart] as any)?.id ?? `i${i}`,
    rangeExtractor: (range) => {
      const r = defaultRangeExtractor(range);
      return openAt >= 0 && openAt < count && !r.includes(openAt) ? [...r, openAt].sort((a, b) => a - b) : r;
    },
  });
  const visible = virt.getVirtualItems();
  const first = visible[0]?.index ?? 0;

  // Keep the server window around what is on screen; never past the rows we know of.
  useEffect(() => {
    let want = Math.max(0, Math.floor(first / (WINDOW / 2)) * (WINDOW / 2) - WINDOW / 4);
    want = Math.min(want, Math.max(0, page.length - WINDOW / 2));
    if (want !== windowStart) setWindowStart(want);
  }, [first, windowStart, page.length]);
  // A window that landed past the last row comes back empty: step back.
  useEffect(() => {
    if (page.settled && !page.error && windowStart > 0 && page.items.length === 0) {
      setWindowStart(Math.max(0, windowStart - WINDOW / 2));
    }
  }, [page.settled, page.error, page.items.length, windowStart]);

  // A new filter or sort starts at the top.
  useEffect(() => {
    setSelected(0);
    virt.scrollToIndex(0);
  }, [chip, text, sort.col, sort.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  // Changes from elsewhere: a loaded row whose values change while this page didn't cause
  // it gets an amber wash and a dot until opened. Rows arriving for the first time don't.
  const seen = useRef(new Map<string, string>());
  const [remote, setRemote] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let found: string[] = [];
    for (const r of page.items as any[]) {
      if (!r?.id) continue;
      const sig = JSON.stringify(props.cols.map((c) => r[c.key] ?? null));
      const prev = seen.current.get(r.id);
      if (prev !== undefined && prev !== sig && !props.ownChange?.(r)) found.push(r.id);
      // the server's copy has arrived: a saved draft showing it can step aside
      if (prev === undefined || prev !== sig) settleSaved(r, prev !== undefined);
      seen.current.set(r.id, sig);
    }
    if (found.length) setRemote((s) => new Set([...s, ...found]));
  });
  const clearRemote = (id: string) => remote.has(id) && setRemote((s) => { const n = new Set(s); n.delete(id); return n; });

  const rowAt = (i: number) => page.items[i - windowStart] as any;
  const selectedRow = rowAt(selected);
  useEffect(() => { props.onSelect?.(selectedRow ?? null); }, [selectedRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing a row gives the keyboard back to the list (the focused field just went away).
  const prevOpen = useRef(openKey);
  useEffect(() => {
    const was = prevOpen.current;
    prevOpen.current = openKey;
    if (was && !openKey) {
      const a = document.activeElement;
      if (!a || a === document.body || scrollRef.current?.contains(a) || !a.isConnected) {
        scrollRef.current?.focus({ preventScroll: true });
      }
    }
  }, [openKey]);
  useEffect(() => {
    const onFocusLost = () => setTimeout(() => {
      if (document.activeElement === document.body && prevOpen.current === null) scrollRef.current?.focus({ preventScroll: true });
    }, 0);
    document.addEventListener("focusout", onFocusLost);
    return () => document.removeEventListener("focusout", onFocusLost);
  }, []);

  const filterRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(document.activeElement instanceof HTMLInputElement)) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const move = (to: number) => {
    const n = Math.max(0, Math.min(count - 1, to));
    setSelected(n);
    virt.scrollToIndex(n, { align: "auto" });
  };
  const toggleOpen = (i: number) => {
    const id = rowAt(i)?.id;
    if (!detail && id && props.onActivate) { setSelected(i); props.onActivate(rowAt(i)); return; }
    if (!detail || !id) return;
    clearRemote(id);
    setSelected(i);
    setOpenKey(openKey === id ? null : id);
  };
  const toggleSort = (c: Col) => {
    if (c.sortable === false) return;
    setSort((s) => (s.col === c.key ? { col: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { col: c.key, dir: "asc" }));
  };

  const minWidth = cols.reduce((a, c) => a + c.width, 0) + (detail ? 24 : 0);

  // Which pinned rows are out of sight, and on which side.
  const [away, setAway] = useState<Record<string, "top" | "bottom">>({});
  const findPin = (key: string) => scrollRef.current?.querySelector<HTMLElement>(`[data-pin="${CSS.escape(key)}"]`);
  const anchorIndex = (anchor?: string) => {
    const i = anchor ? page.items.findIndex((r: any) => r?.id === anchor) : -1;
    return i < 0 ? -1 : i + windowStart;
  };
  // Pins keep the order they have in the list (rows above first, a row before the drafts
  // under it). The open record isn't one: it docks whole (below).
  const pins: Pin[] = (props.pins ?? [])
    .filter((p) => p.key !== openKey)
    .map((p, i) => ({ p, i, at: anchorIndex(p.anchor), self: p.key === p.anchor ? 0 : 1 }))
    .sort((a, b) => a.at - b.at || a.self - b.self || a.i - b.i)
    .map((x) => x.p);

  // The open record (its row and editor, marked `data-dock`) never leaves the screen: when it
  // would scroll off the top it stays under the header and pins, when it is below the screen
  // it waits at the bottom edge, floating over the rows until its own place comes back.
  // Done on the element directly, on every scroll, without re-rendering the list.
  const dock = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    for (const el of sc.querySelectorAll<HTMLElement>("[data-dock].docked")) {
      if (el.dataset.dock !== openKey) { el.style.transform = ""; el.classList.remove("docked"); }
    }
    const el = openKey ? sc.querySelector<HTMLElement>(`[data-dock="${CSS.escape(openKey)}"]`) : null;
    if (!el) return;
    const box = sc.getBoundingClientRect();
    const topPins = Object.values(away).filter((s) => s === "top").length;
    const bottomPins = Object.values(away).filter((s) => s === "bottom").length;
    const topLimit = box.top + ROW - 2 + topPins * ROW;
    const bottomLimit = box.top + sc.clientHeight - bottomPins * ROW;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    let dy = 0;
    if (r.top < topLimit) dy = Math.min(topLimit - r.top, Math.max(0, bottomLimit - r.bottom)); // a tall one shows its end
    else if (r.top > bottomLimit - ROW) dy = Math.max(bottomLimit - r.bottom, topLimit - r.top);
    if (Math.abs(dy) > 0.5) { el.style.transform = `translateY(${dy}px)`; el.classList.add("docked"); }
    else el.classList.remove("docked");
  };
  useEffect(dock);
  const measurePins = () => {
    const box = scrollRef.current?.getBoundingClientRect();
    if (!box) return;
    const next: Record<string, "top" | "bottom"> = {};
    for (const p of pins) {
      const el = findPin(p.key);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.bottom <= box.top + ROW + 2) next[p.key] = "top";
        else if (r.top >= box.bottom - 2) next[p.key] = "bottom";
      } else {
        const i = anchorIndex(p.anchor);
        if (i >= 0) next[p.key] = i < first ? "top" : "bottom";
      }
    }
    setAway((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  };
  useEffect(measurePins);
  const jumpTo = (p: Pin) => {
    const el = findPin(p.key);
    if (el) el.scrollIntoView({ block: "center" });
    else {
      const i = anchorIndex(p.anchor);
      if (i >= 0) virt.scrollToIndex(i, { align: "center" });
    }
    setOpenKey(p.key);
  };
  const pinStrip = (side: "top" | "bottom") => {
    const list = pins.filter((p) => away[p.key] === side);
    if (!list.length) return null;
    // a zero-height sticky holder: the strip floats over the rows without moving them
    return (
      <div className={"sticky z-10 h-0 " + (side === "top" ? "top-7" : "bottom-0")}>
        <div className={"absolute left-0 w-full shadow-[0_0_10px_rgba(0,0,0,0.18)] " + (side === "top" ? "top-0" : "bottom-0")}>
          {list.map((p) => (
            <div key={p.key} role="row" title="Click to go back to it"
              onClick={() => jumpTo(p)} className="flex cursor-pointer border-b border-chrome bg-[#f4fffe] hover:bg-highlight"
              style={{ height: ROW }}>
              {p.render()}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b border-chrome px-3 py-2">
        {/* the page's name is already on its tab; screen readers still get it */}
        <h1 className="sr-only">{props.title}</h1>
        {props.actions}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-soft" aria-live="polite">
            {page.error ? <span className="text-danger">{page.error}</span>
              : page.lengthExact ? `${page.length} ${noun}` : `${page.length}+ ${noun}`}
          </span>
          {chips.length > 0 && (
            <div className="flex rounded-md border border-chrome bg-chrome-light p-0.5">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setChip(c.key)}
                  className={
                    "rounded px-2.5 py-0.5 text-xs " +
                    (chip === c.key ? "bg-white font-medium text-ink shadow-sm" : "text-ink-soft hover:text-ink")
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <label className="flex h-7 w-72 items-center gap-1.5 rounded-md border border-chrome px-2 focus-within:border-accent">
            <Search size={14} className="text-ink-soft" />
            <input
              ref={filterRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); setText(""); scrollRef.current?.focus(); }
                if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); scrollRef.current?.focus(); }
              }}
              placeholder={`${filterHint}   ( / )`}
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink-soft/70"
            />
          </label>
        </div>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        role="grid"
        aria-rowcount={page.lengthExact ? page.length : -1}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return; // keys typed in editors stay there
          const k = e.key;
          if (k === "ArrowDown" || k === "j") { e.preventDefault(); move(selected + 1); }
          else if (k === "ArrowUp" || k === "k") { e.preventDefault(); move(selected - 1); }
          else if (k === "PageDown") { e.preventDefault(); move(selected + 20); }
          else if (k === "PageUp") { e.preventDefault(); move(selected - 20); }
          else if (k === "Home") { e.preventDefault(); move(0); }
          else if (k === "End" && page.lengthExact) { e.preventDefault(); move(page.length - 1); }
          else if (k === "Enter" || k === " ") { e.preventDefault(); toggleOpen(selected); }
          else if (k === "Escape" && openKey) { e.preventDefault(); setOpenKey(null); }
        }}
        onScroll={() => { measurePins(); dock(); }}
        className="relative min-h-0 flex-1 overflow-auto outline-none"
      >
        <ShownCols.Provider value={cols}>
        <div style={{ minWidth }}>
          <div role="row" className="sticky top-0 z-20 flex border-b border-chrome bg-brand-dark text-xs text-white">
            {detail && <div className="w-6 shrink-0" />}
            {cols.map((c) => (
              <button
                key={c.key}
                type="button"
                tabIndex={-1}
                role="columnheader"
                aria-sort={sort.col === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                onClick={() => toggleSort(c)}
                style={colStyle(c)}
                className={
                  "flex h-7 items-center gap-1 px-2 font-medium " +
                  (c.sortable === false ? "cursor-default " : "hover:bg-white/10 ") +
                  (c.align === "right" ? "justify-end" : "")
                }
              >
                {c.label}
                {sort.col === c.key && (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
              </button>
            ))}
          </div>
          {pinStrip("top")}
          {props.topRows?.(new Set(page.items.map((r: any) => r?.id).filter(Boolean)))}
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {visible.map((v) => {
              const row = rowAt(v.index);
              const isSel = v.index === selected;
              const isOpen = !!row && (row.id === openKey || !!props.expanded?.(row));
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virt.measureElement}
                  className="absolute left-0 w-full"
                  // the open record floats over its neighbours when it docks
                  style={{ transform: `translateY(${v.start}px)`, zIndex: v.index === openAt ? 6 : undefined }}
                >
                  <div data-dock={row && row.id === openKey ? row.id : undefined}>
                  <div
                    role="row"
                    data-pin={row?.id}
                    aria-selected={isSel}
                    aria-expanded={detail ? isOpen : undefined}
                    onClick={() => (isSel || !detail ? toggleOpen(v.index) : setSelected(v.index))}
                    className={
                      "relative flex cursor-default border-b border-chrome-light " +
                      (isOpen ? "bg-highlight font-medium" : isSel ? "bg-highlight" : v.index % 2 ? "bg-white" : "bg-[#fafbfb]") +
                      (isSel ? " shadow-[inset_3px_0_0_var(--color-accent)]" : "") +
                      " hover:bg-highlight/60 " + (row ? props.rowClass?.(row) ?? "" : "") +
                      (row && remote.has(row.id) ? " row-remote" : "")
                    }
                    style={{ height: ROW }}
                  >
                    <RowCells cols={cols} row={row} cell={props.cell} isOpen={isOpen} withChevron={!!detail}
                      changed={!!row && remote.has(row.id)} />
                  </div>
                  {detail && <Expander open={isOpen}>{isOpen && detail(row)}</Expander>}
                  </div>
                  {row && props.after?.(row)}
                </div>
              );
            })}
          </div>
          {pinStrip("bottom")}
        </div>
        </ShownCols.Provider>
        {page.settled && page.lengthExact && page.length === 0 && (
          <p className="p-6 text-center text-ink-soft">No {noun} match.</p>
        )}
      </div>
      {props.footer && <div className="border-t-2 border-brand bg-chrome-light">{props.footer}</div>}
    </div>
  );
});
