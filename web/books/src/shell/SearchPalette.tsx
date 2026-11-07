import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Command } from "cmdk";
import { observer, useWindow } from "@vantage-ui/client/react";
import { AnimatePresence, motion } from "motion/react";
import { Banknote, BookOpen, Building2, Command as CommandIcon, FileText, Search, User } from "lucide-react";
import { useDb } from "@/db";
import { fmtDate, fmtMoney } from "@/format";
import { toSegment } from "@/editor/routes";
import { sections } from "./Shell";

// Search everything (⌘K): invoices by number or customer, payments, customers, suppliers,
// nominals and pages. The server matches; each group shows its first few. Enter opens the
// record on its list, filtered so its row is loaded (`?q=`).

const PER_GROUP = 6;

type Hit = { key: string; icon: ReactNode; title: ReactNode; meta?: ReactNode; go: string };

/** The first few matches of one query. With nothing to search it asks for a value no row
 *  has (on `idle`, a column the entity filters by), as hooks can't be skipped. */
function useHits(entity: any, where: Record<string, unknown> | null, sort: string, map: (r: any) => Hit, idle: string) {
  const dir = sort === "doc.date" ? "desc" : "asc";
  const page = useWindow(entity.where(where ?? { [idle]: "\u0001" }).sort(sort, dir), 0, PER_GROUP);
  return where ? (page.items as any[]).filter(Boolean).map(map) : [];
}

