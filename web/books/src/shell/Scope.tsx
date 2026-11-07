import { useState } from "react";
import { useLocation } from "react-router";

// "This page" or "Everything" for the Drafts and Activity panels. Remembered per panel.
// A page is its list: the first two parts of the path (/sales/invoices).

export type Scope = "page" | "all";
const pageOf = (path: string) => path.split("?")[0]!.split("/").slice(0, 3).join("/");

export function useScope(panel: string) {
  const { pathname } = useLocation();
  const [scope, set] = useState<Scope>(() => (localStorage.getItem(`books.scope.${panel}`) as Scope) ?? "page");
  const setScope = (s: Scope) => { localStorage.setItem(`books.scope.${panel}`, s); set(s); };
  const here = pageOf(pathname);
  /** Whether something that lives at `path` is shown under the current scope. */
  const shows = (path: string | undefined) => scope === "all" || (!!path && pageOf(path) === here);
  return { scope, setScope, shows };
}

export function ScopeToggle({ scope, setScope }: { scope: Scope; setScope: (s: Scope) => void }) {
  return (
    <div className="flex rounded-md border border-chrome bg-white p-0.5">
      {(["page", "all"] as const).map((s) => (
        <button key={s} type="button" tabIndex={-1} onClick={() => setScope(s)}
          className={"rounded px-2 py-0.5 text-xs " + (scope === s ? "bg-highlight font-medium text-ink" : "text-ink-soft hover:text-ink")}>
          {s === "page" ? "This page" : "Everything"}
        </button>
      ))}
    </div>
  );
}
