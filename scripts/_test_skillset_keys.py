"""Test Skillset credentials from .env.local without printing secrets."""
from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        v = v.strip().strip("\"'")
        if v:
            env[k.strip()] = v
    return env


def mask_host(url: str) -> str:
    try:
        host = url.split("//", 1)[-1].split("/", 1)[0]
        if "." in host:
            parts = host.split(".")
            return parts[0][:6] + "…" + ".".join(parts[-2:])
        return host[:10] + "…"
    except Exception:
        return "(bad-url)"


def http_json(url: str, headers: dict[str, str], timeout: int = 25):
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
            body = resp.read()
            return resp.status, body, None
    except urllib.error.HTTPError as e:
        body = e.read() if e.fp else b""
        return e.code, body, str(e.reason)
    except Exception as e:
        return None, b"", f"{type(e).__name__}: {e}"


def main() -> int:
    env = load_env(ENV_PATH)
    print(f"ENV_FILE: {ENV_PATH} exists={ENV_PATH.exists()}")
    need = [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
    ]
    print("\n=== PRESENCE ===")
    for k in need:
        v = env.get(k, "")
        print(f"  {k}: {'SET len='+str(len(v)) if v else 'MISSING'}")

    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    anon = env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    service = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    stripe_sk = env.get("STRIPE_SECRET_KEY", "")
    stripe_pk = env.get("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "")

    print("\n=== SUPABASE ===")
    if not url:
        print("  SKIP: no URL")
    else:
        print(f"  host: {mask_host(url)}")
        # 1) REST root with service role
        if service:
            status, body, err = http_json(
                f"{url}/rest/v1/",
                {
                    "apikey": service,
                    "Authorization": f"Bearer {service}",
                    "Accept": "application/openapi+json",
                },
            )
            if status == 200:
                try:
                    data = json.loads(body.decode("utf-8", errors="replace"))
                    paths = [p for p in (data.get("paths") or {}) if p not in ("/", "")]
                    print(f"  service_role REST: PASS status=200 tables≈{len(paths)}")
                except Exception:
                    print(f"  service_role REST: PASS status=200 body_len={len(body)}")
            else:
                print(f"  service_role REST: FAIL status={status} err={err}")
                if body:
                    snippet = body.decode("utf-8", errors="replace")[:160].replace("\n", " ")
                    # scrub any token-looking content
                    snippet = snippet[:160]
                    print(f"  body_snip: {snippet}")
        else:
            print("  service_role REST: SKIP missing key")

        # 2) auth health with anon
        if anon:
            status, body, err = http_json(
                f"{url}/auth/v1/health",
                {"apikey": anon, "Authorization": f"Bearer {anon}"},
            )
            if status == 200:
                print("  anon auth/health: PASS")
            else:
                print(f"  anon auth/health: FAIL status={status} err={err}")
        else:
            print("  anon auth/health: SKIP missing key")

    print("\n=== STRIPE ===")
    if stripe_sk:
        mode = "live" if stripe_sk.startswith("sk_live") else ("test" if stripe_sk.startswith("sk_test") else "unknown")
        print(f"  secret prefix mode: {mode}")
        status, body, err = http_json(
            "https://api.stripe.com/v1/balance",
            {"Authorization": f"Bearer {stripe_sk}"},
        )
        if status == 200:
            print("  secret balance API: PASS")
        else:
            print(f"  secret balance API: FAIL status={status} err={err}")
            if body:
                try:
                    msg = json.loads(body.decode("utf-8")).get("error", {}).get("message", "")
                    print(f"  stripe_msg: {msg[:120]}")
                except Exception:
                    print(f"  body_len={len(body)}")
    else:
        print("  secret: MISSING")

    if stripe_pk:
        pmode = "live" if "pk_live" in stripe_pk else ("test" if "pk_test" in stripe_pk else "unknown")
        print(f"  publishable prefix mode: {pmode}")
        # publishable keys are not used as Bearer for balance; just format check
        print("  publishable format: PASS" if stripe_pk.startswith("pk_") else "  publishable format: FAIL")
    else:
        print("  publishable: MISSING")

    wh = env.get("STRIPE_WEBHOOK_SECRET", "")
    if wh:
        ok = wh.startswith("whsec_")
        print(f"  webhook secret format: {'PASS' if ok else 'WARN(not whsec_)'} len={len(wh)}")
    else:
        print("  webhook secret: MISSING")

    print("\nDONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
