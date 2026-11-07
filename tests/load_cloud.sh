#!/usr/bin/env bash
# Load the sample books into SurrealDB Cloud as the `books` database user, from private/cloud.env
# (written by tests/make_prod_env.py). The cloud refuses database users on its HTTP /sql endpoint
# (401 whatever the headers), so this goes over the WebSocket (tests/surql_ws.mjs), the way
# vantage-server connects. Credentials travel as environment variables only; nothing is printed.
# usage: tests/load_cloud.sh               schema, the sample (never the full books), schema
#        tests/load_cloud.sh invariants    tests/invariants.sh against the cloud
#        SEED=<file> picks other data
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f private/cloud.env ] || { echo "private/cloud.env is missing: run python3 -I tests/make_prod_env.py" >&2; exit 1; }
set -a; . private/cloud.env; set +a
export SURREAL_WS="wss://${SURREAL_HTTP#https://}/rpc" SURREAL_RUNNER=ws

if [ "${1:-}" = invariants ]; then exec tests/invariants.sh; fi
SEED="${SEED:-tests/sample.surql}"
echo "schema";  node tests/surql_ws.mjs -q < tests/schema.surql
echo "$SEED";   node tests/surql_ws.mjs -q < "$SEED"
echo "schema";  node tests/surql_ws.mjs -q < tests/schema.surql
echo "SELECT count() AS documents FROM doc GROUP ALL; SELECT count() AS contacts FROM contact GROUP ALL;
SELECT count() AS nominals FROM nominal GROUP ALL;" | node tests/surql_ws.mjs -f
echo "loaded into $SURREAL_NS/$SURREAL_DB"
