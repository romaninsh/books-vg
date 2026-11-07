# Vantage 1.12.3-main.20261104235512

## `now()` and timestamp columns can't be written to SurrealDB
- **Wanted:** a test runner storing when each test ran (`ran_at`) in a SurrealDB table.
- **Tried:**
  ```rhai
  table("test_result").upsert("test_result:x", #{ name: "x", ran_at: now() });
  ```
  and the same with `` `${now()}` `` into a column declared `type: timestamp`.
- **Happened:** `write failed: … SurrealDB server error (error_code: -32700, server_message:
  "CBOR tag 0 (a datetime as text) is not accepted: send tag 12 [seconds, nanos]")`.
- **Workaround:** column declared `type: string` and the value written as text.

## MCP `run_data_script` runs a stale `kind: script` action after an edit
- **Wanted:** call `actions.run_tests()` from `run_data_script` right after editing
  `action/run-tests.yaml`.
- **Tried:** edited the body, saw `leaf reloaded kind=Action key=run-tests valid=true`, then
  called `actions.run_tests()` several times over ~20 s.
- **Happened:** every MCP call ran the previous body (errors quoted the old line numbers).
  Pressing the page button that calls the same action ran the new body.
- **Workaround:** run it through `ui_interact` on the button.

## No table-level validation that runs on the desktop
- **Wanted:** business rules for a chart of accounts kept in the table YAML, not the
  database: a primary nominal (no `parent`) can't be deleted; a sub-nominal can be deleted
  only when no document posts to it and it has no children; a sub-nominal can move only
  under a parent with the same primary code.
- **Tried:** a datasource rule `script:` with `table.before_delete(|id, row| …)` and
  `table.before_update(|record, stored| …)` (vantage-queries multi-tenant.md, "Rule scripts").
- **Happened:** documented, not run: "The desktop's own session matches the default
  exception, which skips the script: the desktop has no write checks." The desktop is where
  this app is used, so the rules would guard nothing there. A hook also "can't reach another
  table", so it can't count the documents posting to a nominal or look up the new parent of
  a move.
- **How it should work:** validation is a data rule, not access control, so it should hold
  for every caller, the desktop included, and no exception should lift it. Something like a
  table-level block:
  ```yaml
  # table/nominal.yaml
  validate:
    before_delete: |
      if row.parent == () { throw `“${row.path}” is a primary nominal and can't be deleted` }
      if table("misc").where("nominal", id).count() > 0 { throw `“${row.path}” has transactions` }
    before_update: |
      if record.parent != stored.parent &&
         table("nominal").get(record.parent).root_code != stored.root_code {
        throw "a sub-nominal can't move to another primary nominal"
      }
  ```
  run for pages, forms, tree drags, scripts, MCP and the API alike, with read access to the
  catalog (`table(…)`), refusing with the thrown message.
- **Workaround:** the rules are SurrealDB events (`DEFINE EVENT … THROW`) for now.

## Rows deleted outside the app stay in the page cache
- **Wanted:** the Nominals page to show the 41 nominals in the database.
- **Tried:** reloaded the database from a script (`DELETE nominal;` then `CREATE …` in one
  transaction) while the page was open.
- **Happened:** the tree and binder kept 5 rows the database no longer has ("46 loaded");
  rows that changed did update. Reopening the page didn't drop them.
- **Workaround:** the binder's Refresh button.

## A long-running page button action shows no sign that it is running
- **Wanted:** a "Run all tests" button calling a `kind: script` action (no `state:`, so no
  run sheet) that takes ~2 minutes.
- **Happened:** the log says `button action ran button=run` immediately; then nothing for
  two minutes: no spinner, no disabled button, no log line, so it looks like the action
  failed silently. It finished and wrote its results 2.5 minutes later. Pressing again
  meanwhile starts a second, overlapping run.
- **Wanted instead:** a busy state on the button (or a small toast "running…") while its
  body runs, and the button disabled until it ends. A `state:` run sheet is the only
  indicator today, and it stays open after the run.
- **Workaround:** none; wait for the results grid to update.

## Generated client schema doesn't type-check with a `keys:` relation
- **Wanted:** an API entity over a table with `lines: { table: invoice_line, kind: has_many, keys: { doc: doc } }`.
- **Happened:** `vantage.gen.ts` emits `hasMany: { lines: { table: "invoice_lines", foreignKey: null } }`;
  `createVantage<Schema>({ schema })` then fails `tsc`: `Type 'null' is not assignable to type 'string'`
  (`SchemaMeta.tables[*].hasMany[*].foreignKey`).
- **Workaround:** cast the schema in `createVantage`.

## An API can't traverse a `keys:` relation, and hidden columns never reach the client
- **Wanted:** the web app opening an invoice's lines and allocations, both linked to the
  invoice's *document* (`invoice.doc`), not to the invoice row.
- **Tried:** `lines: { table: invoice_line, kind: has_many, keys: { doc: doc } }` on the
  table, then `invoice.lines` on the client model (the generated model offers it).
- **Happened:** `refused … reason: "`sales_invoices.payments` has no foreign_key"`. And the
  `doc` column, flagged `hidden` so desktop grids don't show it, is left out of the records
  the API sends (it isn't in `SalesInvoicesFields`), so `where({ doc: invoice.doc })` sent
  `["doc","eq",null]`.
- **Workaround:** `doc` unhidden on the table (desktop pages list their columns anyway),
  and the page filters lines and allocations by `doc` itself. A page-level "don't show"
  separate from an API-level "don't send" would avoid this.

## A window past the last row never settles the count
- **Wanted:** a virtualised list that jumps straight to the end (End key / dragging the
  scrollbar) before the total is known.
- **Happened:** the first window over 263 rows reported `length: 400, lengthExact: false`.
  Asking for a window starting at 350 came back settled with no items and the count stayed
  inexact ("263+"), so the list showed placeholders forever.
- **Workaround:** the page never asks for a window starting past `length − count/2`, and
  steps back when a settled window comes back empty.

## A `base:` query table can't declare its own `references:`
- **Wanted:** a trial balance (`surreal: { base: nominal_sheet }`, grouped) with a
  `nominal` column linking to the `nominal` table.
- **Tried:** `nominal: { type: string, references: nominal }` on the derived table.
- **Happened:** `vantage rejected spec for 'trial_balance': spec reference is absent from the
  built table's references (relation: "nominal", table: "trial_balance")`. The same column on
  a `rhai:`-only query table works.
