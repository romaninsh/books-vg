import { useSyncExternalStore } from "react";
import { del, entries, get, set } from "idb-keyval";

// Drafts: every edit to an invoice or a payment lives here until its save has landed. Kept
// in IndexedDB, so collapsing a row, switching page or reloading never loses work.

export type Kind = "sale" | "purchase";           // invoices (and credit notes)
export type PayKind = "lodgement" | "payment";    // money in from a customer / out to a supplier
export const isPay = (k: string): k is PayKind => k === "lodgement" || k === "payment";
export type ContactKind = "client" | "supplier";   // customers and suppliers
export const isContact = (k: string): k is ContactKind => k === "client" || k === "supplier";

/** A misc payment or lodgement: bank ↔ a nominal picked by hand, no customer. */
export type MiscFields = {
  type: "misc_payment" | "misc_lodgement"; contact_name: string; description: string;
  bank_account: string; bankName: string; nominal: string; nominalPath: string; amount: number | null;
};

/** A customer's or supplier's fields, as the form edits them. */
export type ContactForm = {
  name: string; contact_name: string; email: string; telephone: string; address: string; city: string;
  county: string; country: string; currency: string; vat_registered: boolean; vat_no: string;
  credit_terms: number | null; note: string;
};

/** What a payment settles: one invoice and how much of it. */
export type Allocation = { invoice: string; number: string; date: string; due: number; amount: number | null };
export type PayFields = {
  bank_account: string; bankName: string; amount: number | null; allocations: Allocation[];
};

export type Line = {
  key: string;
  description: string;
  nominal: string;        // nominal record id
  nominalPath: string;    // shown in the picker
  quantity: number | null;
  price: number | null;
  vat_rate: number | null;
  vat: number | null;
  vatManual: boolean;     // typed by hand (reverse charge): don't recompute from the rate
};

export type NewContact = {
  name: string; country: string; currency: string; vat_no: string; email: string; credit_terms: number | null;
};

// data: base64. `staged`: all its pieces reached the server (save.ts), `key` names the upload.
export type NewFile = { key: string; name: string; mime: string; size: number; data: string; staged?: boolean };

export type Totals = { net: number; vat: number; gross: number; paid: number; amount_due: number };

export type Draft = {
  key: string;            // the list row id, or "new:<uuid>"
  kind: Kind | PayKind | ContactKind | "misc";
  pay?: PayFields;
  misc?: MiscFields;      // misc payments: header holds date and reference
  contact?: ContactForm;  // customers / suppliers        // payments: header holds date, reference and contact; lines are unused
  creditFor?: { doc: string; number: string; due: number }; // a credit note against this invoice
  flipOf?: string;        // drawn on the back of this invoice row (the cheque-book flip)
  doc?: string;           // document id when editing an existing invoice
  createdAt: number;
  anchor?: string;        // a new draft shows under this list row (absent: above the list)
  order?: number;         // among drafts under the same row, smallest first
  header: {
    date: string; number: string; reference: string; due_date: string;
    contact: string; contactName: string; newContact: NewContact | null;
  };
  lines: Line[];
  files?: NewFile[];      // attached here, saved with the invoice
  removedFiles?: string[]; // saved attachments to delete on save
  base?: Totals;         // the saved invoice's totals when the draft started (for deltas)
  dirty: boolean;         // changed since it was opened; a clean draft is dropped on collapse
  // editing → saving → saved (the server has it; the row still shows the draft until the
  // list reads the new values back) → gone. Or saving → failed → editing.
  status: "editing" | "saving" | "saved" | "failed";
  savedDoc?: string;      // what the save produced: matches the row that will show it
  runId?: string;         // the save's run id; re-used to attach after a reload
  error?: string;
  fieldErrors?: Record<string, string>;
};

// One IndexedDB entry per draft, written only when that draft changes, and a broadcast so
// other tabs pick the change up. (Writing the whole set from each tab let one tab wipe
// another's drafts.)
const OLD_KEY = "books.drafts.v1";
const PREFIX = "books.draft:";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("books.drafts") : null;
let drafts = new Map<string, Draft>();
let saved = new Map<string, number>(); // doc id → time its save landed (mint flash)
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version++;
  listeners.forEach((l) => l());
}

const pending = new Set<string>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
function emit(key?: string) {
  notify();
  if (key === undefined) return;
  pending.add(key);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const keys = [...pending];
    pending.clear();
    void Promise.all(keys.map((k) => {
      const d = drafts.get(k);
      return d ? set(PREFIX + k, d) : del(PREFIX + k);
    })).then(() => channel?.postMessage(keys));
  }, 250);
}

