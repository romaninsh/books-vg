import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, X } from "lucide-react";
import { ABOUT } from "@/about";
import { track, trackOutbound } from "@/analytics";
import { COMPARISON } from "./comparison";

// `code` in a comparison line renders as code
const withCode = (text: string) =>
  text.split("`").map((part, i) => (i % 2
    ? <code key={i} className="rounded px-1 py-px font-mono text-[0.85em]" style={{ background: "rgba(255,255,255,0.06)" }}>{part}</code>
    : part));

// The first thing a browser session sees: what this app is, that it was built as a demo for
// Vantage UI, and how it was made, in measured numbers (src/about.ts). Once per session
// (sessionStorage); "About this demo" in the shortcuts overlay opens it again.
//
// Vantage's own look, from vantage-ui.com (vantage-web2/css/main.css): near-black background,
// raised surfaces, indigo accents, a monospace kicker, the logo (public/vantage-logo.svg,
// drawn black, inverted on dark).

const V = {
  bg: "#0b0b10", surface1: "#12131c", surface2: "#181a26",
  text1: "#ecedf2", text2: "#a0a3b5", text3: "#6e7186",
  accent300: "#a5b4fc", accent400: "#818cf8", accent500: "#6366f1", accent600: "#4f46e5",
};

const SEEN = "books.splash.seen";

// About has its own address, /about, so a refresh reopens it. Opening it from the app pushes
// /about onto the history without telling the router, so the page underneath stays as it was;
// closing goes back to it. Landing on /about directly (a refresh, a link) shows it over the
// default page (main.tsx routes /about there); closing then goes to the sales invoices.
const ABOUT_PATH = "/about";
const atAbout = () => window.location.pathname === ABOUT_PATH;
export const openAbout = () => {
  if (!atAbout()) window.history.pushState({ books_about: true }, "", ABOUT_PATH);
  window.dispatchEvent(new Event("books:about"));
};
function leaveAbout() {
  if (!atAbout()) return;
  if (window.history.state?.books_about) { window.history.back(); return; }
  window.history.replaceState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate")); // the router follows to its home page
}

const fmt = (n: number) => n.toLocaleString("en-GB");
const s = ABOUT.session, b = ABOUT.build;
const days = Math.floor(s.wallHours / 24), hours = Math.round(s.wallHours - days * 24);

const STATS: [string, string, string][] = [
  [`${s.activeHours} h`, "active agent time", `over ${days} days ${hours} h, start to finish`],
  [fmt(s.prompts), "prompts from the person", "everything else was the agent"],
  [fmt(s.modelTurns), "model turns", `${fmt(s.toolCalls)} tool calls`],
  [`${(s.outputTokens / 1e6).toFixed(2)} M`, "output tokens", `${Math.round(s.inputTokens / 1e6)} M input, ${(s.cacheReadShare * 100).toFixed(1)}% from cache`],
  [`${b.tables} · ${b.pages} · ${b.actions}`, "tables · pages · actions", `${fmt(b.yamlLines)} lines of Vantage YAML`],
  [fmt(b.webLines), "lines of web app", `${b.webFiles} files, React + TypeScript`],
  [fmt(b.tests), "automated tests", `${b.e2eTests} end-to-end, ${b.unitTests} unit`],
  [fmt(b.issuesReported), "issues reported to Vantage", "each with its workaround"],
];

let autoTracked = false; // StrictMode runs the mount effect twice in development

