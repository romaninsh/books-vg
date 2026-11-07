#!/usr/bin/env bash
# tests/surql.sh <file.surql | -> [-q|-f] - run SurrealQL and print one line per statement;
# exits 1 if any statement failed. -q prints only failures, -f prints whole results.
# Env: SURREAL_HTTP (base URL; default: the compose stack's published port), SURREAL_HTTP_AUTH
# (user:pass, default root:root), SURREAL_AUTH (root, namespace or database: the level that
# user was defined at; root), SURREAL_NS / SURREAL_DB (default app / app),
# SURREAL_IMPORT=1 (start every chunk with OPTION IMPORT, as `surreal export` files need:
# events don't fire, so imported payments don't post their ledger entries a second time).
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${SURREAL_HTTP:-}" ]; then
  # Vantage names the stack <installation>-<folder>-<hash>, so the folder name finds it.
  P="${COMPOSE_PROJECT:-$(docker compose ls --format json | python3 -c 'import json,sys; print(next(p["Name"] for p in json.load(sys.stdin) if sys.argv[1] in p["Name"]))' "$(basename "$PWD")")}"
  SURREAL_HTTP="http://127.0.0.1:$(docker compose -p "$P" -f composer.yaml port surrealdb 8000 | cut -d: -f2)"
fi
AUTH="${SURREAL_HTTP_AUTH:-root:root}"
NS="${SURREAL_NS:-app}"; DB="${SURREAL_DB:-app}"
# SurrealDB 3 picks the sign-in level from these headers (Surreal-NS/DB only select the database).
case "${SURREAL_AUTH:-root}" in
  root) LEVEL=() ;;
  namespace) LEVEL=(-H "Surreal-Auth-NS: $NS") ;;
  database) LEVEL=(-H "Surreal-Auth-NS: $NS" -H "Surreal-Auth-DB: $DB") ;;
  *) echo "SURREAL_AUTH must be root, namespace or database" >&2; exit 1 ;;
esac
# A database user can't define its own namespace or database: only select them.
if [ "${SURREAL_AUTH:-root}" = root ]; then
  HEAD="DEFINE NAMESPACE IF NOT EXISTS $NS; USE NS $NS; DEFINE DATABASE IF NOT EXISTS $DB; USE NS $NS DB $DB;"; SKIP=4
else
  HEAD="USE NS $NS DB $DB;"; SKIP=1
fi
if [ "${SURREAL_IMPORT:-}" = 1 ]; then HEAD="$HEAD OPTION IMPORT;"; SKIP=$((SKIP + 1)); fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat "${1:--}" > "$TMP/all.surql"
# The HTTP endpoint refuses bodies over ~1 MB: big files (one statement per line) go in chunks of
# whole lines up to 800 KB, as few requests as fit (each one is a round trip to a remote server).
awk -v dir="$TMP" 'BEGIN { n = 0; size = 0 }
  { if (size > 0 && size + length($0) + 1 > 800000) { n++; size = 0 }
    printf "%s\n", $0 > sprintf("%s/part.%04d", dir, n); size += length($0) + 1 }' "$TMP/all.surql"
[ -e "$TMP/part.0000" ] || : > "$TMP/part.0000"
status=0
for part in "$TMP"/part.*; do
{ echo "$HEAD"; cat "$part"; } > "$TMP/body"
curl -s -X POST "$SURREAL_HTTP/sql" -u "$AUTH" ${LEVEL[@]+"${LEVEL[@]}"} -H "Surreal-NS: $NS" -H "Surreal-DB: $DB" \
  -H "Accept: application/json" --data-binary "@$TMP/body" \
  | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    res = json.loads(raw)
except ValueError:
    print("ERR (not JSON)", raw[:2000]); sys.exit(1)
if isinstance(res, dict):
    print("ERR", res); sys.exit(1)
bad = 0
skip = int(sys.argv[2])
quiet = "-q" in sys.argv[1]
for i, r in enumerate(res[skip:], 1):
    if r["status"] != "OK":
        bad += 1
        print("#%d ERR %s" % (i, r["result"]))
    elif not quiet:
        out = json.dumps(r["result"], default=str)
        print("#%d OK  %s" % (i, out if "-f" in sys.argv[1] else out[:400]))
sys.exit(1 if bad else 0)
' "${2:-}" "$SKIP" || status=1
done
exit $status