const Results = observer(({ text, onGo }: { text: string; onGo: (to: string) => void }) => {
  const db = useDb() as any;
  const t = text.trim();
  const byNumber = t.startsWith("#") ? t.slice(1) : null;
  const q = byNumber ?? t;
  const on = q.length >= 2 ? q : null;
  const num = on ? { number: { like: on } } : null;

  const invoice = (list: string, label: string) => (r: any): Hit => ({
    key: r.id, icon: <FileText size={15} />,
    title: <>{label} <b>{r.number || "—"}</b> · {r["contact.name"]}</>,
    meta: <>{fmtDate(r["doc.date"])} · {fmtMoney(r.gross)}</>,
    go: `${list}/${toSegment(r.id)}?q=${encodeURIComponent(r.number ? `#${r.number}` : r["contact.name"] ?? "")}`,
  });
  const sales = [
    ...useHits(db.sales_invoices, num, "doc.date", invoice("/sales/invoices", "Sales invoice"), "number"),
    ...useHits(db.sales_invoices, on && !byNumber ? { "contact.name": { like: on } } : null, "doc.date", invoice("/sales/invoices", "Sales invoice"), "number"),
  ];
  const purchases = [
    ...useHits(db.purchase_invoices, num, "doc.date", invoice("/purchases/invoices", "Purchase invoice"), "number"),
    ...useHits(db.purchase_invoices, on && !byNumber ? { "contact.name": { like: on } } : null, "doc.date", invoice("/purchases/invoices", "Purchase invoice"), "number"),
  ];
  const payment = (list: string, label: string) => (r: any): Hit => ({
    key: r.id, icon: <Banknote size={15} />,
    title: <>{label} · {r["contact.name"]}</>,
    meta: <>{fmtDate(r["doc.date"])} · {fmtMoney(r["doc.total"])}{r["doc.reference"] ? ` · ${r["doc.reference"]}` : ""}</>,
    go: `${list}/${toSegment(r.id)}?q=${encodeURIComponent(r["contact.name"] ?? "")}`,
  });
  const payments = [
    ...useHits(db.lodgements, on && !byNumber ? { "contact.name": { like: on } } : null, "doc.date", payment("/sales/payments", "Received"), "contact.name"),
    ...useHits(db.supplier_payments, on && !byNumber ? { "contact.name": { like: on } } : null, "doc.date", payment("/purchases/payments", "Paid"), "contact.name"),
  ];
  const contact = (list: string, label: string) => (r: any): Hit => ({
    key: r.id, icon: <User size={15} />, title: <>{r.name}</>,
    meta: <>{label}{r.outstanding ? ` · outstanding ${fmtMoney(r.outstanding)}` : ""}</>,
    go: `${list}/${toSegment(r.id)}?q=${encodeURIComponent(r.name ?? "")}`,
  });
  const contacts = [
    ...useHits(db.customers, on && !byNumber ? { name: { like: on } } : null, "name", contact("/sales/customers", "Customer"), "name"),
    ...useHits(db.suppliers, on && !byNumber ? { name: { like: on } } : null, "name", contact("/purchases/suppliers", "Supplier"), "name"),
  ];
  const nominals = useHits(db.nominals, on && !byNumber ? { path: { like: on } } : null, "code", (r) => ({
    key: r.id, icon: <BookOpen size={15} />, title: <>{r.code} · {r.path}</>, meta: "Nominal ledger",
    go: `/reports/ledger?nominal=${encodeURIComponent(r.code)}`,
  }), "path");
  const pages: Hit[] = sections.flatMap((s) => s.items.map((it) => ({
    key: it.to, icon: <Building2 size={15} />, title: `${s.label} → ${it.label}`, go: it.to,
  }))).filter((p) => !t || String(p.title).toLowerCase().includes(t.toLowerCase()));

  const dedupe = (hits: Hit[]) => hits.filter((h, i) => hits.findIndex((x) => x.key === h.key) === i);
  const groups: [string, Hit[]][] = [
    ["Sales invoices", dedupe(sales)], ["Purchase invoices", dedupe(purchases)], ["Payments", payments],
    ["Customers and suppliers", contacts], ["Nominals", nominals], ["Pages", pages.slice(0, t ? 6 : 12)],
  ];
  const any = groups.some(([, h]) => h.length);
  return (
    <Command.List className="max-h-[60vh] overflow-auto p-1.5">
      {!any && <div className="px-3 py-6 text-center text-sm text-ink-soft">{on ? "Nothing matches." : "Type at least two letters, or #number."}</div>}
      {groups.map(([name, hits]) => hits.length > 0 && (
        <Command.Group key={name} heading={name}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-soft">
          {hits.map((h) => (
            <Command.Item key={h.key} value={h.key} onSelect={() => onGo(h.go)}
              className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm data-[selected=true]:bg-highlight">
              <span className="text-ink-soft">{h.icon}</span>
              <span className="min-w-0 flex-1 truncate">{h.title}</span>
              {h.meta && <span className="shrink-0 text-xs text-ink-soft">{h.meta}</span>}
            </Command.Item>
          ))}
        </Command.Group>
      ))}
    </Command.List>
  );
});

export function SearchButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const go = (to: string) => { setOpen(false); setText(""); navigate(to); };

  return (
    <>
      <button type="button" title="Search everything (⌘K)" onClick={() => setOpen(true)}
        className="flex h-7 items-center gap-1.5 rounded px-2 text-white/85 hover:bg-white/10 hover:text-white">
        <CommandIcon size={15} /><span className="hidden text-xs xl:inline">Search</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/25 pt-[12vh]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
            <motion.div initial={{ y: -8, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -8, scale: 0.98 }}
              className="w-[42rem] overflow-hidden rounded-lg border border-[#9fb3b0] bg-white text-ink shadow-2xl">
              <Command shouldFilter={false} label="Search" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
                <div className="flex items-center gap-2 border-b border-chrome px-3">
                  <Search size={16} className="text-ink-soft" />
                  <Command.Input autoFocus value={text} onValueChange={setText}
                    placeholder="Search invoices, payments, customers, nominals, pages…   #54 for an invoice number"
                    className="h-11 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-soft/70 focus-visible:outline-none" />
                </div>
                <Results text={text} onGo={go} />
                <div className="border-t border-chrome bg-[#fdfaea] px-3 py-1.5 text-xs text-[#5c5427]">
                  <b>↑↓</b> move · <b>↵</b> open · <b>Esc</b> close
                </div>
              </Command>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
