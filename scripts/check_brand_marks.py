"""Integrity check for the standalone marks (public/brand/logo-mark-*.png).

Usage: python scripts/check_brand_marks.py
Fails (exit 1) if any mark has an unexpected opaque dark pixel, a gray pixel
(rendering scrollbar) or a different geometry (alpha) between navy and white.
History: on 2026-09-08 both marks had 12,312 opaque black pixels forming
vertical bars on the sides, visible as "black lines" on a dark background (issue #250).
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
        print(f"{path}: {r['size'][0]}x{r['size'][1]} | black={r['black']} | grey={r['grey']} | opaque={r['opaque']} | off colour={r['off_colour']}")
        if r["size"] != (512, 512) or r["black"] or r["grey"] or r["off_colour"] > 20:
            ok = False
    a1 = results["public/brand/logo-mark-navy.png"]["alpha"]
    a2 = results["public/brand/logo-mark-white.png"]["alpha"]
    diff = sum(1 for p, q in zip(a1.getdata(), a2.getdata()) if abs(p - q) > 8)
    print(f"alpha geometry differs between navy and white: {diff} pixels")
    if diff:
        ok = False
    print("OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
