-- The books' schema. Idempotent: tests/load.sh applies it (or tests/surql.sh tests/schema.surql)
-- Model: every money movement is a `doc`; each kind adds its own
-- extension table linked by `doc`. The ledger is never stored: table/nominal_sheet.yaml
-- derives balanced postings from documents on every read.

-- Chart of accounts. Primary (top-level) nominals carry the code that identifies them;
-- sub-nominals point at a parent and live inside their primary nominal's tree.
-- Rules (events below):
--   * a primary nominal can't be deleted, nor moved under another nominal
--   * a sub-nominal can be deleted only when nothing posts to it and it has no children
--   * a sub-nominal can move anywhere inside its primary nominal's tree, not into another
-- A sub-nominal takes type and B/P from its parent, and its code too unless it has its own.
-- Fields without TYPE: forms send text/empty values and TYPE is checked before VALUE.
DEFINE TABLE IF NOT EXISTS nominal SCHEMAFULL;
DEFINE FIELD OVERWRITE parent ON nominal TYPE option<record<nominal>>;
DEFINE FIELD OVERWRITE name   ON nominal TYPE string;
DEFINE FIELD OVERWRITE rank   ON nominal TYPE option<int>;
DEFINE FIELD OVERWRITE code   ON nominal
  VALUE IF ($value = NONE OR $value = "") AND parent != NONE THEN parent.code ELSE $value END
  ASSERT type::is_string($value) AND $value != "";
DEFINE FIELD OVERWRITE type   ON nominal
  VALUE IF parent != NONE THEN parent.type ELSE $value END
  ASSERT $value IN [
  "Fixed asset", "Current asset", "Current liability", "Long term liability",
  "Capital & Reserves", "Income", "Cost of Sales", "Expense", "Other expense",
  "Other income", "Taxation"];
DEFINE FIELD OVERWRITE bp     ON nominal
  VALUE IF parent != NONE THEN parent.bp ELSE $value END
  ASSERT $value IN ["B", "P"];
DEFINE FIELD OVERWRITE path   ON nominal
  VALUE IF parent != NONE THEN parent.path + ":" + name ELSE name END;
DEFINE INDEX IF NOT EXISTS nominal_code ON nominal FIELDS code;
DEFINE INDEX IF NOT EXISTS nominal_parent ON nominal FIELDS parent;

