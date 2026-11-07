# The Books web app (web/books)

A keyboard-first bookkeeping front end over the Vantage API `api/books.yaml`. The familiar
structure of online accounting software, with lists that open in place, drafts that never get lost, and saves
that never block.

## What's there

| Section | Pages |
|---|---|
| Sales | Invoices (with the payment / credit flip), Payments received, Customers |
| Purchases | Invoices, Payments made, Suppliers |
| Accounts | Misc payments and lodgements, Bank accounts (balance, latest movements), Nominals (tree) |
| Reports | Profit and loss, Balance sheet (financial years), Trial balance, Nominal ledger, Aged debtors / creditors |
| Setup | Company (name, financial year start, address and VAT number for printing) |

A browser session opens on a splash (`src/shell/Splash.tsx`): "Books. Sorted.", a demo built
with VantageUI 1.13.3, and
how it was built, in measured numbers kept in `src/about.ts`. Refresh them with
`scripts/session_stats.py <session log>` and the file and test counts; never by hand.
"About this demo" in the shortcuts overlay (?) opens it again.

Everywhere: ⌘K search, ⌘J activity (this page / everything), D drafts (this page /
everything), ? shortcuts, toasts for outcomes, a banner while the connection is down.

## How it works

- **Lists** (`src/lists/DataList.tsx`): the server sorts, filters and pages; the list reads a
  window around what is on screen. Columns fill the width and give way in a set order on
  narrow windows. A row opens in place. The open record (row and editor together) never
  leaves the screen: scrolled past, it docks under the header; scrolled above, it waits at
  the bottom edge (`dock` in DataList; its list item is always drawn). Other unsaved rows
  pin to the top or bottom edge as compact rows.
  Rows changed by someone else flash amber and keep a dot until opened. `?q=` starts a list
  filtered (search and links use it so the target row is loaded).
- **Drafts** (`src/editor/store.ts`): every edit lives in a draft in IndexedDB, one entry
  per draft, shared live between tabs (BroadcastChannel). New records open under the cursor
  row; a duplicate sits next to its original.
- **Saves** (`src/editor/save.ts`): one atomic action per business operation, started as a
  run with the draft's own id (a retry or reload attaches instead of saving twice). Files go
  first in 256 KB pieces (`stage-file`), joined inside the invoice's transaction.
- **Actions** (`action/`): `save-invoice`, `save-payment`, `save-contact`, `save-misc`,
  `save-nominal`, `save-bank-account`, `save-company`, `delete-doc`, `delete-contact`,
  `delete-nominal`, `stage-file`. Each validates first and reports field problems as
  `FIELDS:{json}`; database rules (nominals) refuse with their own message.
- **Audit**: `application.yaml` logs every change and run into `audit_event` (file contents
  excluded); the Activity panel reads it through the API.
- **Reports** read query tables derived from the documents on every read: `trial_balance`,
  `nominal_sheet` (ledger), `nominal_month` (P&L and balance sheet by financial year),
  `aged_debt`. Nothing is stored.

## Checking it

- `web_run npm run build`: type-checks the app and the e2e tests, then builds.
- `web_run npm test`: unit tests of the pure rules (money, dates, errors, columns, URLs).
- `web_run npx playwright test` (container started with `playwright: true`): 21 end-to-end
  tests against the real API. They never write: `e2e/fixtures.ts` holds back every write
  frame and fails the test that sent it.
- Desktop: Tests pages (ledger, documents, nominals, source reconciliation).

## Known limits

- Single currency (GBP); see `docs/decisions.md`.
- Opening a record by link loads it only if its row is in the loaded window; links from
  search, activity and reports add `?q=` so it is.
- Lists re-read every 5–10 s (`refresh:` in the API): SurrealDB tables have no live feed.
- No sign-in: the local profile serves the API with `auth: none` on the loopback. A deployed
  profile needs `auth: session` (vantage-api) before this leaves the machine.
- Vantage issues found on the way, with workarounds, are in `FEEDBACK.md`.
