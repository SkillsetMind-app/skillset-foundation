"""
Pull live PostgREST OpenAPI schema using service role from .env.local.
Writes inventory JSON + markdown. No secrets printed.
"""
from __future__ import annotations

import json
import ssl
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env.local"
OUT_DIR = ROOT / "supabase"
OUT_JSON = OUT_DIR / f"live_schema_inventory_{date.today().isoformat()}.json"
OUT_MD = OUT_DIR / f"LIVE_SCHEMA_INVENTORY_{date.today().isoformat()}.md"
# also copy into worktree migrations path if exists
WT = ROOT / ".claude/worktrees/issue-8-creator-subscriptions/supabase"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        env[k.strip()] = v.strip().strip("\"'")
    return env


def main() -> None:
    env = load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(
        f"{url}/rest/v1/",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/openapi+json",
        },
    )
    with urllib.request.urlopen(req, timeout=60, context=ssl.create_default_context()) as resp:
        spec = json.loads(resp.read().decode("utf-8"))

    paths = spec.get("paths") or {}
    definitions = spec.get("definitions") or spec.get("components", {}).get("schemas") or {}

    tables: dict[str, dict] = {}
    for path, methods in paths.items():
        name = path.strip("/")
        if not name or "/" in name:
            continue
        get = (methods or {}).get("get") or {}
        # columns from definition ref
        cols: list[str] = []
        # try parameters / schema
        defn = definitions.get(name) or definitions.get(name.title()) or {}
        props = defn.get("properties") or {}
        if props:
            cols = sorted(props.keys())
        tables[name] = {
            "columns": cols,
            "column_count": len(cols),
            "has_get": "get" in (methods or {}),
            "has_post": "post" in (methods or {}),
            "has_patch": "patch" in (methods or {}),
            "has_delete": "delete" in (methods or {}),
        }

    # row counts for key commerce tables (head prefer count)
    commerce = [
        "courses",
        "orders",
        "payments",
        "course_subscriptions",
        "payout_ledger",
        "processed_stripe_events",
        "enrollments",
        "users",
        "subscriptions",
    ]
    counts: dict[str, int | str] = {}
    for t in commerce:
        creq = urllib.request.Request(
            f"{url}/rest/v1/{t}?select=id&limit=1",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Prefer": "count=exact",
                "Range": "0-0",
            },
        )
        try:
            with urllib.request.urlopen(creq, timeout=30, context=ssl.create_default_context()) as r:
                cr = r.headers.get("Content-Range") or r.headers.get("content-range") or ""
                # e.g. 0-0/123
                if "/" in cr:
                    counts[t] = int(cr.split("/")[-1])
                else:
                    counts[t] = "?"
        except Exception as e:
            counts[t] = f"err:{type(e).__name__}"

    payload = {
        "generated": date.today().isoformat(),
        "host": url.replace("https://", "").replace("http://", ""),
        "table_count": len(tables),
        "tables": tables,
        "commerce_row_counts": counts,
        "definition_keys": sorted(definitions.keys())[:200],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    lines = [
        f"# Live Schema Inventory — {date.today().isoformat()}",
        "",
        f"**Host:** `{payload['host']}`  ",
        f"**Tables exposed via PostgREST:** {len(tables)}  ",
        "",
        "## Commerce row counts",
        "",
        "| Table | Rows |",
        "|-------|------|",
    ]
    for t, c in counts.items():
        lines.append(f"| `{t}` | {c} |")
    lines += ["", "## All tables", ""]
    for name in sorted(tables):
        info = tables[name]
        col_n = info["column_count"]
        lines.append(f"- `{name}` ({col_n} cols)")
    lines += [
        "",
        "## Notes",
        "",
        "- Sourced from PostgREST OpenAPI with service role (live).",
        "- Full SQL dump (`CREATE FUNCTION`/RLS) still needs `supabase db dump` or DB password.",
        "- This inventory unblocks gap analysis vs `database.types.ts` and local migrations.",
        "",
    ]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")

    if WT.exists():
        (WT / OUT_JSON.name).write_text(OUT_JSON.read_text(encoding="utf-8"), encoding="utf-8")
        (WT / OUT_MD.name).write_text(OUT_MD.read_text(encoding="utf-8"), encoding="utf-8")

    print(f"tables={len(tables)}")
    print(f"wrote {OUT_JSON}")
    print(f"wrote {OUT_MD}")
    print("commerce_counts", counts)


if __name__ == "__main__":
    main()
