import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { observer, useCollection, useWindow } from "@vantage-ui/client/react";
import { Plus } from "lucide-react";
import { useDb } from "@/db";
import { fmtDate, fmtMoney } from "@/format";
import { DataList, Expander, type Col } from "./DataList";
import { money } from "./InvoiceList";
import { runAction } from "@/shell/toast";
import { toSegment } from "@/editor/routes";
import { useOpenDocument } from "@/reports/common";
import { parentId } from "./NominalTree";

// Bank accounts (credit cards and loans too): what is in each, and its latest movements.
// An account posts to a primary nominal by code (15000 Bank accounts, 25000 Credit card…).
// Small forms: they save straight away rather than through drafts.

const cols: Col[] = [
  { key: "name", label: "Account", width: 220, grow: 2 },
  { key: "nominal_path", label: "Posts to", width: 200, grow: 1, render: (r) => `${r.code} · ${r.nominal_path ?? ""}`, drop: 1 },
  { key: "transactions", label: "Transactions", width: 120, align: "right", drop: 2 },
  { key: "balance", label: "Balance", width: 150, align: "right", render: money("balance") },
];

const BankForm = observer(({ row, onDone }: { row?: any; onDone: () => void }) => {
  const db = useDb() as any;
  const [name, setName] = useState(row?.name ?? "");
  const [code, setCode] = useState(row?.code ?? "15000");
  const [busy, setBusy] = useState(false);
  const nominals = useCollection(db.nominals.where({}).sort("code", "asc"));
  const primaries = (nominals.items as any[]).filter((n) => n && !parentId(n));
  useEffect(() => { setName(row?.name ?? ""); setCode(row?.code ?? "15000"); }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    const ok = await runAction(db, "save_bank_account", { id: row?.id, name, code }, row ? "Bank account saved" : "Bank account added");
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <form className="flex flex-wrap items-end gap-3 px-5 py-3" onSubmit={(e) => { e.preventDefault(); void save(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDone(); } }}>
      <label className="flex w-72 flex-col gap-0.5 text-xs font-semibold text-ink">Account name
        <input className="field" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex w-72 flex-col gap-0.5 text-xs font-semibold text-ink">Posts to nominal
        <select className="field" value={code} onChange={(e) => setCode(e.target.value)}>
          {primaries.map((n) => <option key={n.id} value={n.code}>{n.code} · {n.path}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy || !name.trim()}
        className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand disabled:opacity-60">
        {busy ? "Saving…" : row ? "Save" : "Add account"}
      </button>
      <button type="button" onClick={onDone}
        className="rounded-md border border-[#9aa3a6] bg-white px-3 py-1.5 text-sm text-ink hover:bg-chrome-light">Cancel</button>
    </form>
  );
});

const Movements = observer(({ row }: { row: any }) => {
  const db = useDb() as any;
  const open = useOpenDocument(db);
  // the bank side of each posting: this bank's name, on its nominal code
  const page = useWindow(db.ledger.where({ bank: row.name, nominal_code: row.code }).sort("date", "desc"), 0, 12);
  const items = (page.items as any[]).filter(Boolean);
  return (
    <div className="border-t border-chrome px-5 py-3">
      <h3 className="mb-1 text-xs font-semibold text-ink">Latest movements</h3>
      {items.length === 0 && <p className="text-sm text-ink-soft">{page.settled ? "Nothing yet." : "Loading…"}</p>}
      <table className="w-full text-sm">
        <tbody>
          {items.map((p) => (
            <tr key={p.id} onClick={() => void open(p.doc, p.doc_type)} className="cursor-pointer hover:bg-highlight">
              <td className="w-28 py-0.5 text-ink-soft">{fmtDate(p.date)}</td>
              <td className="py-0.5">{p.reference || "—"}</td>
              <td className={"num w-32 py-0.5 " + (p.amount < 0 ? "text-danger" : "text-success")}>{fmtMoney(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {page.length > 12 && (
        <a className="mt-1 inline-block text-sm font-medium text-accent hover:underline"
          href={`/reports/ledger?nominal=${encodeURIComponent(row.code)}`}>All postings to {row.code} →</a>
      )}
    </div>
  );
});

export function BankList() {
  const db = useDb() as any;
  const { open } = useParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const openKey = open ? `bank_account:${open}` : null;
  const setOpenKey = (key: string | null) => navigate(key ? `/accounts/banks/${toSegment(key)}` : "/accounts/banks");
  return (
    <DataList
      title="Bank accounts"
      actions={
        <button type="button" onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-brand">
          <Plus size={15} /> New bank account
        </button>
      }
      collection={(where, sort) => db.bank_accounts.where(where).sort(sort.col, sort.dir)}
      cols={cols}
      defaultSort={{ col: "name", dir: "asc" }}
      noun="accounts"
      filterHint="Filter: name"
      textFilter={(t) => (t ? { name: { like: t } } : {})}
      openKey={openKey}
      onOpenKey={setOpenKey}
      topRows={() => <Expander open={adding}>{adding && <BankForm onDone={() => setAdding(false)} />}</Expander>}
      detail={(row) => (
        <div onClick={(e) => e.stopPropagation()}>
          <BankForm row={row} onDone={() => setOpenKey(null)} />
          <Movements row={row} />
        </div>
      )}
    />
  );
}
