#!/usr/bin/env python3
"""ARQUIVO DESCARTAVEL -- existe so para provar o porteiro de PR no CI real.

Este PR NAO deve ser mergeado. As falhas abaixo sao plantadas de proposito:
o porteiro tem que acha-las, deixar o check vermelho e mandar o detalhe no
canal privado. Depois disso o PR e fechado e a branch apagada.

Nao e importado por nada e nao entra no build da aplicacao.
"""
import sqlite3
from http.server import BaseHTTPRequestHandler


class Relatorios(BaseHTTPRequestHandler):
    def do_GET(self):
        conexao = sqlite3.connect("relatorios.db")

        # FALHA 1 -- injecao de SQL: o valor vem da URL e entra concatenado.
        escola = self.path.split("escola=")[-1]
        linhas = conexao.execute(
            "SELECT * FROM relatorios WHERE escola_id = '" + escola + "'"
        ).fetchall()

        # FALHA 2 -- IDOR: o dono do relatorio nunca e comparado com quem pede.
        aluno = self.headers.get("x-aluno-id", "")
        notas = conexao.execute(
            f"SELECT nota, comentario FROM notas WHERE aluno_id = '{aluno}'"
        ).fetchall()

        self.send_response(200)
        self.end_headers()
        self.wfile.write(str({"linhas": linhas, "notas": notas}).encode())
