# Books. Sorted.

Small-business bookkeeping that feels like typical accounting software, but keyboard-first and
live: sales and purchase invoices, payments and allocations, bank accounts, a chart of
accounts and the reports an accountant asks for. It was built with
[Vantage UI](https://www.vantage-ui.com/) by its LLM agent from a real company's books (2016–2022), with every name anonymised and
every amount kept. The repository carries a six-month sample of them (`tests/sample.surql`:
October 2018 to March 2019, 241 documents).

**Live demo: https://books-vg-129027965449.europe-west2.run.app**

> The demo has no sign-in, so anyone with the link can read the books and change them. The
> names are fictional; treat everything in it as sample data.

## What's in it

| Area | What you can do |
|---|---|
| Sales, Purchases | Invoices and credit notes with lines, VAT and attachments. Edit in place: the row opens into an editor, Save or Save & new. Flip an invoice like a cheque book to record its payment or a credit |
| Payments | Money received and paid, allocated to invoices |
| Contacts | Customers and suppliers, with what each owes |
| Accounts | Bank accounts and their movements, misc payments and lodgements, the nominal tree (rename, add, move, delete; the database refuses what would break the books) |
| Reports | Profit and loss, balance sheet, trial balance, nominal ledger, aged debtors and creditors |
| Everywhere | ⌘K searches every document, Drafts keeps unsaved work across reloads and tabs, Activity shows what changed and who changed it, `?` lists the shortcuts |

Drafts and the record being edited stay on screen while the list scrolls, and each row shows
its state (editing, draft, saving, saved, failed). The ledger is never stored: it is derived
from the documents on every read, so it always balances.

The bookkeeping rules live in the database (`tests/schema.surql`): primary nominals can't be
deleted, a nominal with transactions can't be deleted, a sub-nominal stays under its primary,
and deleting a document takes its lines, allocations and attachments with it.
`tests/invariants.sh` checks them and the data's own totals.

## How it fits together

- **The app** is a Vantage project: tables, pages and actions in YAML. The desktop app runs
  from the same folder.
- **The web app** (`web/books/`) is React on `@vantage-ui/client`, talking to `api/books.yaml`
  over a WebSocket. Every write is an action (`action/`).
- **In production** it runs on `vantage-server` as the Cloud Run service `books-vg`, which
  serves the web app and the WebSocket API.
- **SurrealDB** holds the books and the rules, so they hold for every client.

## Layout

| Path | What |
|---|---|
| `application.yaml` | App settings, audit trail and profiles: `local` (desktop), `ci` (checks), `prod` (deployed) |
| `datasource/` | The SurrealDB connection. Its URL comes from `SECRET_SURREAL_URL` |
| `table/` | Tables, columns, references, the derived ledger and the reports |
| `page/`, `menu/`, `form/`, `view/`, `layout/` | Desktop app |
| `action/` | Every write the web app makes: save and delete invoices, payments, contacts, nominals |
| `api/books.yaml` | The API the web app uses |
| `web/books/` | The web app (React, Vite, Tailwind, `@vantage-ui/client`), with unit and Playwright tests |
| `tests/` | Schema, the sample books, loader, invariants, WebSocket probe, prod env generator |
| `scripts/` | How the sample was cut, and how the splash screen's numbers were measured |
| `docs/` | Data model, decisions, notes on the web app |
| `FEEDBACK.md` | Limits we hit in Vantage and SurrealDB |
| `terraform/` | Deploy identity, secret and Cloud Run service (applied from `vantage-terraform`) |

## Running it locally

1. Open the folder in Vantage. It starts SurrealDB from `composer.yaml` (copy `.env.example`
   to `.env` first).
2. Load the schema and the sample books with `tests/load.sh`, then check them with
   `tests/invariants.sh`.
3. Vantage serves `api/books.yaml` locally. Start the web app from the Services panel to open
   it in a browser.

## Deploying

Every push to `main` that touches the app runs `.github/workflows/deploy-books.yaml`. It
builds the image from the `Dockerfile` (the API and the built web app on `vantage-server`),
pushes it to Artifact Registry and deploys it to the Cloud Run service `books-vg` in
`europe-west2`, then smoke-tests the URL over HTTP and the WebSocket. The workflow signs in
to Google Cloud through Workload Identity Federation, and only from a protected `main`, so
the repository holds no keys.

Pull requests run `.github/workflows/checks.yaml`. It type-checks, tests and builds the web
app and lints the workflows. It also starts a throwaway SurrealDB, loads the schema and the
sample, checks the rules, and runs the API on `vantage-server` with the `ci` profile.

Production data is in SurrealDB Cloud (namespace `books`, database `books`). Its connection
URL is the Secret Manager secret `books-vg-surreal-url`. `tests/make_prod_env.py` writes
`.env.prod` and `private/cloud.env` from it, and `tests/load_cloud.sh` loads the books there.
