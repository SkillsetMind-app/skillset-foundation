"""Porteiro: z.ai HTTP 429 with error code 1113 (no balance) stops at once;
1302 (rate limit) keeps the backoff. The gate still fails closed (exit 3)."""
import io
import json
import os
import sys
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import mock_open, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import porteiro  # noqa: E402

CHAVE = "CHAVE_SENTINELA"


class ErroDaZaiTest(unittest.TestCase):
    def roda(self, codigo):
        def responde(*_args, **_kwargs):
            corpo = json.dumps({"error": {"code": codigo, "message": "msg"}}).encode()
            raise urllib.error.HTTPError(porteiro.URL, 429, "Too Many Requests", {}, io.BytesIO(corpo))

        saida = io.StringIO()
        with patch.dict(os.environ, {"GLM_API_KEY": CHAVE, "PORTEIRO_MODO": "avisa"}, clear=True), \
             patch("builtins.open", mock_open(read_data="diff --git a/a b/a\n+x")), \
             patch.object(porteiro, "escreve") as escreve, \
             patch.object(porteiro.time, "sleep") as dorme, \
             patch("urllib.request.urlopen", side_effect=responde) as req, \
             redirect_stdout(saida):
            codigo_saida = porteiro.main(["--diff", "d", "--placar", "p"])
        placar = escreve.call_args.args[1]
        self.assertEqual(codigo_saida, 3)  # fail-closed, even in "avisa"
        self.assertIn("NÃO ANALISADO", placar)
        self.assertNotIn(CHAVE, saida.getvalue() + placar)
        return req.call_count, dorme.call_count, placar, saida.getvalue()

    def test_1113_para_na_hora_e_diz_saldo_zerado(self):
        chamadas, dormidas, placar, log = self.roda("1113")
        self.assertEqual((chamadas, dormidas), (1, 0))
        self.assertIn("saldo da z.ai zerado (código 1113)", placar)
        self.assertIn("1113", log)

    def test_1302_mantem_o_backoff_e_mostra_o_codigo(self):
        chamadas, dormidas, placar, log = self.roda("1302")
        self.assertEqual((chamadas, dormidas), (6, 5))
        self.assertIn("código 1302", placar)
        self.assertNotIn("saldo", placar)
        self.assertIn("1302", log)


if __name__ == "__main__":
    unittest.main()
