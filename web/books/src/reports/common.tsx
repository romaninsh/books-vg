import { type ReactNode } from "react";
import { useNavigate } from "react-router";
import { fmtMoney } from "@/format";
import { toSegment } from "@/editor/routes";

// Shared pieces of the reports: debit/credit cells, amounts in a statement, and opening the
// document behind a ledger posting.

export const Dr = ({ v }: { v: number | null | undefined }) => <span>{v && v > 0.004 ? fmtMoney(v) : ""}</span>;
export const Cr = ({ v }: { v: number | null | undefined }) => <span>{v && v < -0.004 ? fmtMoney(-v) : ""}</span>;

/** A statement amount: negative in red, in brackets like an accountant's. */
export function Amount({ v, strong }: { v: number; strong?: boolean }) {
  const neg = v < -0.004;
  return (
    <span className={"num " + (neg ? "text-danger " : "") + (strong ? "font-semibold" : "")}>
      {Math.abs(v) < 0.005 ? "–" : neg ? `(${fmtMoney(-v)})` : fmtMoney(v)}
    </span>
  );
}

export function ReportPage({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      {toolbar && <div className="flex items-center gap-3 border-b border-chrome px-3 py-2">{toolbar}</div>}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

const lists: Record<string, [string, string]> = {
  sale: ["sales_invoices", "/sales/invoices"], purchase: ["purchase_invoices", "/purchases/invoices"],
  lodgement: ["lodgements", "/sales/payments"], payment: ["supplier_payments", "/purchases/payments"],
  misc_payment: ["misc", "/accounts/misc"], misc_lodgement: ["misc", "/accounts/misc"],
};

/** Opens the document behind a posting on its own list, filtered so its row is loaded. */
export function useOpenDocument(db: any) {
  const navigate = useNavigate();
  return async (doc: string, type: string) => {
    const where = lists[type];
    if (!where) return false;
    const rows = db[where[0]].where({ doc: [doc, doc.replace(/^doc:(.*)$/, "doc:`$1`")] });
    await rows.load();
    const row = rows.map((r: any) => r)[0];
    if (!row) return false;
    const q = row.number ? `#${row.number}` : row["contact.name"] ?? row["doc.contact_name"] ?? "";
    navigate(`${where[1]}/${toSegment(row.id)}?q=${encodeURIComponent(q)}`);
    return true;
  };
}
