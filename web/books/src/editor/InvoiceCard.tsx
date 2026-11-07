import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { emptyLine, flipKey, getDraft, newKey, putDraft, setSide, sideOf, useDrafts, type Kind, type Side } from "./store";
import { EditorPanel, HeaderField } from "./InvoiceEditor";
import { PaymentPanel, flipPaymentDraft } from "./PaymentEditor";
import { fmtMoney } from "@/format";

// An opened invoice as a card with three pages, like a cheque book: the invoice, then a
// payment of what is due on it, then a credit note against it. A tab on the right edge turns
// to the next page, one on the left back to the previous. Alt+I / Alt+P / Alt+C jump to a
// page. Each page is its own draft, saved on its own; a saved payment or credit turns the
// card back to the invoice, whose paid and due update.

const ORDER: Side[] = ["invoice", "payment", "credit"];
const LABEL: Record<Side, string> = { invoice: "Invoice", payment: "Payment", credit: "Credit" };
const today = () => new Date().toISOString().slice(0, 10);

function flipCreditDraft(key: string, kind: Kind, row: any) {
  if (getDraft(key)) return;
  putDraft({
    key, kind, createdAt: Date.now(), dirty: false, status: "editing", flipOf: row.id,
    creditFor: { doc: row.doc, number: row.number ?? "", due: Math.round((row.amount_due ?? 0) * 100) / 100 },
    header: {
      date: today(), number: "", reference: row.number ? `Credit for ${row.number}` : "", due_date: "",
      contact: row.contact?.id ?? row.contact ?? "", contactName: row["contact.name"] ?? "", newContact: null,
    },
    lines: [{ ...emptyLine(), key: newKey(), description: row.number ? `Credit for invoice ${row.number}` : "Credit" }],
  });
}

function EdgeTab({ side, edge, onClick }: { side: Side; edge: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      title={`Turn to the ${LABEL[side].toLowerCase()} (Alt+${LABEL[side][0]})`}
      className={
        "absolute top-3 z-10 flex w-7 items-center justify-center rounded-md border border-[#9fb3b0] bg-[#f4fffe] py-3 " +
        "text-[11px] font-bold uppercase tracking-[0.18em] text-accent shadow-sm hover:bg-highlight " +
        (edge === "right" ? "right-1" : "left-1")
      }
      style={{ writingMode: "vertical-rl", transform: edge === "left" ? "rotate(180deg)" : undefined }}
    >
      {LABEL[side]}
    </button>
  );
}

export function InvoiceCard({ row, kind, onClose, onDuplicate }: {
  row: any; kind: Kind; onClose: () => void; onDuplicate: (key: string) => void;
}) {
  useDrafts();
  const side = sideOf(row.id);
  const at = ORDER.indexOf(side);
  const payKind = kind === "sale" ? "lodgement" : "payment";
  const turn = (to: Side) => {
    if (to === "payment") flipPaymentDraft(flipKey(row.id, "payment"), payKind, row);
    if (to === "credit") flipCreditDraft(flipKey(row.id, "credit"), kind, row);
    setSide(row.id, to);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const to = ({ KeyI: "invoice", KeyP: "payment", KeyC: "credit" } as Record<string, Side>)[e.code];
      if (to) { e.preventDefault(); turn(to); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  let page: ReactNode;
  if (side === "invoice") {
    page = <EditorPanel draftKey={row.id} kind={kind} row={row} onClose={onClose} onDuplicate={onDuplicate} />;
  } else if (side === "payment") {
    page = (
      <>
        <PageHead>{kind === "sale" ? "Money received" : "Money paid"} against invoice <b>{row.number || "—"}</b> · due {fmtMoney(row.amount_due)}</PageHead>
        <PaymentPanel draftKey={flipKey(row.id, "payment")} kind={payKind} onClose={onClose} />
      </>
    );
  } else {
    const key = flipKey(row.id, "credit");
    page = (
      <>
        <PageHead>
          Credit note to {row["contact.name"]} against invoice <b>{row.number || "—"}</b>: settles up to {fmtMoney(row.amount_due)}.
          Enter the lines as negative amounts.
        </PageHead>
        <div className="flex gap-3 px-5 pt-3 text-xs font-semibold text-ink">
          <label className="flex w-36 flex-col gap-0.5">Date<HeaderField draftKey={key} field="date" /></label>
          <label className="flex w-40 flex-col gap-0.5">Credit note no<HeaderField draftKey={key} field="number" /></label>
          <label className="flex w-64 flex-col gap-0.5">Reference<HeaderField draftKey={key} field="reference" /></label>
        </div>
        <EditorPanel draftKey={key} kind={kind} onClose={onClose} onDuplicate={onDuplicate} />
      </>
    );
  }

  const dir = useDirection(row.id, at);
  return (
    <div className={"relative " + (at < ORDER.length - 1 ? "pr-9 " : "") + (at > 0 ? "pl-9" : "")} style={{ perspective: 1600 }}>
      {at > 0 && <EdgeTab side={ORDER[at - 1]!} edge="left" onClick={() => turn(ORDER[at - 1]!)} />}
      {at < ORDER.length - 1 && <EdgeTab side={ORDER[at + 1]!} edge="right" onClick={() => turn(ORDER[at + 1]!)} />}
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={side}
          custom={dir}
          variants={{
            enter: (d: number) => ({ rotateY: d * 75, opacity: 0 }),
            center: { rotateY: 0, opacity: 1 },
            exit: (d: number) => ({ rotateY: -d * 75, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.22, ease: "easeInOut" }}
          style={{ transformOrigin: dir > 0 ? "left center" : "right center" }}
        >
          {page}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function PageHead({ children }: { children: ReactNode }) {
  return <div className="border-b border-chrome bg-[#f4fffe] px-5 py-2 text-sm text-ink">{children}</div>;
}

// Which way the page turns: forward (1) to a later page, back (-1) to an earlier one.
const lastAt = new Map<string, { at: number; dir: number }>();
function useDirection(key: string, at: number) {
  const prev = lastAt.get(key);
  const dir = prev && prev.at !== at ? (at > prev.at ? 1 : -1) : prev?.dir ?? 1;
  lastAt.set(key, { at, dir });
  return dir;
}
