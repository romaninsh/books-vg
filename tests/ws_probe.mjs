// Opens a few entities of the books API over the WebSocket and fails unless each returns rows.
// usage: node tests/ws_probe.mjs <base URL>      (Node 22+: global WebSocket)
// Used by the PR checks (against the CI stack) and the deploy's smoke check (against Cloud Run).
const base = process.argv[2];
if (!base) { console.error("usage: node tests/ws_probe.mjs <base URL>"); process.exit(2); }
const probes = [
  { id: 2, table: "sales_invoices", limit: 5 },
  { id: 3, table: "customers", limit: 5 },
  { id: 4, table: "ledger", limit: 5 },
  { id: 5, table: "trial_balance", limit: 5 },
];
const ws = new WebSocket(base.replace(/^http/, "ws") + "/v1/ws");
const pending = new Set(probes.map((p) => p.id));
const fail = (why) => { console.log("FAIL", why); process.exit(1); };
setTimeout(() => fail(`no reply in 45 s (waiting for ${[...pending].join(", ")})`), 45000);
ws.onerror = () => fail("socket error");
ws.onopen = () => ws.send(JSON.stringify({ t: "hello", id: 1, protocol: 1 }));
ws.onmessage = (m) => {
  const f = JSON.parse(String(m.data));
  if (f.id === 1) {
    if (f.t !== "welcome") fail(`hello: ${f.t} ${f.message ?? ""}`);
    for (const p of probes) ws.send(JSON.stringify({ t: "open_table", ...p }));
    return;
  }
  const p = probes.find((x) => x.id === f.id);
  if (!p || !pending.has(p.id)) return;
  if (f.t === "error" || f.t === "rejected") fail(`${p.table}: ${f.message ?? f.t}`);
  if (f.t !== "rows") return;
  const n = (f.ids ?? []).length;
  if (n === 0) fail(`${p.table}: no rows`);
  console.log("ok  ", p.table, `${n} rows`);
  pending.delete(p.id);
  if (pending.size === 0) process.exit(0);
};
