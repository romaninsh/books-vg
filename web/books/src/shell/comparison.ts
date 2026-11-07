// "LLM with Vantage builds 10-times faster", on the splash below the stats: each thing the books needed,
// how a hand-built backend (Express, a database driver, a WebSocket server) would have to do it,
// and what it took here. Every Vantage line names something in this repository; the counts were
// measured on 7 November 2026 (api/books.yaml, table/, action/, src/vantage.gen.ts, Dockerfile).
// The hand-built side is what you'd have to write, not an estimate of hours.

export type Comparison = { title: string; byHand: string; vantage: string };

export const COMPARISON: Comparison[] = [
  {
    title: "Lists update when the data changes",
    byHand: "A WebSocket server, a subscription per open list, change capture from the database, diffs per client, reconnect and replay.",
    vantage: "Tables are live: an open list updates within a fraction of a second. No code in this app.",
  },
  {
    title: "Invoice totals: net, VAT, paid, due, status",
    byHand: "The same SQL repeated in every endpoint that lists, filters or sorts invoices, and kept in step by hand.",
    vantage: "One `expr:` per column in the table's YAML; every list, filter and sort uses it. 33 such columns here.",
  },
  {
    title: "Reports: trial balance, ledger, P&L, aged debt",
    byHand: "A SQL view per report, then an endpoint, paging and sorting for each.",
    vantage: "Five query tables in YAML, served and paged like any other list.",
  },
  {
    title: "The API itself",
    byHand: "Routes, request validation and response shapes for 18 resources.",
    vantage: "api/books.yaml: 18 entities in 191 lines.",
  },
  {
    title: "A typed client for the web app",
    byHand: "An OpenAPI spec and a client, kept in step with the server by hand.",
    vantage: "Generated from the API's schema: 2,983 lines of TypeScript, never edited. A renamed column fails the build.",
  },
  {
    title: "Sorting, filtering and paging on the server",
    byHand: "Query-string parsing, a SQL builder, and an allow-list so clients can't filter on just anything.",
    vantage: "`filter:` and `sortable:` lists per entity; the page asks with .where(), .sort() and .window().",
  },
  {
    title: "Only the right fields leave the server",
    byHand: "A response mapper per resource, and care that change events don't leak more than the response does.",
    vantage: "One `columns:` list per entity, applied to reads, writes and the change feed alike.",
  },
  {
    title: "A save never runs twice",
    byHand: "Idempotency keys stored on the server, so a retry or a reload doesn't post an invoice twice.",
    vantage: "Every action runs under the client's own run id; sending it again attaches instead.",
  },
  {
    title: "Saving an invoice is all or nothing",
    byHand: "Transaction handling and validation in each controller.",
    vantage: "One script action per operation: save-invoice is 105 lines, validation included.",
  },
  {
    title: "Audit trail: who changed what",
    byHand: "Triggers or middleware on every write, a log table, and an endpoint to read it.",
    vantage: "6 lines in application.yaml. The Activity panel reads it as an ordinary list.",
  },
  {
    title: "An admin app to browse and fix the data",
    byHand: "A second front end, or a paid admin tool wired to the database.",
    vantage: "The desktop app, from the same YAML: 16 pages and a menu.",
  },
  {
    title: "Local, CI and production settings",
    byHand: "A config loader and per-environment secret handling.",
    vantage: "Three profiles in application.yaml; one datasource file reads them.",
  },
  {
    title: "Serving the web app",
    byHand: "Static hosting, deep-link fallback, cache headers, and a proxy to the API.",
    vantage: "The API serves the built app on its own origin; deep links fall back to index.html.",
  },
  {
    title: "The development loop",
    byHand: "Node on the machine, a watcher, a dev proxy, reloading the tab by hand.",
    vantage: "A dev container rebuilds on every save and reloads the open tab.",
  },
  {
    title: "Changing the API under open pages",
    byHand: "Version the API, or open pages break until they reload.",
    vantage: "The server tells open pages to resync, and they re-open their lists.",
  },
  {
    title: "A dropped connection",
    byHand: "Reconnect with backoff, re-subscribe every list, catch up on what was missed.",
    vantage: "Built into the client; the app only shows a banner while it's down.",
  },
  {
    title: "Deploying it",
    byHand: "Images for the API server and the front end, and a health check that knows the database is up.",
    vantage: "One 24-line Dockerfile on vantage-server, with /v1/ready for the startup probe.",
  },
  {
    title: "The agent checking its own work",
    byHand: "Reading code and screenshots, and guessing what the server did.",
    vantage: "MCP tools to run queries, preview the SQL, read the logs and drive the running app.",
  },
];
