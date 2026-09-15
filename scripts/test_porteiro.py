"""Porteiro: z.ai HTTP 429 with error code 1113 (no balance) stops at once;
1302 (rate limit) keeps the backoff. The gate still fails closed (exit 3).
Round 2: no verdict shopping (cut replies with findings, content filters),
time budget that fits the job, odd response bodies, private failure reasons."""
import http.client
import io
import json
import os
import re
import sys
import unittest
import urllib.error
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest.mock import mock_open, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import porteiro  # noqa: E402

CHAVE = "CHAVE_SENTINELA"
WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "porteiro.yml"


class ErroDaZaiTest(unittest.TestCase):
    def roda(self, codigo):
        def responde(*_args, **_kwargs):
            corpo = json.dumps({"error": {"code": codigo, "message": "msg"}}).encode()
            raise urllib.error.HTTPError(porteiro.URL, 429, "Too Many Requests", {}, io.BytesIO(corpo))

        saida = io.StringIO()
        with patch.dict(os.environ, {"GLM_API_KEY": CHAVE, "PORTEIRO_MODO": "avisa"}, clear=True), \
             patch("builtins.open", mock_open(read_data="diff --git a/a b/a\n+x")), \
             patch.object(porteiro, "escreve") as escreve, \
             patch.object(porteiro, "manda_detalhe", return_value="no Telegram") as detalhe, \
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
        self.assertIn("1113", log)

    def test_1302_mantem_o_backoff_e_mostra_o_codigo(self):
        chamadas, dormidas, placar, log, privado = self.roda("1302")
        self.assertEqual((chamadas, dormidas), (6, 5))
        self.assertIn("código 1302", privado)
        self.assertNotIn("1302", placar)
        self.assertIn("1302", log)


VAZIO_JSON = '{"achados":[]}'
FAIL_JSON = json.dumps({"achados": [
    {"titulo": "IDOR", "arquivo": "a", "severidade": "alta", "confianca": 0.9}]})
AVISO_JSON = json.dumps({"achados": [
    {"titulo": "leve", "arquivo": "a", "severidade": "baixa", "confianca": 0.9}]})
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

    def roda(self, por_modelo, env=TODAS, modo="barra", relogio=None):
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
            pilha.enter_context(patch("builtins.open", mock_open(read_data="diff --git a/a b/a\n+x")))
            escreve = pilha.enter_context(patch.object(porteiro, "escreve"))
            detalhe = pilha.enter_context(patch.object(porteiro, "manda_detalhe", return_value="no Telegram"))
            dorme = pilha.enter_context(patch.object(porteiro.time, "sleep", side_effect=dorme_relogio))
            if relogio is not None:
                pilha.enter_context(patch.object(porteiro.time, "monotonic", side_effect=lambda: relogio[0]))
            pilha.enter_context(patch("urllib.request.urlopen", side_effect=responde))
            pilha.enter_context(redirect_stdout(saida))
            codigo = porteiro.main(["--diff", "d", "--placar", "p"])
        placar = escreve.call_args.args[1]
        self.assertNotIn(CHAVE, saida.getvalue() + placar)
        self.dormidas = dorme.call_count
        self.privado = str(detalhe.call_args_list)
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


if __name__ == "__main__":
    unittest.main()
