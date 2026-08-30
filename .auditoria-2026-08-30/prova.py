#!/usr/bin/env python3
"""PRONTO QUANDO da rodada: a auditoria so vale se for ancorada em codigo real.

Nao basta existir um relatorio: cada achado tem de citar um arquivo que EXISTE e
uma linha que EXISTE dentro dele. E o gate contra achado inventado -- o modo de
falha classico de auditoria feita por agente.
"""
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
REPO = BASE.parent
falhas = []


def checa(nome, ok, detalhe=""):
    print(f"  [{'ok' if ok else 'FALHOU'}] {nome}" + (f" -- {detalhe}" if detalhe and not ok else ""))
    if not ok:
        falhas.append(nome)


relatorio = BASE / "RELATORIO.md"
achados_json = BASE / "achados.json"

checa("RELATORIO.md existe", relatorio.exists())
checa("achados.json existe", achados_json.exists())
if falhas:
    print("\nFALTA O BASICO"); sys.exit(1)

checa("relatorio tem corpo (>4000 chars)", len(relatorio.read_text(encoding="utf-8")) > 4000,
      f"{len(relatorio.read_text(encoding='utf-8'))} chars")

try:
    achados = json.loads(achados_json.read_text(encoding="utf-8"))
except ValueError as e:
    checa("achados.json e JSON valido", False, str(e)); print(); sys.exit(1)
checa("achados.json e JSON valido", True)

checa("ha achados", isinstance(achados, list) and len(achados) > 0, f"{len(achados) if isinstance(achados, list) else 'nao e lista'}")
if falhas:
    print(); sys.exit(1)

print(f"\n  ancorando {len(achados)} achados no codigo real:")
for a in achados:
    rot = (a.get("id") or a.get("titulo", "?"))[:44]
    arq, lin = a.get("arquivo"), a.get("linha")
    if not arq:
        checa(f"{rot}: cita arquivo", False); continue
    p = REPO / arq
    if not p.exists():
        checa(f"{rot}: {arq} existe", False, "arquivo inexistente -- achado possivelmente inventado")
        continue
    total = sum(1 for _ in p.open(encoding="utf-8", errors="ignore"))
    ok_linha = isinstance(lin, int) and 1 <= lin <= total
    checa(f"{rot}: {arq}:{lin}", ok_linha, f"o arquivo tem {total} linhas")
    for campo in ("severidade", "titulo", "porque", "veredito"):
        if not a.get(campo):
            checa(f"{rot}: campo '{campo}' preenchido", False)

print()
if falhas:
    print(f"{len(falhas)} FALHA(S)"); sys.exit(1)
print(f"AUDITORIA VALIDA: {len(achados)} achados, todos ancorados em arquivo e linha reais")
