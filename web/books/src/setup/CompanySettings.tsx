import { useEffect, useState } from "react";
import { observer, useCollection } from "@vantage-ui/client/react";
import { useDb } from "@/db";
import { runAction } from "@/shell/toast";

// The company keeping these books: its name (top bar, printed invoices) and when its
// financial year starts (the yearly reports follow it).

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The company row (company:main), or undefined while it loads. */
export function useCompany(): { name: string; fy_start_month: number; vat_no?: string; address?: string; email?: string } | undefined {
  const db = useDb() as any;
  const c = useCollection(db.company.where({}));
  return (c.items as any[])[0];
}

export const CompanySettings = observer(() => {
  const db = useDb() as any;
  const company = useCompany();
  const [f, setF] = useState({ name: "", fy_start_month: 1, vat_no: "", address: "", email: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (company) setF({ name: company.name ?? "", fy_start_month: company.fy_start_month ?? 1, vat_no: company.vat_no ?? "", address: company.address ?? "", email: company.email ?? "" });
  }, [company?.name, company?.fy_start_month, company?.vat_no, company?.address, company?.email]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = !!company && (f.name !== company.name || f.fy_start_month !== company.fy_start_month
    || f.vat_no !== (company.vat_no ?? "") || f.address !== (company.address ?? "") || f.email !== (company.email ?? ""));
  const label = "flex flex-col gap-0.5 text-xs font-semibold text-ink";

  return (
    <div className="h-full overflow-auto">
      <form className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-6"
        onSubmit={async (e) => { e.preventDefault(); setBusy(true); await runAction(db, "save_company", f, "Company details saved"); setBusy(false); }}>
        <h2 className="text-lg font-semibold text-brand">Company</h2>
        {!company && <p className="text-ink-soft">Loading…</p>}
        <label className={label}>Company name
          <input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className={label}>Financial year starts in
            <select className="field" value={f.fy_start_month} onChange={(e) => setF({ ...f, fy_start_month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <span className="font-normal text-ink-soft">Profit and loss and the balance sheet group years from this month.</span>
          </label>
          <label className={label}>VAT number
            <input className="field" value={f.vat_no} onChange={(e) => setF({ ...f, vat_no: e.target.value })} />
          </label>
        </div>
        <label className={label}>Address (printed on invoices)
          <textarea className="field h-20 py-1" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </label>
        <label className={label}>Email
          <input className="field" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="submit" disabled={busy || !changed || !f.name.trim()}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
});
