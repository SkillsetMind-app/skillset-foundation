"""Prova de integridade das marcas isoladas (public/brand/logo-mark-*.png).

Uso: python scripts/check_brand_marks.py
Falha (exit 1) se qualquer marca tiver pixel escuro opaco fora do esperado, pixel cinza
(barra de rolagem de renderizacao) ou geometria (alpha) diferente entre navy e white.
Historico: em 2026-09-08 as duas marcas tinham 12.312 pixels pretos opacos formando
barras verticais nas laterais, visiveis como "linhas pretas" em fundo escuro (issue #250).
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(sys.argv[sys.argv.index("--root") + 1]) if "--root" in sys.argv else Path(__file__).resolve().parents[1]
MARKS = {
    "public/brand/logo-mark-navy.png": (16, 42, 67),
    "public/brand/logo-mark-white.png": (255, 255, 255),
}


def analyse(path, expected):
    im = Image.open(ROOT / path).convert("RGBA")
    w, h = im.size
    px = im.load()
    black = grey = off = opaque = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a <= 40:
                continue
            if max(r, g, b) < 40 and expected != (16, 42, 67):
                black += 1
            if 100 < r < 230 and abs(r - g) < 8 and abs(g - b) < 8:
                grey += 1
            if a > 250:
                opaque += 1
                if (r, g, b) != expected and max(abs(r - expected[0]), abs(g - expected[1]), abs(b - expected[2])) > 6:
                    off += 1
    return {"size": (w, h), "black": black, "grey": grey, "opaque": opaque, "off_colour": off, "alpha": im.split()[3]}


def main():
    ok = True
    results = {}
    for path, colour in MARKS.items():
        r = analyse(path, colour)
        results[path] = r
        print(f"{path}: {r['size'][0]}x{r['size'][1]} | pretos={r['black']} | cinza={r['grey']} | opacos={r['opaque']} | fora da cor={r['off_colour']}")
        if r["size"] != (512, 512) or r["black"] or r["grey"] or r["off_colour"] > 20:
            ok = False
    a1 = results["public/brand/logo-mark-navy.png"]["alpha"]
    a2 = results["public/brand/logo-mark-white.png"]["alpha"]
    diff = sum(1 for p, q in zip(a1.getdata(), a2.getdata()) if abs(p - q) > 8)
    print(f"geometria (alpha) diferente entre navy e white: {diff} pixels")
    if diff:
        ok = False
    print("OK" if ok else "FALHOU")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
