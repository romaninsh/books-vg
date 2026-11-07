import { StrictMode, Suspense, lazy, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router";
import { createVantage } from "@vantage-ui/client";
import { VantageProvider } from "@vantage-ui/client/react";
import { schema, type Schema } from "./vantage.gen";
import { ConnectionGate } from "./ConnectionGate";
import { Shell } from "./shell/Shell";
import { Splash } from "./shell/Splash";
import { InvoiceList } from "./lists/InvoiceList";
import { ContactList } from "./lists/ContactList";
import { PaymentList } from "./lists/PaymentList";
import { CompanySettings } from "./setup/CompanySettings"; // small, and the shell reads the company anyway
import { loadDrafts } from "./editor/store";
import { resumeSaves } from "./editor/save";
import "./styles.css";

// Day-to-day pages load with the app; reports, accounts and setup load when first opened.
const named = <K extends string>(load: () => Promise<Record<K, any>>, name: K): ComponentType<any> =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const MiscList = named(() => import("./lists/MiscList"), "MiscList");
const BankList = named(() => import("./lists/BankList"), "BankList");
const NominalTree = named(() => import("./lists/NominalTree"), "NominalTree");
const TrialBalance = named(() => import("./reports/TrialBalance"), "TrialBalance");
const Ledger = named(() => import("./reports/Ledger"), "Ledger");
const Statements = named(() => import("./reports/Statements"), "Statements");
const AgedDebt = named(() => import("./reports/AgedDebt"), "AgedDebt");

// The generated schema gives `keys:` relations (invoice lines) a null foreignKey, which the
// client's SchemaMeta type doesn't allow (FEEDBACK.md). The runtime accepts it.
const db = createVantage<Schema>({ schema: schema as unknown as Parameters<typeof createVantage<Schema>>[0]["schema"] });

// Tabbing into an editor field selects what is there, so typing replaces it.
document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.classList.contains("field") && t.type !== "date") t.select();
});

// Drafts come back from IndexedDB; saves that were on their way are followed again.
void loadDrafts().then(() => resumeSaves(db));

function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h2 className="font-semibold text-brand">No such page</h2>
      <p className="mt-1 text-sm text-ink-soft">The address may be old. <Link className="text-accent underline" to="/sales/invoices">Go to sales invoices</Link>.</p>
    </div>
  );
}
const Loading = () => <p className="p-6 text-ink-soft">Loading…</p>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* in front of everything, the "Opening the books…" screen included */}
    <Splash />
    <VantageProvider db={db} fallback={<ConnectionGate />}>
      <ConnectionGate>
        <BrowserRouter>
          <Shell>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<Navigate to="/sales/invoices" replace />} />
                {/* the optional segment is the open record: /sales/invoices/s00397, /sales/invoices/new-<uuid> */}
                <Route path="/sales/invoices/:open?" element={<InvoiceList key="sales" kind="sales" />} />
                <Route path="/purchases/invoices/:open?" element={<InvoiceList key="purchases" kind="purchases" />} />
                <Route path="/sales/payments/:open?" element={<PaymentList key="lodgements" side="sales" />} />
                <Route path="/purchases/payments/:open?" element={<PaymentList key="payments" side="purchases" />} />
                <Route path="/sales/customers/:open?" element={<ContactList key="customers" kind="customers" />} />
                <Route path="/purchases/suppliers/:open?" element={<ContactList key="suppliers" kind="suppliers" />} />
                <Route path="/accounts" element={<Navigate to="/accounts/misc" replace />} />
                <Route path="/accounts/misc/:open?" element={<MiscList />} />
                <Route path="/accounts/banks/:open?" element={<BankList />} />
                <Route path="/accounts/nominals" element={<NominalTree />} />
                <Route path="/reports" element={<Navigate to="/reports/pnl" replace />} />
                <Route path="/reports/pnl" element={<Statements key="pnl" which="pnl" />} />
                <Route path="/reports/balance-sheet" element={<Statements key="bs" which="balance" />} />
                <Route path="/reports/trial-balance" element={<TrialBalance />} />
                <Route path="/reports/ledger" element={<Ledger />} />
                <Route path="/reports/aged-debtors" element={<AgedDebt key="d" side="debtors" />} />
                <Route path="/reports/aged-creditors" element={<AgedDebt key="c" side="creditors" />} />
                <Route path="/setup" element={<Navigate to="/setup/company" replace />} />
                <Route path="/setup/company" element={<CompanySettings />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </Shell>
        </BrowserRouter>
      </ConnectionGate>
    </VantageProvider>
  </StrictMode>,
);
