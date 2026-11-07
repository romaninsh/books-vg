#!/usr/bin/env bash
# The books' rules, checked against the live database (after tests/load.sh).
# usage: tests/invariants.sh      (exit code = number of failed checks)
# Target: the same SURREAL_* variables as tests/surql.sh.
# SURREAL_RUNNER=ws goes over the WebSocket instead (tests/surql_ws.mjs; tests/load_cloud.sh sets it).
cd "$(dirname "$0")/.."
FAIL=0
q() { if [ "${SURREAL_RUNNER:-}" = ws ]; then node tests/surql_ws.mjs -f; else tests/surql.sh - -f; fi; }
# check "<name>" "<SurrealQL>" "<expected substring of the output>"
check() {
  local out; out=$(echo "$2" | q 2>&1)
  if [[ "$out" == *"$3"* ]]; then echo "ok   $1"; else echo "FAIL $1 — got: $(echo "$out" | tr '\n' ' ' | cut -c1-300)"; FAIL=$((FAIL+1)); fi
}

# The data's own figures: the anonymiser keeps every amount, so these never move. Which data is
# loaded (tests/load.sh) is told by its document count: the full books or the sample.
docs=$(echo 'RETURN count((SELECT id FROM doc));' | q | sed 's/^#1 OK  //')
case "$docs" in
  1642) ALLOCATED=316807.19 INVOICED=372936.27 ;;  # tests/seed.surql
  241)  ALLOCATED=65424.89 INVOICED=64746.02 ;;    # tests/sample.surql
  *) echo "skip the totals: $docs documents is neither a fresh load of the books (1642) nor the sample (241)" ;;
esac
if [ -n "${ALLOCATED:-}" ]; then
  check "allocations total $ALLOCATED" \
    'RETURN math::fixed(math::sum((SELECT VALUE amount FROM allocation)), 2);' "OK  $ALLOCATED"
  check "invoice lines total $INVOICED" \
    'RETURN math::fixed(math::sum((SELECT VALUE math::fixed(quantity * price, 2) + vat FROM invoice_line)), 2);' "OK  $INVOICED"
fi

check "no payment allocates more than it paid" \
  'RETURN count((SELECT id FROM doc WHERE (type = "lodgement" OR type = "payment") AND math::sum((SELECT VALUE amount FROM allocation WHERE payment = $parent.id)) > total + 0.005));' 'OK  0'
check "no allocation of zero or less" \
  'RETURN count((SELECT id FROM allocation WHERE amount <= 0));' 'OK  0'
check "every invoice has its contact" \
  'RETURN count((SELECT id FROM invoice WHERE contact.id = NONE));' 'OK  0'
check "every invoice line has its nominal" \
  'RETURN count((SELECT id FROM invoice_line WHERE nominal.id = NONE));' 'OK  0'
check "every invoice, payment and misc entry has its document" \
  'RETURN count((SELECT id FROM misc WHERE doc.id = NONE)) + count((SELECT id FROM invoice WHERE doc.id = NONE)) + count((SELECT id FROM payment WHERE doc.id = NONE));' 'OK  0'

# Refusals: each runs in a transaction that is cancelled, so nothing is left behind.
check "a primary nominal can't be deleted" \
  'BEGIN; DELETE nominal:sales; CANCEL;' "is a primary nominal"
check "a nominal with transactions can't be deleted" \
  'BEGIN; DELETE nominal:other_direct_costs_internet; CANCEL;' "transactions and can't be deleted"
check "a sub-nominal can't move under another primary" \
  'BEGIN; UPDATE nominal:other_direct_costs_internet SET parent = nominal:sales; CANCEL;' "can't move under"

echo "$FAIL failed"
exit $FAIL
