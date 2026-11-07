import { Component, useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { observer, useConnection } from "@vantage-ui/client/react";
import { AnimatePresence, motion } from "motion/react";
import { HelpCircle, Settings, WifiOff, X } from "lucide-react";
import { SearchButton } from "./SearchPalette";
import { DraftsButton } from "./DraftsPanel";
import { ActivityButton } from "./ActivityPanel";
import { Toaster } from "./toast";
import { useCompany } from "@/setup/CompanySettings";
import { MOD } from "@/editor/InvoiceEditor";
import { openAbout } from "./Splash";
import { ABOUT } from "@/about";

// The frame around every page: two-level section navigation, the universal places
// on the right of the top bar (search, activity, drafts, settings, shortcuts), a banner
// while the connection is down, and a guard so one page failing doesn't blank the app.

export const sections = [
  {
    key: "sales", label: "Sales", items: [
      { to: "/sales/invoices", label: "Invoices" },
      { to: "/sales/payments", label: "Payments received" },
      { to: "/sales/customers", label: "Customers" },
    ],
  },
  {
    key: "purchases", label: "Purchases", items: [
      { to: "/purchases/invoices", label: "Invoices" },
      { to: "/purchases/payments", label: "Payments made" },
      { to: "/purchases/suppliers", label: "Suppliers" },
    ],
  },
  {
    key: "accounts", label: "Accounts", items: [
      { to: "/accounts/misc", label: "Misc payments" },
      { to: "/accounts/banks", label: "Bank accounts" },
      { to: "/accounts/nominals", label: "Nominals" },
    ],
  },
  {
    key: "reports", label: "Reports", items: [
      { to: "/reports/pnl", label: "Profit and loss" },
      { to: "/reports/balance-sheet", label: "Balance sheet" },
      { to: "/reports/trial-balance", label: "Trial balance" },
      { to: "/reports/ledger", label: "Nominal ledger" },
      { to: "/reports/aged-debtors", label: "Aged debtors" },
      { to: "/reports/aged-creditors", label: "Aged creditors" },
    ],
  },
  {
    key: "setup", label: "Setup", items: [
      { to: "/setup/company", label: "Company" },
    ],
  },
];

const SHORTCUTS: [string, [string, string][]][] = [
  ["Anywhere", [[`${MOD}K`, "Search everything"], [`${MOD}J`, "Activity"], ["D", "Drafts"], ["?", "These shortcuts"], ["/", "Filter the list"]]],
  ["Lists", [["↑ ↓  J K", "Move"], ["PgUp PgDn Home End", "Jump"], ["Enter / Space", "Open or close the row"], ["N", "New record under the cursor"], ["Esc", "Close the open record"]]],
  ["Editing", [[`${MOD}↵`, "Save (and start the next new one)"], [`⇧${MOD}↵`, "Save and close"], ["Tab past the last line", "Add a line"], [`${MOD}⌫`, "Remove the line"], ["Alt+I / P / C", "Invoice / payment / credit page"]]],
  ["Nominals", [["Enter", "Rename"], ["A", "Add under"], ["M", "Move"], ["Del twice", "Delete"], ["L", "Ledger"]]],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/25 pt-[10vh]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div role="dialog" aria-label="Keyboard shortcuts" initial={{ y: -8 }} animate={{ y: 0 }}
        className="w-[44rem] rounded-lg border border-[#9fb3b0] bg-white p-5 text-ink shadow-2xl">
        <div className="mb-3 flex items-center">
          <h2 className="text-lg font-semibold text-brand">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-ink-soft hover:bg-chrome-light"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {SHORTCUTS.map(([group, keys]) => (
            <section key={group}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">{group}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {keys.map(([k, what]) => [
                  <dt key={k}><kbd className="rounded border border-chrome bg-chrome-light px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt>,
                  <dd key={k + "d"}>{what}</dd>,
                ])}
              </dl>
            </section>
          ))}
        </div>
        <div className="mt-4 border-t border-chrome pt-3 text-sm">
          <button type="button" onClick={() => { onClose(); openAbout(); }} className="font-medium text-accent hover:underline">
            About this demo
          </button>
          <span className="text-ink-soft"> · Demo built with VantageUI {ABOUT.vantageVersion}</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** A thin banner while the connection is down; the client reconnects by itself. */
