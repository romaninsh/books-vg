#!/usr/bin/env bash
# Load the books into a database: the schema, the data, the schema again (the data switches the
# slow events off while it loads; the second pass puts them back). The data is the full anonymised
# books (tests/seed.surql) where they are, which is only on the owner's machine, else the committed
# sample (tests/sample.surql, scripts/make_sample.py). SEED=<file> picks one.
#
# usage: tests/load.sh            the local stack (composer.yaml), namespace/database app
#        tests/load.sh --wipe     drop the app's tables first (local or CI; never the cloud)
# Target: SURREAL_HTTP, SURREAL_HTTP_AUTH, SURREAL_AUTH, SURREAL_NS, SURREAL_DB (tests/surql.sh).
# The cloud is loaded by tests/load_cloud.sh, which sets those from private/cloud.env.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${SEED:-}" ]; then
  if [ -f tests/seed.surql ]; then SEED=tests/seed.surql; else SEED=tests/sample.surql; fi
fi

if [ "${1:-}" = "--wipe" ]; then
  WIPE=""
  for t in allocation payment invoice_line invoice misc doc contact bank_account nominal attachment \
           file_chunk audit_event company test_result; do
    WIPE="$WIPE REMOVE TABLE IF EXISTS $t;"
  done
  echo "$WIPE" | tests/surql.sh - -q
fi

# The seed is one transaction, so it must go in one request: the runner splits files at 800 KB.
size=$(wc -c < "$SEED")
if [ "$size" -gt 800000 ]; then echo "$SEED is ${size} bytes: over one request; split the transaction" >&2; exit 1; fi

echo "schema";   tests/surql.sh tests/schema.surql -q
echo "$SEED";    tests/surql.sh "$SEED" -q
echo "schema";   tests/surql.sh tests/schema.surql -q
echo "SELECT count() AS documents FROM doc GROUP ALL; SELECT count() AS contacts FROM contact GROUP ALL;
SELECT count() AS nominals FROM nominal GROUP ALL;" | tests/surql.sh - -f
echo "loaded"
