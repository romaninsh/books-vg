import { useRef } from "react";
import { observer, useCollection } from "@vantage-ui/client/react";
import { AnimatePresence, motion } from "motion/react";
import { FileText, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { useDb } from "@/db";
import { editDraft, getDraft, newKey, type NewFile } from "./store";

// Files on an invoice: the saved ones (from the API) and the ones attached since, which wait
// in the draft and are saved with the invoice in one go. Removing a saved file is a draft
// change too, undone by discarding.

const MAX = 8_000_000;
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function readFile(f: File): Promise<NewFile> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({
      key: newKey(), name: f.name, mime: f.type || "application/octet-stream", size: f.size,
      data: String(r.result).replace(/^data:[^,]*,/, ""),
    });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

/** Adds files to a draft; too-large ones are refused with a message. */
export async function attachFiles(draftKey: string, list: FileList | File[]): Promise<string | null> {
  const files = [...list];
  const big = files.filter((f) => f.size > MAX).map((f) => f.name);
  const read = await Promise.all(files.filter((f) => f.size <= MAX).map(readFile));
  if (read.length) editDraft(draftKey, (d) => ({ ...d, files: [...(d.files ?? []), ...read] }));
  return big.length ? `Over 8 MB, not attached: ${big.join(", ")}` : null;
}

function openFile(name: string, mime: string, data: string) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const w = window.open(url, "_blank");
  if (!w) { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The "Attach file" button: sits beside "Add line". */
export function AttachButton({ draftKey, onError }: { draftKey: string; onError: (msg: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => input.current?.click()}
        className="mt-1 flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-accent hover:bg-highlight">
        <Paperclip size={14} /> Attach file
      </button>
      <input ref={input} type="file" multiple hidden
        onChange={async (e) => { if (e.target.files) onError(await attachFiles(draftKey, e.target.files)); e.target.value = ""; }} />
    </>
  );
}

/** The files, as chips: click opens, × removes. */
export const AttachmentList = observer(({ draftKey, doc }: { draftKey: string; doc?: string }) => {
  const db = useDb() as any;
  const saved = useCollection(db.attachments.where({ doc: doc ?? "doc:none" }));
  const d = getDraft(draftKey);
  if (!d) return null;
  const removed = new Set(d.removedFiles ?? []);
  const items = [
    ...(doc ? saved.items.map((a: any) => ({ key: a.id as string, name: a.name ?? "", mime: a.mime ?? "", size: a.size ?? 0, data: a.data ?? "", isNew: false })) : []),
    ...(d.files ?? []).map((f) => ({ ...f, isNew: true })),
  ].filter((f) => !removed.has(f.key));
  if (!items.length) return null;

  const remove = (key: string, isNew: boolean) =>
    editDraft(draftKey, (x) => isNew
      ? { ...x, files: (x.files ?? []).filter((f) => f.key !== key) }
      : { ...x, removedFiles: [...(x.removedFiles ?? []), key] });

  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      <AnimatePresence initial={false}>
        {items.map((f) => (
          <motion.li key={f.key} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.15 }}
            className={"flex items-center gap-1.5 rounded-md border bg-white py-1 pl-2 pr-1 text-sm " +
              (f.isNew ? "border-accent border-dashed" : "border-[#9aa3a6]")}>
            {f.mime.startsWith("image/") ? <ImageIcon size={14} className="text-ink-soft" /> : <FileText size={14} className="text-ink-soft" />}
            <button type="button" onClick={() => openFile(f.name, f.mime, f.data)} title="Open"
              className="max-w-[16rem] truncate text-ink hover:underline">{f.name}</button>
            <span className="text-xs text-ink-soft">{fmtSize(f.size)}{f.isNew ? " · not saved" : ""}</span>
            <button type="button" tabIndex={-1} title="Remove" onClick={() => remove(f.key, f.isNew)}
              className="rounded p-0.5 text-ink-soft hover:bg-[#fde8e6] hover:text-danger"><X size={13} /></button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
});
