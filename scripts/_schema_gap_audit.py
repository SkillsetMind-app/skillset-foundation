"""Audit: database.types.ts tables/RPCs vs migrations vs src usage. No secrets."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TYPES = (ROOT / "src/lib/supabase/database.types.ts").read_text(encoding="utf-8", errors="replace")
MIG_DIR = ROOT / "supabase/migrations"
SRC = ROOT / "src"


def section(parent: str, child: str) -> str:
    """Extract public.Tables / public.Functions style nested blocks."""
    # public: { ... Tables: { ... } Views: or Functions:
    m = re.search(
        rf"public:\s*\{{[\s\S]*?{child}:\s*\{{([\s\S]*?)\n    \}}\n    [A-Z]",
        TYPES,
    )
    if m:
        return m.group(1)
    m = re.search(rf"{child}:\s*\{{([\s\S]*?)\n    \}}\n    [A-Z]", TYPES)
    return m.group(1) if m else ""


def names_in(block_text: str) -> list[str]:
    return sorted(set(re.findall(r"^\s{6}([a-z_][a-z0-9_]*):\s*\{", block_text, re.M)))


# Prefer public.Tables nesting (6-space indent for table names)
tables_block = section("public", "Tables")
if not tables_block:
    # fallback 4-space
    m = re.search(r"Tables:\s*\{([\s\S]*?)\n    Views:|Tables:\s*\{([\s\S]*?)\n    Functions:", TYPES)
    tables_block = (m.group(1) or m.group(2) or "") if m else ""
    tables = sorted(set(re.findall(r"^\s{6}([a-z_][a-z0-9_]*):\s*\{", tables_block, re.M)))
    if not tables:
        tables = sorted(set(re.findall(r"^\s{4}([a-z_][a-z0-9_]*):\s*\{\s*\n\s{8}Row:", TYPES, re.M)))
else:
    tables = names_in(tables_block)

funcs_m = re.search(r"Functions:\s*\{([\s\S]*?)\n    \}\n  \}", TYPES)
funcs_block = funcs_m.group(1) if funcs_m else ""
funcs = sorted(set(re.findall(r"^\s{6}([a-z_][a-z0-9_]*):\s*\{", funcs_block, re.M)))
if not funcs:
    funcs = sorted(set(re.findall(r"^\s{4}([a-z_][a-z0-9_]*):\s*\{\s*\n\s{6}Args:", TYPES, re.M)))

mig_text = "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in sorted(MIG_DIR.glob("*.sql")))
mig_tables = sorted(
    set(re.findall(r"CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?([a-z_][a-z0-9_]*)", mig_text, re.I))
)
mig_funcs = sorted(
    set(
        re.findall(
            r"CREATE(?: OR REPLACE)? FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)",
            mig_text,
            re.I,
        )
    )
)

src_text = ""
for p in SRC.rglob("*"):
    if p.suffix in {".ts", ".tsx"} and "node_modules" not in p.parts:
        src_text += p.read_text(encoding="utf-8", errors="replace") + "\n"

rpc_used = sorted(set(re.findall(r"\.rpc\(\s*['\"]([a-z_][a-z0-9_]*)['\"]", src_text)))
from_used = sorted(set(re.findall(r"\.from\(\s*['\"]([a-z_][a-z0-9_]*)['\"]", src_text)))

print("=== COUNTS ===")
print(f"types.tables={len(tables)} types.funcs={len(funcs)}")
print(f"mig.tables={len(mig_tables)} mig.funcs={len(mig_funcs)}")
print(f"src.from={len(from_used)} src.rpc={len(rpc_used)}")

print("\n=== TABLES in types NOT in migrations ===")
for t in tables:
    if t not in mig_tables:
        print(f"  - {t}")

print("\n=== RPC used in src (status) ===")
for r in rpc_used:
    where = "mig" if r in mig_funcs else ("types" if r in funcs else "MISSING")
    print(f"  - {r} [{where}]")

print("\n=== TYPE FUNCS missing from migrations ===")
for f in funcs:
    if f not in mig_funcs:
        print(f"  - {f}")
