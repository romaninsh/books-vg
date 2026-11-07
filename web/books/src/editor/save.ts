import { allDrafts, finishSaved, getDraft, isBusy, isContact, isPay, markOwn, markSaved, newKey, removeDraft, setSide, updateDraft, type Draft, type NewFile } from "./store";
import { draftTotals, lineVat } from "./totals";
import { humanError } from "@/shell/toast";

// The save queue. Saving starts the save-invoice action as a run with the draft's own run
// id and returns at once: the user carries on. The id is stored with the draft, so after a
// reload or a dropped connection the app attaches to the same run instead of saving twice.

// save-invoice's args aren't typed in the bindings (a script action declares none).
type Db = any;

function payArgs(d: Draft) {
  const h = d.header, p = d.pay!;
  return {
    type: d.kind,
    doc: d.doc,
    date: h.date,
    reference: h.reference || undefined,
    contact: h.contact || undefined,
    bank_account: p.bank_account || undefined,
    amount: p.amount ?? 0,
    allocations: p.allocations
      .filter((a) => (a.amount ?? 0) > 0)
      .map((a) => ({ invoice: a.invoice, amount: a.amount })),
  };
}

/** A credit note settles the invoice it was raised against, up to what is due on it. */
function creditAllocation(d: Draft) {
  if (!d.creditFor) return undefined;
  const credit = -draftTotals(d).gross;
  const amount = Math.round(Math.min(Math.max(credit, 0), d.creditFor.due) * 100) / 100;
  return [{ invoice: d.creditFor.doc, amount }];
}

function toArgs(d: Draft) {
  const h = d.header;
  return {
    allocate_to: creditAllocation(d),
    type: d.kind,
    doc: d.doc,
    date: h.date,
    due_date: h.due_date || undefined,
    number: h.number || undefined,
    reference: h.reference || undefined,
    contact: h.newContact ? undefined : h.contact || undefined,
    new_contact: h.newContact ?? undefined,
    lines: d.lines
      .filter((l) => l.nominal || l.price !== null || l.description)
      .map((l) => ({
        description: l.description || undefined,
        nominal: l.nominal,
        quantity: l.quantity ?? 1,
        price: l.price ?? undefined,
        vat_rate: l.vat_rate ?? 0,
        vat: lineVat(l),
      })),
    add_files: d.files?.length
      ? d.files.map((f) => ({ upload: f.key, chunks: pieceCount(f), name: f.name, mime: f.mime, size: f.size }))
      : undefined,
    remove_files: d.removedFiles?.length ? d.removedFiles : undefined,
  };
}

/** "FIELDS:{json}" from the action → per-field messages. */
function parseError(message: string): { error: string; fieldErrors?: Record<string, string> } {
  const at = message.indexOf("FIELDS:");
  if (at >= 0) {
    try {
      const fieldErrors = JSON.parse(message.slice(at + 7)) as Record<string, string>;
      // say what to fix, so the Drafts panel is useful on its own: "Line 3: Pick a nominal"
      const what = Object.entries(fieldErrors).map(([f, m]) => {
        const line = /^lines\.(\d+)\./.exec(f);
        return line ? `Line ${Number(line[1]) + 1}: ${m.toLowerCase()}` : m;
      });
      return { error: what.join(" · "), fieldErrors };
    } catch { /* fall through */ }
  }
  return { error: humanError(message) };
}

function follow(key: string, run: { done: Promise<any> }) {
  void run.done.then((res: any) => {
    if (!getDraft(key)) return;
    if (res.ok) {
      // what was saved: a document, or a contact (its row id, for the mint flash)
      const doc = (res.value?.doc ?? res.value?.contact) as string | undefined;
      const flipOf = getDraft(key)?.flipOf;
      if (flipOf) { // drawn on an invoice's card: the card turns back to the invoice it paid
        removeDraft(key);
        setSide(flipOf, "invoice");
        if (doc) markSaved(doc);
        return;
      }
      // Saved. The row keeps showing these values until the list reads them back from the
      // server (store.settleSaved), so it never blinks back to the old ones; a few seconds
      // at most, as lists re-read every 5.
      if (doc) markOwn(doc);
      updateDraft(key, (d) => ({ ...d, status: "saved", savedDoc: doc ?? d.doc ?? key, runId: undefined, dirty: false }));
      setTimeout(() => finishSaved(key), 8000);
    } else {
      const msg = res.error?.message ?? "Save failed";
      updateDraft(key, (d) => ({ ...d, status: "failed", runId: undefined, ...parseError(msg) }));
    }
  });
}