-- The nominal and its ancestors, nearest first (depth-capped so a cycle can't loop).
DEFINE FUNCTION OVERWRITE fn::nominal_chain($n: option<record<nominal>>, $depth: int) -> array {
  RETURN IF $n = NONE OR $depth > 20 THEN [] ELSE array::concat([$n], fn::nominal_chain($n.parent, $depth + 1)) END;
};
-- The primary nominal carrying a code (banks and invoice control postings find theirs so).
DEFINE FUNCTION OVERWRITE fn::nominal_by_code($code: string) -> option<record<nominal>> {
  RETURN (SELECT VALUE id FROM nominal WHERE code = $code AND parent = NONE LIMIT 1)[0];
};
-- The primary nominal a nominal belongs to.
DEFINE FUNCTION OVERWRITE fn::nominal_root($n: record<nominal>) -> record<nominal> {
  RETURN array::last(fn::nominal_chain($n, 0));
};
-- How many postings a nominal gets from documents (extend as document kinds are added).
-- A primary nominal also gets the postings it receives by code: the bank side of every bank
-- account carrying its code, and the control postings of invoices (Debtors 14000 for
-- sales, Creditors 21000 for purchases, VAT 23000 per line with VAT).
DEFINE FUNCTION OVERWRITE fn::nominal_usage($n: record<nominal>) -> int {
  LET $direct = count(SELECT id FROM misc WHERE nominal = $n)
    + count(SELECT id FROM invoice_line WHERE nominal = $n);
  IF $n.parent != NONE { RETURN $direct; };
  LET $banks = count(SELECT id FROM misc WHERE bank_account.code = $n.code)
    + count(SELECT id FROM payment WHERE bank_account.code = $n.code);
  LET $control = IF $n.code = "14000" THEN count(SELECT id FROM invoice WHERE doc.type = "sale")
      + count(SELECT id FROM payment WHERE doc.type = "lodgement")
    ELSE IF $n.code = "21000" THEN count(SELECT id FROM invoice WHERE doc.type = "purchase")
      + count(SELECT id FROM payment WHERE doc.type = "payment")
    ELSE IF $n.code = "23000" THEN count(SELECT id FROM invoice_line WHERE vat != 0)
    ELSE 0 END;
  RETURN $direct + $banks + $control;
};

DEFINE EVENT OVERWRITE nominal_delete ON TABLE nominal WHEN $event = "DELETE" THEN {
  IF $before.parent = NONE {
    THROW "“" + $before.path + "” is a primary nominal (" + $before.code + ") and can't be deleted";
  };
  IF count(SELECT id FROM nominal WHERE parent = $before.id) > 0 {
    THROW "“" + $before.path + "” has sub-nominals; delete or move them first";
  };
  LET $used = fn::nominal_usage($before.id);
  IF $used > 0 {
    THROW "“" + $before.path + "” has " + <string>$used + " transactions and can't be deleted";
  };
};

DEFINE EVENT OVERWRITE nominal_move ON TABLE nominal
  WHEN $event = "UPDATE" AND $before.parent != $after.parent THEN {
  IF $before.parent = NONE {
    THROW "“" + $before.path + "” is a primary nominal and can't be moved under another nominal";
  };
  IF $after.parent = NONE {
    THROW "“" + $before.path + "” can't become a primary nominal";
  };
  IF fn::nominal_chain($after.parent, 0) CONTAINS $after.id {
    THROW "“" + $before.path + "” can't move under its own sub-nominal";
  };
  LET $from = fn::nominal_root($before.parent);
  LET $to = fn::nominal_root($after.parent);
  IF $from != $to {
    THROW "“" + $before.path + "” belongs to " + $from.path + " (" + $from.code + ") and can't move under "
      + $to.path + " (" + $to.code + ")";
  };
};

-- A changed path, type or B/P flows down to the sub-nominals (their VALUE clauses recompute).
-- Events run in name order: this must sort after nominal_move, whose checks stop cycles.
REMOVE EVENT IF EXISTS nominal_cascade ON nominal;
DEFINE EVENT OVERWRITE nominal_update_children ON TABLE nominal
  WHEN $event = "UPDATE" AND ($before.path != $after.path OR $before.type != $after.type OR $before.bp != $after.bp) THEN {
  UPDATE nominal SET name = name WHERE parent = $after.id;
};

-- Bank accounts (credit card and directors loan count as banks). A bank stores only its
-- nominal code (15000 Bank accounts, 25000 Credit card, 27000 Term Loan); postings go to
-- the top-level nominal with that code, and the bank itself is a separate dimension.
DEFINE TABLE IF NOT EXISTS bank_account SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON bank_account TYPE string;
DEFINE FIELD IF NOT EXISTS code ON bank_account TYPE string;
REMOVE FIELD IF EXISTS nominal ON bank_account;

-- Common document. `total` is the gross amount in base currency (GBP) in the direction the
-- type says (a misc payment of 10 takes 10 out of the bank); negative = a reversal/refund.
-- Invoices (sale / purchase) leave `total` empty: their amounts are computed from lines.
DEFINE TABLE IF NOT EXISTS doc SCHEMAFULL;
DEFINE FIELD OVERWRITE type            ON doc TYPE string
  ASSERT $value IN ["misc_payment", "misc_lodgement", "sale", "purchase", "lodgement", "payment"];
-- Single currency (GBP). Foreign currency needs an FX-difference nominal and historic
-- rates: out of scope for now (docs/decisions.md).
REMOVE FIELD IF EXISTS currency ON doc;
REMOVE FIELD IF EXISTS exchange_rate ON doc;
-- Forms send dates as text ("2026-11-05"): no TYPE (it is checked before VALUE), cast in
-- VALUE, then insist on a datetime.
DEFINE FIELD OVERWRITE date            ON doc VALUE <datetime>$value ASSERT type::is_datetime($value);
DEFINE FIELD IF NOT EXISTS reference   ON doc TYPE option<string>;
DEFINE FIELD IF NOT EXISTS contact_name ON doc TYPE option<string>;
DEFINE FIELD IF NOT EXISTS description ON doc TYPE option<string>;
DEFINE FIELD OVERWRITE total           ON doc TYPE option<float>;
DEFINE INDEX IF NOT EXISTS doc_date ON doc FIELDS date;

-- Customers and suppliers.
DEFINE TABLE IF NOT EXISTS contact SCHEMAFULL;
DEFINE FIELD OVERWRITE type           ON contact TYPE string ASSERT $value IN ["client", "supplier"];
DEFINE FIELD OVERWRITE name           ON contact TYPE string;
DEFINE FIELD OVERWRITE contact_name   ON contact TYPE option<string>;
DEFINE FIELD OVERWRITE email          ON contact TYPE option<string>;
DEFINE FIELD OVERWRITE telephone      ON contact TYPE option<string>;
DEFINE FIELD OVERWRITE address        ON contact TYPE option<string>;
DEFINE FIELD OVERWRITE city           ON contact TYPE option<string>;
DEFINE FIELD OVERWRITE county         ON contact TYPE option<string>;
DEFINE FIELD OVERWRITE country        ON contact TYPE option<string>;
DEFINE FIELD OVERWRITE currency       ON contact TYPE string DEFAULT "GBP";
DEFINE FIELD OVERWRITE vat_registered ON contact TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE vat_no         ON contact TYPE option<string>;
DEFINE FIELD OVERWRITE credit_terms   ON contact TYPE int DEFAULT 30;
DEFINE FIELD OVERWRITE note           ON contact TYPE option<string>;
DEFINE INDEX IF NOT EXISTS contact_type ON contact FIELDS type;

-- Sales and purchase invoices: the extension of a `doc` of type sale / purchase.
-- Totals are never stored: the table YAML works them out from lines and allocations, only
-- in the columns that show them. (COMPUTED fields were tried and dropped: a
-- read of one evaluates them all, chained ones repeatedly — 1.5 s for 408 invoices — and
-- they stop SurrealDB serving live queries on the table.)
DEFINE TABLE IF NOT EXISTS invoice SCHEMAFULL;
DEFINE FIELD OVERWRITE doc      ON invoice TYPE record<doc> REFERENCE;
DEFINE FIELD OVERWRITE contact  ON invoice TYPE record<contact>;
DEFINE FIELD OVERWRITE number   ON invoice TYPE option<string>;
DEFINE FIELD OVERWRITE due_date ON invoice VALUE IF $value = NONE OR $value = "" THEN NONE ELSE <datetime>$value END;
REMOVE FIELD IF EXISTS net ON invoice;
REMOVE FIELD IF EXISTS vat ON invoice;
REMOVE FIELD IF EXISTS gross ON invoice;
REMOVE FIELD IF EXISTS gross_base ON invoice;
REMOVE FIELD IF EXISTS paid ON invoice;
REMOVE FIELD IF EXISTS amount_due ON invoice;
REMOVE FIELD IF EXISTS status ON invoice;
DEFINE INDEX IF NOT EXISTS invoice_doc ON invoice FIELDS doc UNIQUE;
DEFINE INDEX IF NOT EXISTS invoice_contact ON invoice FIELDS contact;

-- Lodgements (money in from a customer) and payments (money out to a supplier): the
-- extension of a `doc` of type lodgement / payment. doc.total is the amount.
DEFINE TABLE IF NOT EXISTS payment SCHEMAFULL;
DEFINE FIELD OVERWRITE doc          ON payment TYPE record<doc> REFERENCE;
DEFINE FIELD OVERWRITE bank_account ON payment TYPE record<bank_account>;
DEFINE FIELD OVERWRITE contact      ON payment TYPE record<contact>;
REMOVE FIELD IF EXISTS allocated ON payment;
REMOVE FIELD IF EXISTS unallocated ON payment;
DEFINE INDEX IF NOT EXISTS payment_doc ON payment FIELDS doc UNIQUE;
DEFINE INDEX IF NOT EXISTS payment_contact ON payment FIELDS contact;

-- Which invoice a payment (or part of it) settles. Both sides are documents: `payment` is
-- the settling document (a lodgement/payment, or a credit note = negative invoice).
DEFINE TABLE IF NOT EXISTS allocation SCHEMAFULL;
DEFINE FIELD OVERWRITE payment ON allocation TYPE record<doc> REFERENCE;
DEFINE FIELD OVERWRITE invoice ON allocation TYPE record<doc> REFERENCE;
DEFINE FIELD OVERWRITE amount  ON allocation TYPE float;
REMOVE FIELD IF EXISTS invoice_row ON allocation;
REMOVE FIELD IF EXISTS payment_row ON allocation;
DEFINE INDEX IF NOT EXISTS allocation_payment ON allocation FIELDS payment;
DEFINE INDEX IF NOT EXISTS allocation_invoice ON allocation FIELDS invoice;

-- Invoice lines. net = quantity × price rounded to pence. VAT is an amount (defaults from
-- the rate on the form) because reverse-charge lines carry a rate but no VAT.
DEFINE TABLE IF NOT EXISTS invoice_line SCHEMAFULL;
DEFINE FIELD OVERWRITE doc         ON invoice_line TYPE record<doc> REFERENCE;
DEFINE FIELD OVERWRITE rank        ON invoice_line TYPE option<int>;
DEFINE FIELD OVERWRITE description ON invoice_line TYPE option<string>;
DEFINE FIELD OVERWRITE nominal     ON invoice_line TYPE record<nominal>;
DEFINE FIELD OVERWRITE quantity    ON invoice_line TYPE float DEFAULT 1.0;
DEFINE FIELD OVERWRITE price       ON invoice_line TYPE float;
DEFINE FIELD OVERWRITE vat_rate    ON invoice_line TYPE float DEFAULT 0.0;
DEFINE FIELD OVERWRITE vat         ON invoice_line TYPE float DEFAULT 0.0;
REMOVE FIELD IF EXISTS net ON invoice_line;
REMOVE FIELD IF EXISTS gross ON invoice_line;
REMOVE FIELD IF EXISTS invoice ON invoice_line;
REMOVE FIELD IF EXISTS net_base ON invoice_line;
REMOVE FIELD IF EXISTS vat_base ON invoice_line;
DEFINE INDEX IF NOT EXISTS invoice_line_doc ON invoice_line FIELDS doc;
DEFINE INDEX IF NOT EXISTS invoice_line_nominal ON invoice_line FIELDS nominal;

-- Invoice / payment / contact totals are inline expressions in the table YAML (expr:
-- columns): a query inside a function filters on a parameter, which skips the index
-- (~15× slower than the same subquery on $parent).
REMOVE FUNCTION IF EXISTS fn::invoice_totals;
REMOVE FUNCTION IF EXISTS fn::payment_totals;
REMOVE FUNCTION IF EXISTS fn::contact_outstanding;

-- Misc payment / misc lodgement: no customer or supplier, nominal chosen by hand.
DEFINE TABLE IF NOT EXISTS misc SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS doc          ON misc TYPE record<doc> REFERENCE;
DEFINE FIELD IF NOT EXISTS bank_account ON misc TYPE record<bank_account>;
DEFINE FIELD IF NOT EXISTS nominal      ON misc TYPE record<nominal>;
DEFINE INDEX IF NOT EXISTS misc_doc ON misc FIELDS doc UNIQUE;

-- The company: one row, company:main. Its financial year starts on the 1st of
-- fy_start_month (1 = January); reports group years by it.
DEFINE TABLE IF NOT EXISTS company SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name           ON company TYPE string;
DEFINE FIELD IF NOT EXISTS fy_start_month ON company TYPE int DEFAULT 1 ASSERT $value >= 1 AND $value <= 12;
DEFINE FIELD IF NOT EXISTS vat_no         ON company TYPE option<string>;
DEFINE FIELD IF NOT EXISTS address        ON company TYPE option<string>;
DEFINE FIELD IF NOT EXISTS email          ON company TYPE option<string>;
UPSERT company:main MERGE { name: name ?? "Books Sorted Ltd", fy_start_month: fy_start_month ?? 1 };

-- Results of the in-app test runner (action/run-tests.yaml), one row per test.
DEFINE TABLE IF NOT EXISTS test_result SCHEMALESS;

-- The audit log (application.yaml log_changes / log_events). Only Vantage writes it.
-- `doc` tags every change with its document, so one document's history is one filter.
-- The time is stamped here, not by Vantage: its `at` arrives as a CBOR datetime SurrealDB
-- refuses (FEEDBACK.md), so the log table declares no `at` and the database fills logged_at.
DEFINE TABLE IF NOT EXISTS audit_event SCHEMALESS;
DEFINE FIELD OVERWRITE logged_at ON audit_event TYPE datetime DEFAULT time::now() READONLY;
DEFINE INDEX OVERWRITE audit_event_logged_at ON audit_event FIELDS logged_at;
DEFINE INDEX IF NOT EXISTS audit_event_doc ON audit_event FIELDS doc;

-- Files attached to a document (receipts, the supplier's PDF), saved with the invoice by
-- action/save-invoice.yaml. The content is base64 text: Vantage has no file storage.
DEFINE TABLE IF NOT EXISTS attachment SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS doc      ON attachment TYPE record<doc> REFERENCE;
DEFINE FIELD IF NOT EXISTS name     ON attachment TYPE string;
DEFINE FIELD IF NOT EXISTS mime     ON attachment TYPE string;
DEFINE FIELD IF NOT EXISTS size     ON attachment TYPE int;
DEFINE FIELD IF NOT EXISTS data     ON attachment TYPE string;
DEFINE FIELD IF NOT EXISTS added_at ON attachment TYPE datetime DEFAULT time::now() READONLY;
DEFINE INDEX IF NOT EXISTS attachment_doc ON attachment FIELDS doc;
-- A file on its way: the web app sends it in pieces (action/stage-file.yaml), each well under
-- the API's message size; save-invoice joins them into an attachment and deletes them.
DEFINE TABLE IF NOT EXISTS file_chunk SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS upload   ON file_chunk TYPE string;
DEFINE FIELD IF NOT EXISTS seq      ON file_chunk TYPE int;
DEFINE FIELD IF NOT EXISTS data     ON file_chunk TYPE string;
DEFINE FIELD IF NOT EXISTS added_at ON file_chunk TYPE datetime DEFAULT time::now() READONLY;
DEFINE INDEX IF NOT EXISTS file_chunk_upload ON file_chunk FIELDS upload;

-- Deleting the extension row deletes its document, and the other way round.
DEFINE EVENT OVERWRITE misc_delete ON TABLE misc WHEN $event = "DELETE" THEN {
  DELETE $before.doc;
};
DEFINE EVENT OVERWRITE invoice_delete ON TABLE invoice WHEN $event = "DELETE" THEN {
  DELETE $before.doc;
};
DEFINE EVENT OVERWRITE payment_delete ON TABLE payment WHEN $event = "DELETE" THEN {
  DELETE $before.doc;
};
DEFINE EVENT OVERWRITE doc_delete ON TABLE doc WHEN $event = "DELETE" THEN {
  DELETE misc WHERE doc = $before.id;
  DELETE invoice WHERE doc = $before.id;
  DELETE invoice_line WHERE doc = $before.id;
  DELETE payment WHERE doc = $before.id;
  DELETE allocation WHERE payment = $before.id OR invoice = $before.id;
  DELETE attachment WHERE doc = $before.id;
};
-- Touches. Lists show totals worked out from other tables (an invoice's from its lines and
-- allocations, a contact's outstanding balance, a bank account's balance), but a live update
-- fires only for a row's own write. So a change to the rows a total is made of touches the row
-- that shows it. A touch must change a value: `SET doc = doc` changes nothing, and no live
-- update goes out (measured 2026-11-07), so it stamps `touched_at`. The web app's API doesn't
-- poll these tables; these touches are what keep them current.
DEFINE FIELD IF NOT EXISTS touched_at ON invoice TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS touched_at ON payment TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS touched_at ON misc TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS touched_at ON contact TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS touched_at ON bank_account TYPE option<datetime>;
-- A document's date, reference or total shows on its extension row.
DEFINE EVENT OVERWRITE doc_touch ON TABLE doc WHEN $event = "UPDATE" THEN {
  UPDATE misc SET touched_at = time::now() WHERE doc = $after.id;
  UPDATE invoice SET touched_at = time::now() WHERE doc = $after.id;
  UPDATE payment SET touched_at = time::now() WHERE doc = $after.id;
};
-- An allocation changes both sides' paid / due.
DEFINE EVENT OVERWRITE allocation_touch ON TABLE allocation THEN {
  LET $a = IF $event = "DELETE" THEN $before ELSE $after END;
  UPDATE invoice SET touched_at = time::now() WHERE doc = $a.invoice;
  UPDATE payment SET touched_at = time::now() WHERE doc = $a.payment;
};
-- Lines make the invoice's totals.
DEFINE EVENT OVERWRITE invoice_line_touch ON TABLE invoice_line THEN {
  UPDATE invoice SET touched_at = time::now() WHERE doc = (IF $event = "DELETE" THEN $before.doc ELSE $after.doc END);
};
-- Invoices and payments make a contact's outstanding balance; payments and misc entries a bank
-- account's balance. Before and after: a re-assigned row changes both sides. Line and allocation
-- writes reach these through the touches above.
DEFINE EVENT OVERWRITE invoice_contact_touch ON TABLE invoice THEN {
  UPDATE contact SET touched_at = time::now() WHERE id IN [$before.contact, $after.contact];
};
DEFINE EVENT OVERWRITE payment_touch ON TABLE payment THEN {
  UPDATE contact SET touched_at = time::now() WHERE id IN [$before.contact, $after.contact];
  UPDATE bank_account SET touched_at = time::now() WHERE id IN [$before.bank_account, $after.bank_account];
};
DEFINE EVENT OVERWRITE misc_touch ON TABLE misc THEN {
  UPDATE bank_account SET touched_at = time::now() WHERE id IN [$before.bank_account, $after.bank_account];
};