- **Workaround:** plain string column, no relation.

## The audit logger can't write `at` into SurrealDB
- **Wanted:** `log_changes: { into: audit_event }` on a `surreal-db` log table with the
  conventional `at` column.
- **Happened:** every entry failed: ``audit entry not written … SurrealDB server error: "CBOR
  tag 0 (a datetime as text) is not accepted: send tag 12 [seconds, nanos]"``, whether `at`
  was declared `timestamp` or `string`. The change itself saved. Same root cause as the
  `now()` write above.
- **Workaround:** the log table declares no `at`; SurrealDB stamps
  `logged_at` (`DEFAULT time::now() READONLY`, tests/schema.surql).

## Audit context column spells the same record id two ways
- **Wanted:** one document's history as `where("doc", id)` (`audit_event.doc references doc`).
- **Happened:** a change of the `doc` row itself fills `doc = "doc:01a1a999-fd7a-…"`, but a
  change of an `invoice` or `invoice_line` row pointing at it fills
  ``doc = "doc:`01a1a999-fd7a-…`"`` (SurrealDB's escaped form). Seeded ids without dashes
  (`doc:s00397`) look the same either way, so it only shows on new, UUID ids.
- **Workaround:** the web app asks for both spellings (`where({ doc: [plain, escaped] })`).

## A run message too large drops the connection, and the client resends it forever
- **Wanted:** attach files to an invoice: `db.run.save_invoice.start({ …, add_files: [{ data }] })`
  with two 3 MB files (about 8 MB of base64).
- **Happened:** the server closed the socket on that frame with no `error` frame and nothing
  in the `api:books` feed but connect/disconnect lines. The client reconnected and, as it
  does for an unanswered `start`, sent the same frame again: a connect/disconnect loop about
  five times a second that stopped only when the page reloaded. The run never failed, so the
  page showed "Saving…" forever. The WebSocket message limit isn't documented (REST answers
  413 over 1 MiB).
- **Would help:** a documented limit, an `error` frame naming it (`code: too_large`) that
  fails the run, and the client refusing to send a frame over the limit.
- **Workaround:** files travel in 256 KB pieces through `action/stage-file.yaml`;
  `save-invoice` joins them inside its transaction.