// Files go up first, in pieces well under the API's message size (a message too large drops
// the connection, and the client would resend it forever). Pieces are idempotent: sending
// one again replaces it, so an interrupted upload simply starts over.
const PIECE = 256 * 1024;
const pieceCount = (f: NewFile) => Math.max(1, Math.ceil(f.data.length / PIECE));

async function stageFiles(db: Db, key: string) {
  for (const f of getDraft(key)?.files ?? []) {
    if (f.staged) continue;
    const n = pieceCount(f);
    for (let from = 0; from < n; from += 4) { // four pieces at a time
      const results = await Promise.all(
        Array.from({ length: Math.min(4, n - from) }, (_, j) => {
          const seq = from + j;
          return (db.run as any).stage_file.start({ upload: f.key, seq, data: f.data.slice(seq * PIECE, (seq + 1) * PIECE) }).done;
        }),
      );
      const bad = results.find((r: any) => !r.ok);
      if (bad) throw new Error(`${f.name}: ${bad.error?.message ?? "upload failed"}`);
    }
    updateDraft(key, (d) => ({ ...d, files: d.files?.map((x) => (x.key === f.key ? { ...x, staged: true } : x)) }));
  }
}

async function send(db: Db, key: string) {
  try {
    await stageFiles(db, key);
  } catch (e) {
    updateDraft(key, (d) => ({ ...d, status: "failed", error: `A file didn't upload (${(e as Error).message})` }));
    return;
  }
  const d = getDraft(key);
  if (!d) return;
  const runId = d.runId ?? newKey();
  updateDraft(key, (x) => ({ ...x, runId }));
  follow(key, (db.run as any)[actionOf(d)].start(argsOf(d), { id: runId }));
}

// Which action saves a draft, and with what.
const actionOf = (d: Draft) =>
  isPay(d.kind) ? "save_payment" : isContact(d.kind) ? "save_contact" : d.kind === "misc" ? "save_misc" : "save_invoice";
function argsOf(d: Draft) {
  if (isPay(d.kind)) return payArgs(d);
  if (isContact(d.kind)) return { type: d.kind, id: d.doc, ...d.contact };
  if (d.kind === "misc") {
    const m = d.misc!;
    return {
      type: m.type, doc: d.doc, date: d.header.date, reference: d.header.reference, contact_name: m.contact_name,
      description: m.description, bank_account: m.bank_account, nominal: m.nominal, amount: m.amount ?? 0,
    };
  }
  return toArgs(d);
}

/** The run a draft's save went out as, to follow it again after a reload. */
const attachRun = (db: Db, d: Draft) => (db.run as any)[actionOf(d)].attach(d.runId);

export function saveDraft(db: Db, key: string) {
  const d = getDraft(key);
  if (!d || isBusy(d)) return;
  updateDraft(key, (x) => ({ ...x, status: "saving", error: undefined, fieldErrors: undefined }));
  void send(db, key);
}

/** After a reload: follow every save that was on its way. One cut off while its files were
 *  uploading waits for the user: every open tab runs this, and two tabs resending it would
 *  save the invoice twice (the run id is only fixed once the upload is done). */
export function resumeSaves(db: Db) {
  for (const d of allDrafts()) {
    if (d.status !== "saving") continue;
    if (d.runId) follow(d.key, attachRun(db, d));
    else updateDraft(d.key, (x) => ({ ...x, status: "failed", error: "The upload was interrupted: save again" }));
  }
}
