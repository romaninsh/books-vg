#!/usr/bin/env bash
# Load the books into SurrealDB Cloud, as the `books` database user, from private/cloud.env
# (written by tests/make_prod_env.py). Prints no credential.
# usage: tests/load_cloud.sh [invariants]    with `invariants`, run tests/invariants.sh there instead
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f private/cloud.env ] || { echo "private/cloud.env is missing: run python3 -I tests/make_prod_env.py" >&2; exit 1; }
set -a; . private/cloud.env; set +a
export SURREAL_HTTP_AUTH="$SURREAL_USER:$SURREAL_PASS" SURREAL_AUTH=database
unset SURREAL_PASS
if [ "${1:-}" = invariants ]; then exec tests/invariants.sh; fi
exec tests/load.sh
