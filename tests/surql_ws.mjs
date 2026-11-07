// Run SurrealQL from stdin over SurrealDB's WebSocket RPC, as one query, signed in as a database
// user. Prints one line per statement (like tests/surql.sh) and exits 1 if any failed.
// usage: node tests/surql_ws.mjs [-q|-f] < file.surql      (Node 22+: global WebSocket)
// Env: SURREAL_WS (wss://host/rpc), SURREAL_USER, SURREAL_PASS, SURREAL_NS, SURREAL_DB.
// Used for SurrealDB Cloud, which refuses database users on its HTTP /sql endpoint.
const mode = process.argv[2] ?? "";
const env = (k) => process.env[k] || (console.error(`${k} is not set`), process.exit(2));
const [url, user, pass, ns, db] = ["SURREAL_WS", "SURREAL_USER", "SURREAL_PASS", "SURREAL_NS", "SURREAL_DB"].map(env);

let sql = "";
for await (const chunk of process.stdin) sql += chunk;

const ws = new WebSocket(url, "json");
let next = 1;
const waiting = new Map();
const call = (method, params) => new Promise((resolve, reject) => {
  const id = next++;
  waiting.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = (m) => {
  const f = JSON.parse(String(m.data));
  const w = waiting.get(f.id);
  if (!w) return;
  waiting.delete(f.id);
  f.error ? w.reject(new Error(f.error.message ?? JSON.stringify(f.error))) : w.resolve(f.result);
};
ws.onerror = () => { console.log("ERR socket error"); process.exit(1); };
setTimeout(() => { console.log("ERR no reply in 300 s"); process.exit(1); }, 300_000);

ws.onopen = async () => {
  try {
    await call("signin", [{ ns, db, user, pass }]);
    await call("use", [ns, db]);
    const results = await call("query", [sql]);
    let bad = 0;
    results.forEach((r, i) => {
      if (r.status !== "OK") { bad++; console.log(`#${i + 1} ERR ${typeof r.result === "string" ? r.result : JSON.stringify(r.result)}`); }
      else if (mode !== "-q") {
        const out = JSON.stringify(r.result);
        console.log(`#${i + 1} OK  ${mode === "-f" ? out : out.slice(0, 400)}`);
      }
    });
    process.exit(bad ? 1 : 0);
  } catch (e) {
    console.log("ERR", e.message); // the server's words; never the credentials
    process.exit(1);
  }
};
