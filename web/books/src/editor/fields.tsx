import { useEffect, useState } from "react";

// Keyboard-friendly inputs: one Tab stop each, forgiving input, validated on the spot.

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** dd/mm/yyyy display of an ISO date. */
export const showDate = (v: string) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "");

/**
 * Parse what a bookkeeper types: "05/11/2026", "5/11" (this year), "5" (this month),
 * "+30" / "-7" (days from `base`), "t" or "today". Returns ISO, "" for empty, null if bad.
 */
export function parseDate(text: string, base?: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return "";
  const now = new Date();
  if (t === "t" || t === "today") return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const rel = t.match(/^([+-])(\d{1,4})$/);
  if (rel) {
    const b = base ? new Date(base + "T00:00:00Z") : new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    b.setUTCDate(b.getUTCDate() + (rel[1] === "-" ? -1 : 1) * Number(rel[2]));
    return b.toISOString().slice(0, 10);
  }
  const m = t.match(/^(\d{1,2})(?:[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?)?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : now.getMonth() + 1;
  let y = m[3] ? Number(m[3]) : now.getFullYear();
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return iso(y, mo, d);
}

export function DateField({ value, onChange, base, invalid, autoFocus }: {
  value: string; onChange: (iso: string) => void; base?: string; invalid?: string; autoFocus?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const parsed = text === null ? value : parseDate(text, base);
  const bad = text !== null && parsed === null;
  useEffect(() => setText(null), [value]);
  return (
    <input
      className="field"
      autoFocus={autoFocus}
      value={text ?? showDate(value)}
      placeholder="dd/mm/yyyy"
      aria-invalid={bad || !!invalid}
      title={bad ? "Use dd/mm/yyyy, 5/11, or +30 days" : invalid}
      onChange={(e) => {
        setText(e.target.value);
        const p = parseDate(e.target.value, base);
        if (p !== null && e.target.value.length >= 8) onChange(p); // a full date: take it now
      }}
      onBlur={() => {
        if (text !== null && parsed !== null) onChange(parsed);
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && parsed !== null && text !== null) onChange(parsed);
      }}
    />
  );
}

/** A number input: keeps what was typed, reports null for empty and refuses non-numbers. */
export function NumberField({ value, onChange, invalid, placeholder, className, onKeyDown }: {
  value: number | null; onChange: (v: number | null) => void; invalid?: string; placeholder?: string;
  className?: string; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === null ? "" : String(value));
  const bad = text !== null && text.trim() !== "" && !Number.isFinite(Number(text.replace(/,/g, "")));
  return (
    <input
      className={"field num " + (className ?? "")}
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      aria-invalid={bad || !!invalid}
      title={bad ? "Not a number" : invalid}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") onChange(null);
        else {
          const n = Number(t.replace(/,/g, ""));
          if (Number.isFinite(n)) onChange(n);
        }
      }}
      onBlur={() => setText(null)}
      onKeyDown={onKeyDown}
    />
  );
}