function ConnectionBanner() {
  const { status } = useConnection();
  return (
    <AnimatePresence>
      {status === "closed" && (
        <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden" role="status">
          <div className="flex items-center gap-2 bg-[#fff3cd] px-4 py-1.5 text-sm text-[#5c4a00]">
            <WifiOff size={14} /> Connection lost: reconnecting… Your drafts are kept, and saves go out when it is back.
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** One page failing shows a message in its place, not a blank window. */
class PageGuard extends Component<{ children: ReactNode; path: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { path: string }) { if (prev.path !== this.props.path && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-16 max-w-lg rounded-md border border-[#e3b4b0] bg-[#fff4f3] p-5 text-ink" role="alert">
        <h2 className="mb-1 font-semibold text-danger">This page ran into a problem</h2>
        <p className="mb-3 text-sm text-ink-soft">Your drafts are safe. Reloading usually fixes it. ({this.state.error.message})</p>
        <button type="button" onClick={() => location.reload()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white">Reload</button>
      </div>
    );
  }
}

export const Shell = observer(({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const company = useCompany();
  const [help, setHelp] = useState(false);
  const active = sections.find((s) => pathname.startsWith(`/${s.key}`)) ?? sections[0]!;
  const page = active.items.find((it) => pathname.startsWith(it.to));

  useEffect(() => {
    document.title = `${page ? `${page.label} · ` : ""}${active.label} · ${company?.name ?? "Books"}`;
  }, [page, active, company?.name]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement;
      const inField = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
      if (e.key === "?" && !inField) { e.preventDefault(); setHelp((h) => !h); }
      else if (e.key === "Escape" && help) { e.preventDefault(); e.stopImmediatePropagation(); setHelp(false); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [help]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-1">Skip to content</a>
      <header className="bg-brand text-white shadow-sm">
        <div className="flex h-10 items-center gap-4 px-4">
          <div className="max-w-[16rem] truncate font-semibold tracking-tight" title={company?.name}>{company?.name ?? "Books"}</div>
          <nav className="flex h-full items-end gap-0.5" aria-label="Sections">
            {sections.map((s) => (
              <NavLink key={s.key} to={s.items[0]!.to}
                className={"rounded-t px-3 py-1.5 text-sm " + (s === active ? "bg-chrome-light text-ink" : "text-white/85 hover:bg-white/10 hover:text-white")}>
                {s.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <SearchButton />
            <ActivityButton />
            <DraftsButton />
            <button type="button" title="Settings" onClick={() => navigate("/setup/company")}
              className="flex h-7 items-center gap-1.5 rounded px-2 text-white/85 hover:bg-white/10 hover:text-white">
              <Settings size={15} /><span className="hidden text-xs xl:inline">Settings</span>
            </button>
            <button type="button" title="Keyboard shortcuts (?)" onClick={() => setHelp(true)}
              className="flex h-7 items-center gap-1.5 rounded px-2 text-white/85 hover:bg-white/10 hover:text-white">
              <HelpCircle size={15} /><span className="hidden text-xs xl:inline">Shortcuts</span>
            </button>
          </div>
        </div>
      </header>
      <nav className="flex h-9 items-center gap-1 border-b border-chrome bg-chrome-light px-3" aria-label={`${active.label} pages`}>
        {active.items.map((it) => (
          <NavLink key={it.to} to={it.to}
            className={({ isActive }) => "rounded px-2.5 py-1 text-sm " + (isActive ? "bg-white font-medium text-ink shadow-sm" : "text-ink-soft hover:bg-white/70")}>
            {it.label}
          </NavLink>
        ))}
      </nav>
      <ConnectionBanner />
      <main id="main" className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <PageGuard path={pathname}>{children}</PageGuard>
      </main>
      <AnimatePresence>{help && <Shortcuts onClose={() => setHelp(false)} />}</AnimatePresence>
      <Toaster />
    </div>
  );
});
