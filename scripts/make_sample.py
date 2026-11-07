#!/usr/bin/env python3
"""Cut the committed sample (tests/sample.surql) out of the full, anonymised books (tests/seed.surql,
kept local). The sample keeps the chart of accounts and the bank accounts, the documents dated in
one window with their lines, payments and misc entries, the allocations whose payment and invoice
are both in it, and only the contacts those documents name. Every figure is the full books' own.

Misc entries (salaries, card spends) outnumber everything else, so only one in four is kept.

usage: python3 -I scripts/make_sample.py [--from 2018-10-01] [--to 2019-03-31] [--misc-every 4]
"""
import argparse, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED, OUT = ROOT / "tests" / "seed.surql", ROOT / "tests" / "sample.surql"

ap = argparse.ArgumentParser()
ap.add_argument("--from", dest="start", default="2018-10-01")
ap.add_argument("--to", dest="end", default="2019-03-31")
ap.add_argument("--misc-every", type=int, default=4)
a = ap.parse_args()

lines = SEED.read_text().splitlines()
docs, misc_seen = set(), 0
for l in lines:
    m = re.match(r'CREATE (doc:\w+) SET type = "(\w+)", date = d"(\d{4}-\d{2}-\d{2})', l)
    if not m or not a.start <= m.group(3) <= a.end:
        continue
    if m.group(2).startswith("misc_"):  # salaries and card spends outnumber the rest: one in four
        misc_seen += 1
        if misc_seen % a.misc_every:
            continue
    docs.add(m.group(1))

kept, contacts, counts = [], set(), {}
for l in lines:
    m = re.match(r"CREATE (\w+):\w+ SET", l)
    if not m:
        kept.append(l)
        continue
    table = m.group(1)
    if table == "doc":
        keep = l.split(" SET", 1)[0][7:] in docs
    elif table == "allocation":
        refs = re.findall(r"(?:payment|invoice) = (doc:\w+)", l)
        keep = len(refs) == 2 and all(r in docs for r in refs)
    elif table in ("invoice", "invoice_line", "payment", "misc"):
        keep = re.search(r"\bdoc = (doc:\w+)", l).group(1) in docs
    else:
        keep = True  # nominal, bank_account; contacts are filtered below
    if keep:
        contacts.update(re.findall(r"\bcontact = (contact:\w+)", l))
        kept.append(l)

out = []
for l in kept:
    m = re.match(r"CREATE (contact:\w+) SET", l)
    if m and m.group(1) not in contacts:
        continue
    t = re.match(r"CREATE (\w+):", l)
    if t:
        counts[t.group(1)] = counts.get(t.group(1), 0) + 1
    out.append(l)

head = [f"-- The sample books: {a.start} to {a.end} of the anonymised books (scripts/make_sample.py).",
        "-- Loaded by tests/load.sh when the full tests/seed.surql isn't there (it is never committed)."]
OUT.write_text("\n".join(head + out) + "\n")
print(", ".join(f"{k} {v}" for k, v in counts.items()), f"-> {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")
