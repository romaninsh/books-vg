import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

// Short messages in the bottom-right corner: what an action did, or why it couldn't.
// Errors stay until dismissed; the rest fade after a few seconds.

type Toast = { id: number; kind: "ok" | "error"; text: string };
let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, kind: Toast["kind"] = "ok") {
  const t = { id: next++, kind, text };
  toasts = [...toasts, t].slice(-4);
  emit();
  if (kind === "ok") setTimeout(() => dismiss(t.id), 3500);
}
function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** The readable part of an action's error: database rules' own words, not the wrapping. */
export function humanError(message: string | undefined): string {
  if (!message) return "Something went wrong";
  const m = /An error occurred: (.*?)(?:\\?"?,? ?error_type|\\?"\)|$)/s.exec(message);
  if (m) return m[1]!.replace(/\\"/g, '"').trim();
  return message.replace(/^actions\.\w+: Runtime error: /, "").replace(/\s*\(line \d+, column \d+\)[\s\S]*$/, "");
}

/** Runs a project action and reports the outcome; resolves with its value, or null. */
export async function runAction(db: any, action: string, args: Record<string, unknown>, done?: string) {
  const res = await (db.run as any)[action].start(args).done;
  if (res.ok) { if (done) toast(done); return res.value ?? {}; }
  toast(humanError(res.error?.message), "error");
  return null;
}

export function Toaster() {
  const list = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-96 flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }}
            role={t.kind === "error" ? "alert" : "status"}
            className={"pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg " +
              (t.kind === "error" ? "border-[#e3b4b0] bg-[#fff4f3] text-danger" : "border-[#9fb3b0] bg-white text-ink")}>
            {t.kind === "error" ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />}
            <span className="flex-1">{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-ink-soft hover:bg-chrome-light" aria-label="Dismiss">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