export function Splash() {
  const [open, setOpen] = useState(() => atAbout() || sessionStorage.getItem(SEEN) !== "1");
  const button = useRef<HTMLButtonElement>(null);
  const close = () => { sessionStorage.setItem(SEEN, "1"); setOpen(false); leaveAbout(); };

  useEffect(() => {
    if (open && !autoTracked) { autoTracked = true; track("about_open", { trigger: "auto" }); }
    const again = () => { setOpen(true); track("about_open", { trigger: "link" }); };
    // Back and Forward: arriving at /about opens it, leaving closes it
    const moved = () => setOpen(atAbout());
    window.addEventListener("books:about", again);
    window.addEventListener("popstate", moved);
    return () => { window.removeEventListener("books:about", again); window.removeEventListener("popstate", moved); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => button.current?.focus(), 50);
    // the splash has the keyboard while it shows: Enter or Esc opens the books (Enter on another
    // button or link does that one's job instead)
    const onKey = (e: KeyboardEvent) => {
      const other = e.key === "Enter" && document.activeElement !== button.current
        && document.activeElement?.matches("button, a");
      if ((e.key === "Escape" || e.key === "Enter") && !other) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey, true); };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog" aria-modal="true" aria-labelledby="splash-title"
          // scrolls as a whole; the inner box centres the card when it fits and starts it at
          // the top when it doesn't (flex centring alone clips a tall card on short screens)
          className="fixed inset-0 z-[90] overflow-y-auto"
          style={{
            background: V.bg, color: V.text2, fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
            // a scrollbar on a narrow screen takes room on one side only: keep both sides equal
            scrollbarGutter: "stable both-edges",
            backgroundImage: `radial-gradient(900px 520px at 80% -10%, ${V.accent600}33, transparent 65%), radial-gradient(700px 480px at 0% 110%, #8b5cf622, transparent 60%)`,
          }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}
        >
          <div className="flex min-h-full items-center justify-center p-4 sm:p-8">
            {/* No transform animation on the card: it is several screens tall with the
                comparison, and scaling it paints the whole card into one layer, which crashed
                a GPU-less Chromium. The overlay's fade is enough. */}
            <div
              className="w-full max-w-5xl rounded-2xl border p-6 shadow-2xl sm:p-9"
              style={{ background: V.surface1, borderColor: "rgba(255,255,255,0.08)" }}
            >
              {/* one row: the logo, and across from it what this is built with */}
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <img src="/vantage-logo.svg" alt="Vantage" className="h-6 w-auto invert sm:h-7" />
                <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.18em]" style={{ color: V.accent400 }}>
                  Demo built with VantageUI {ABOUT.vantageVersion}
                </p>
              </div>

              <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
              <div className="flex min-w-0 flex-col gap-5">
                <h1 id="splash-title" className="text-4xl font-semibold tracking-[-0.025em]" style={{ color: V.text1 }}>Books. Sorted.</h1>
                <p className="text-[1.02rem] leading-relaxed" style={{ color: V.text1 }}>
                  A keyboard-first take on typical accounting software: invoices, payments, a double-entry ledger and its
                  reports, saved without waiting, never losing a draft.
                </p>
                <p className="text-[0.95rem] leading-relaxed">
                  An AI agent ({ABOUT.agent}) made it from one person's prompts: the Vantage app (tables, pages and
                  actions over SurrealDB) and this web app on its live API.
                </p>
                <p className="text-[0.95rem] leading-relaxed">
                  The books are a real company's {ABOUT.books.years} records with every customer, supplier and person
                  replaced by fictional ones; the amounts are the real ones.
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
                  <button ref={button} type="button" onClick={close}
                    className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[0.95rem] font-medium text-white transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{
                      background: V.accent600, outlineColor: V.accent300,
                      boxShadow: `0 0 0 1px ${V.accent400}59, 0 4px 24px -8px ${V.accent500}99`,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = V.accent500; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = V.accent600; }}>
                    Explore Demo <ArrowRight size={16} />
                  </button>
                  {/* the site's outline button: to the Vantage UI download page */}
                  <a href="https://vantage-ui.com/download/" target="_blank" rel="noreferrer" onClick={trackOutbound}
                    className="inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-[0.95rem] font-medium transition-all duration-150 hover:bg-[#6366f11a]"
                    style={{ borderColor: "rgba(255,255,255,0.16)", color: V.text1 }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${V.accent400}99`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)"; }}>
                    Build your own <ArrowUpRight size={16} />
                  </a>
                </div>
                <button type="button"
                  onClick={() => document.getElementById("splash-compare")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="inline-flex items-center gap-1.5 self-start text-[0.85rem] font-medium hover:underline"
                  style={{ color: V.accent300 }}>
                  How Vantage shortened this build <ArrowDown size={14} />
                </button>
              </div>

              <dl className="grid min-w-0 grid-cols-1 content-center gap-3 min-[420px]:grid-cols-2">
                {STATS.map(([value, label, note], i) => (
                  <motion.div key={label} className="rounded-xl border px-4 py-3.5"
                    style={{ background: V.surface2, borderColor: "rgba(255,255,255,0.08)" }}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.05 }}>
                    <dd className="whitespace-nowrap text-2xl font-semibold tabular-nums tracking-tight" style={{ color: V.text1 }}>{value}</dd>
                    <dt className="mt-0.5 text-[0.82rem] font-medium" style={{ color: V.accent300 }}>{label}</dt>
                    <p className="mt-0.5 text-xs leading-snug" style={{ color: V.text3 }}>{note}</p>
                  </motion.div>
                ))}
              </dl>
              </div>

              {/* below the fold: the dialog scrolls to it */}
              <section id="splash-compare" aria-labelledby="splash-compare-title" className="mt-12 scroll-mt-6 border-t pt-8"
                style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.18em]" style={{ color: V.accent400 }}>
                  Vantage vs. building it by hand
                </p>
                <h2 id="splash-compare-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]" style={{ color: V.text1 }}>
                  LLM with Vantage builds 10-times faster
                </h2>
                <ol className="mt-6 grid gap-3 md:grid-cols-2">
                  {COMPARISON.map((c, i) => (
                    <li key={c.title} className="rounded-xl border px-4 py-3.5"
                      style={{ background: V.surface2, borderColor: "rgba(255,255,255,0.08)" }}>
                      <h3 className="text-[0.95rem] font-semibold" style={{ color: V.text1 }}>
                        <span className="mr-2 font-mono text-xs tabular-nums" style={{ color: V.text3 }}>{String(i + 1).padStart(2, "0")}</span>
                        {c.title}
                      </h3>
                      <p className="mt-2 flex gap-2 text-[0.84rem] leading-snug" style={{ color: V.text3 }}>
                        <X size={15} className="mt-0.5 shrink-0" style={{ color: "#f87171" }} aria-label="By hand" />
                        <span><span className="font-medium" style={{ color: V.text2 }}>By hand: </span>{withCode(c.byHand)}</span>
                      </p>
                      <p className="mt-1.5 flex gap-2 text-[0.84rem] leading-snug" style={{ color: V.text1 }}>
                        <Check size={15} className="mt-0.5 shrink-0" style={{ color: "#4ade80" }} aria-label="Vantage" />
                        <span><span className="font-medium" style={{ color: V.accent300 }}>Vantage: </span>{withCode(c.vantage)}</span>
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
