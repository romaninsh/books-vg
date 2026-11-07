# Decisions and parked work

## Validations belong in table YAML, not SurrealDB (parked, 2026-11-05)

The user prefers business rules in the Vantage table files. Vantage can't do that yet:
datasource rule scripts are skipped for the desktop app and can't read other tables
(reported in FEEDBACK.md, "No table-level validation that runs on the desktop").

Until Vantage fixes it, the nominal rules stay as SurrealDB events in `tests/schema.surql`
(`nominal_delete`, `nominal_move`), checked by the Tests page (tests 10–13):
- a primary nominal can't be deleted or moved under another nominal
- a sub-nominal can be deleted only with no transactions and no sub-nominals
- a sub-nominal moves only inside its own primary nominal (same code); not under itself

When the fix lands: move these into `table/nominal.yaml`, drop the two events, keep the
tests unchanged (they must still pass). Derivations (path, inherited code/type/B/P, the
cascade to sub-nominals) are data, not validation, and may stay in the schema.

## The books are anonymised (2026-11-07)

The data came from a real company's account in typical online accounting software. Customers, suppliers and people are now
fictional look-alikes in the same line of business and country (a San Francisco health-tech
client became Cliniquant, Inc.); every amount, date, nominal and bank account is unchanged,
and the company itself keeps its name. Bank references keep their shape with names swapped
and long numbers (account, customer, policy numbers) scrambled consistently; years stay.

- `scripts/anonymise.py --db` did it (backup first, to `refs/`); `scripts/books_totals.py`
  before and after proved no figure moved.
- The real→fictional map is `refs/anonymise-map.json` (git-ignored: it holds real names).
  With it present, the importer builds an anonymised `tests/seed.surql` (kept local, like the exports; the repository carries the sample cut from it, `tests/sample.surql`), so a
  database reset gives the same books. Without it, the seed would be real again.
- Card spends at chains (Pret, Ryanair, GitHub…), public bodies (HMRC, Companies House) are left
  as they are; the accounting software's own name is replaced.

## Sign convention (proposed, not built)

Store raw signs (debit +, credit −); reports show credit-normal nominals (liabilities,
capital, income) sign-flipped.
