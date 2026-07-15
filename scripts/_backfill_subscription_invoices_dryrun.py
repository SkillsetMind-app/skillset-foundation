"""
Dry-run (and optional apply) for historical Stripe subscription invoices
that should materialize as commerce rows in Supabase.

Never prints secret values. Uses .env.local.
"""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env.local"
REPORT = ROOT / "supabase" / "BACKFILL_SUBSCRIPTION_INVOICES_REPORT.md"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        env[k.strip()] = v.strip().strip("\"'")
    return env


def http(
    url: str,
    headers: dict[str, str],
    method: str = "GET",
    data: bytes | None = None,
    timeout: int = 45,
):
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read() if e.fp else b"", {}


def stripe_get(path: str, sk: str, params: dict | None = None):
    q = f"?{urllib.parse.urlencode(params)}" if params else ""
    status, body, _ = http(
        f"https://api.stripe.com/v1/{path}{q}",
        {"Authorization": f"Bearer {sk}"},
    )
    if status != 200:
        raise RuntimeError(f"stripe {path} status={status} body={body[:200]!r}")
    return json.loads(body.decode("utf-8"))


def sb_count(url: str, key: str, table: str) -> str:
    status, body, headers = http(
        f"{url}/rest/v1/{table}?select=*&limit=1",
        {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Prefer": "count=exact",
            "Range": "0-0",
        },
    )
    if status and status >= 400:
        return f"err:{status}"
    cr = headers.get("Content-Range") or headers.get("content-range") or ""
    if "/" in cr:
        return cr.split("/")[-1]
    return str(status)


def invoice_is_course_subscription(inv: dict, sk: str) -> tuple[bool, dict]:
    meta = inv.get("metadata") or {}
    if meta.get("purpose") == "course_subscription":
        return True, meta
    # pull subscription metadata
    sub = inv.get("subscription")
    sub_id = sub if isinstance(sub, str) else (sub or {}).get("id") if isinstance(sub, dict) else None
    if not sub_id:
        return False, {}
    sub_obj = stripe_get(f"subscriptions/{sub_id}", sk)
    sm = sub_obj.get("metadata") or {}
    if sm.get("purpose") == "course_subscription":
        return True, sm
    return False, sm


def main() -> None:
    env = load_env()
    sk = env["STRIPE_SECRET_KEY"]
    sb = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    print("=== SUPABASE COUNTS ===")
    counts = {}
    for t in [
        "courses",
        "orders",
        "payments",
        "course_subscriptions",
        "payout_ledger",
        "enrollments",
        "subscriptions",
        "public_profiles",
    ]:
        c = sb_count(sb, key, t)
        counts[t] = c
        print(f"  {t}: {c}")

    print("=== STRIPE PAID INVOICES (scan up to 300) ===")
    scanned = 0
    with_sub = 0
    course_subs = 0
    missing_meta = 0
    candidates: list[dict] = []
    starting_after = None
    while scanned < 300:
        params: dict = {"status": "paid", "limit": "100"}
        if starting_after:
            params["starting_after"] = starting_after
        page = stripe_get("invoices", sk, params)
        data = page.get("data") or []
        if not data:
            break
        for inv in data:
            scanned += 1
            if not inv.get("subscription"):
                continue
            with_sub += 1
            ok, meta = invoice_is_course_subscription(inv, sk)
            if not ok:
                continue
            course_subs += 1
            if not (meta.get("courseId") and meta.get("userId") and meta.get("teacherId")):
                missing_meta += 1
            candidates.append(
                {
                    "invoice_id": inv.get("id"),
                    "subscription_id": inv.get("subscription")
                    if isinstance(inv.get("subscription"), str)
                    else None,
                    "amount_paid": inv.get("amount_paid"),
                    "currency": inv.get("currency"),
                    "has_courseId": bool(meta.get("courseId")),
                    "has_userId": bool(meta.get("userId")),
                    "has_teacherId": bool(meta.get("teacherId")),
                }
            )
        if not page.get("has_more"):
            break
        starting_after = data[-1]["id"]

    print(f"  scanned={scanned} with_subscription={with_sub} course_subscription={course_subs}")
    print(f"  incomplete_metadata={missing_meta} candidates={len(candidates)}")

    # check which invoices already in payout_ledger by id
    already = 0
    need = 0
    for c in candidates:
        iid = c["invoice_id"]
        if not iid:
            continue
        status, body, _ = http(
            f"{sb}/rest/v1/payout_ledger?id=eq.{urllib.parse.quote(iid)}&select=id",
            {"apikey": key, "Authorization": f"Bearer {key}"},
        )
        if status == 200 and body and body not in (b"[]", b""):
            already += 1
            c["in_ledger"] = True
        else:
            need += 1
            c["in_ledger"] = False

    print(f"  already_in_payout_ledger={already} need_backfill={need}")

    lines = [
        "# Backfill subscription invoices — dry-run report",
        "",
        f"**Stripe mode:** `{'live' if sk.startswith('sk_live') else 'test'}`  ",
        f"**Supabase host:** `{sb.replace('https://','')}`  ",
        "",
        "## Supabase row counts",
        "",
        "| Table | Count |",
        "|-------|------|",
    ]
    for t, c in counts.items():
        lines.append(f"| `{t}` | {c} |")
    lines += [
        "",
        "## Stripe scan",
        "",
        f"- Paid invoices scanned: **{scanned}**",
        f"- With subscription: **{with_sub}**",
        f"- `purpose=course_subscription`: **{course_subs}**",
        f"- Incomplete metadata: **{missing_meta}**",
        f"- Already in `payout_ledger`: **{already}**",
        f"- **Need backfill: {need}**",
        "",
        "## Recommendation",
        "",
    ]
    if course_subs == 0:
        lines.append(
            "No Skillset course subscription invoices found in Stripe (up to scan limit). "
            "Backfill apply step is a no-op until real subscription sales exist."
        )
    elif need == 0:
        lines.append("All candidate invoices already present in payout ledger. No apply needed.")
    else:
        lines.append(
            f"{need} invoices need materialization. Apply should reuse "
            "`handleCourseSubscriptionInvoicePaid` logic (Node), not a second Python path."
        )
    lines += [
        "",
        "## Safety",
        "",
        "- Dry-run only in this script (no writes).",
        "- Apply path: temporary admin script or Stripe event re-send after code deploy.",
        "",
    ]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {REPORT}")


if __name__ == "__main__":
    main()
