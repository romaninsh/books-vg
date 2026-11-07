import { useEffect, useRef, useState, type ReactNode } from "react";
import { observer, useWindow } from "@vantage-ui/client/react";

// A keyboard-first type-ahead over an API entity. The server matches what was typed
// (`like`); ↑/↓ move, Enter / Tab pick, Esc closes. Optionally offers "Create '…'" when
// nothing matches exactly, for things that can be created inline (a new customer).

export type PickerProps = {
  value: string;                                   // what the input shows when not typing
  collection: (text: string) => any;               // server query for the typed text
  label: (row: any) => ReactNode;
  pick: (row: any) => void;
  create?: { label: (text: string) => string; onCreate: (text: string) => void };
  placeholder?: string;
  invalid?: string;
  autoFocus?: boolean;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
};

export const Picker = observer((p: PickerProps) => {
  const [text, setText] = useState<string | null>(null); // null = not typing
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = text ?? "";
  const page = useWindow(p.collection(typed), 0, 8);
  const rows = page.items.filter(Boolean) as any[];
  const exact = rows.some((r) => String(r.name ?? r.path ?? "").toLowerCase() === typed.trim().toLowerCase());
  // "Create …" only once the server has answered for what was typed: a fast Enter must not
  // create "Cambridge" when "Cambridge Genomix" was about to be offered
  // Are the rows the answer to what was typed? `settled` alone isn't enough: while the new query
  // loads, the window can still show the previous one's rows, settled (a fast "Cambridge" + Enter
  // picked "Bank Interest", the first of the unfiltered list). Every picker filters on name or
  // path containing the text, so a row without it is stale.
  const needle = typed.trim().toLowerCase();
  // (name or path: a nominal's name is "Internet", its path "Other Direct Costs:Internet")
  const fresh = page.settled && rows.every((r) => `${r.name ?? ""} ${r.path ?? ""}`.toLowerCase().includes(needle));
  const canCreate = !!p.create && typed.trim().length > 1 && !exact && fresh;
  const options = rows.length + (canCreate ? 1 : 0);
  useEffect(() => setActive(0), [typed]);

  const choose = (i: number) => {
    if (i < rows.length) p.pick(rows[i]);
    else if (canCreate) p.create!.onCreate(typed.trim());
    setText(null);
    setOpen(false);
  };
  // Enter before the matches arrived: pick when they do
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (pending && fresh) { setPending(false); if (options > 0) choose(active); }
  }, [pending, fresh, options]); // eslint-disable-line react-hooks/exhaustive-deps

  const listRef = useRef<HTMLUListElement>(null);
  return (
    <div className={"relative " + (p.className ?? "")}>
      <input
        ref={p.inputRef}
        autoFocus={p.autoFocus}
        value={text ?? p.value}
        placeholder={p.placeholder}
        aria-invalid={!!p.invalid}
        title={p.invalid}
        role="combobox"
        aria-expanded={open}
        onFocus={(e) => { e.target.select(); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => { setOpen(false); setText(null); }, 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(options - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && text !== null && !fresh) { e.preventDefault(); setPending(true); }
          else if ((e.key === "Enter" || e.key === "Tab") && open && text !== null && options > 0) {
            if (e.key === "Enter") e.preventDefault();
            choose(active);
          } else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setText(null); }
        }}
        className={
          "h-7 w-full rounded border bg-white px-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 " +
          (p.invalid ? "border-danger" : "border-[#9aa3a6]")
        }
      />
      {open && text !== null && options > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute left-0 top-8 z-50 max-h-72 min-w-full overflow-auto rounded-md border border-chrome bg-white py-1 text-sm shadow-lg"
        >
          {rows.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              className={"cursor-default whitespace-nowrap px-2.5 py-1 " + (i === active ? "bg-highlight text-ink" : "text-ink")}
            >
              {p.label(r)}
            </li>
          ))}
          {canCreate && (
            <li
              role="option"
              aria-selected={active === rows.length}
              onMouseDown={(e) => { e.preventDefault(); choose(rows.length); }}
              className={"cursor-default border-t border-chrome px-2.5 py-1 font-medium text-accent " + (active === rows.length ? "bg-highlight" : "")}
            >
              + {p.create!.label(typed.trim())}
            </li>
          )}
        </ul>
      )}
    </div>
  );
});