// Another tab changed these drafts: read them back.
channel?.addEventListener("message", async (e: MessageEvent<string[]>) => {
  for (const k of e.data) {
    const d = await get<Draft>(PREFIX + k);
    if (d) drafts.set(k, d); else drafts.delete(k);
  }
  notify();
});

export async function loadDrafts(): Promise<void> {
  const old = await get<Draft[]>(OLD_KEY);
  if (old) { // the one-array format of before: move each draft to its own entry
    await Promise.all(old.map((d) => set(PREFIX + d.key, d)));
    await del(OLD_KEY);
  }
  const all = await entries<string, Draft>();
  drafts = new Map(all.filter(([k]) => String(k).startsWith(PREFIX)).map(([, d]) => [d.key, d]));
  // A new record nobody typed into is dropped when its row closes; one left open when the
  // page went away never closed. Keep it only if the address still shows it.
  for (const d of [...drafts.values()]) {
    const untouched = d.key.startsWith("new:") && !d.dirty && d.status === "editing" && !location.pathname.includes(d.key.slice(4));
    if (untouched || d.status === "saved") { // a saved one is on the server already
      drafts.delete(d.key);
      void del(PREFIX + d.key);
    }
  }
  notify();
}

export const newKey = () => crypto.randomUUID();
export const emptyLine = (): Line => ({
  key: newKey(), description: "", nominal: "", nominalPath: "", quantity: 1, price: null,
  vat_rate: 20, vat: null, vatManual: false,
});

export function getDraft(key: string): Draft | undefined {
  return drafts.get(key);
}
export function allDrafts(): Draft[] {
  return [...drafts.values()];
}
export function putDraft(d: Draft) {
  drafts.set(d.key, d);
  emit(d.key);
}
export function updateDraft(key: string, fn: (d: Draft) => Draft) {
  const d = drafts.get(key);
  if (d) {
    drafts.set(key, fn(d));
    emit(key);
  }
}
/** A user edit: marks the draft dirty and takes a failed draft back to editing. */
export function editDraft(key: string, fn: (d: Draft) => Draft) {
  updateDraft(key, (d) => (isBusy(d) ? d : { ...fn(d), dirty: true, status: "editing" }));
}
/** Saving, or saved and waiting to be read back: the record is read-only meanwhile. */
export const isBusy = (d: Draft | undefined) => d?.status === "saving" || d?.status === "saved";

const plain = (id: string | undefined) => (id ?? "").replace(/`/g, "");
/** A row the list has just shown, new or changed: a saved draft it reflects is done with. */
export function settleSaved(row: { id?: string; doc?: any }, changed: boolean) {
  const doc = plain(typeof row.doc === "string" ? row.doc : row.doc?.id);
  for (const d of drafts.values()) {
    if (d.status !== "saved") continue;
    const same = d.key === row.id ? changed : !!d.savedDoc && (plain(d.savedDoc) === doc || plain(d.savedDoc) === plain(row.id));
    if (same) finishSaved(d.key);
  }
}
/** The saved values are on screen from the server now: drop the draft, fade the row once. */
export function finishSaved(key: string) {
  const d = drafts.get(key);
  if (!d || d.status !== "saved") return;
  drafts.delete(key);
  emit(key);
  if (d.savedDoc) markSaved(d.savedDoc);
}
export function removeDraft(key: string) {
  if (drafts.delete(key)) emit(key);
}
// Documents this tab saved: their log entries aren't news to the user (Activity badge).
const ownDocs = new Set<string>();
export const isOwnDoc = (doc: string | null | undefined) => !!doc && ownDocs.has(doc.replace(/`/g, ""));

export const markOwn = (doc: string) => ownDocs.add(doc.replace(/`/g, ""));
export function markSaved(doc: string) {
  markOwn(doc);
  saved.set(plain(doc), Date.now());
  emit();
  setTimeout(() => { saved.delete(plain(doc)); emit(); }, 1400);
}
export function justSaved(doc: string | undefined): boolean {
  return !!doc && saved.has(plain(doc));
}

// Which side of an invoice's card faces up: "invoice", "payment" or "credit". Per tab, not
// saved: a reload shows the invoice again (the flip drafts themselves are kept).
export type Side = "invoice" | "payment" | "credit";
const sides = new Map<string, Side>();
export const sideOf = (key: string): Side => sides.get(key) ?? "invoice";
export function setSide(key: string, side: Side) {
  sides.set(key, side);
  notify();
}
/** The draft drawn on one side of an invoice's card. */
export const flipKey = (invoiceKey: string, side: Exclude<Side, "invoice">) => `flip:${side}:${invoiceKey}`;

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Re-renders when any draft changes. */
export function useDrafts(): number {
  return useSyncExternalStore(subscribe, () => version);
}
