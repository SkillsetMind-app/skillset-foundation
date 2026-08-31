// Derives the email-ready logo variants from the supplied lockup PNG.
//
// The source is a palette PNG (10 colors, no tRNS), so recoloring is a matter
// of rewriting the PLTE chunk and its CRC — pixel data and indices are
// untouched. That keeps the artwork bit-identical and avoids a raster library.
//
//   node scripts/build-logo-variants.mjs <source.png>

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "brand");
const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/build-logo-variants.mjs <source.png>");
  process.exit(1);
}

// --- CRC32, per the PNG spec -----------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function readPalette(buf) {
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    if (type === "PLTE") return { start: o, length: len, data: buf.subarray(o + 8, o + 8 + len) };
    if (type === "IEND") break;
    o += 12 + len;
  }
  throw new Error("no PLTE chunk — source must be a palette PNG");
}

function recolor(buf, mapping) {
  const out = Buffer.from(buf);
  const plte = readPalette(out);
  const entries = plte.length / 3;
  for (let i = 0; i < entries; i++) {
    const replacement = mapping[i];
    if (!replacement) continue;
    const [r, g, b] = hex(replacement);
    out[plte.start + 8 + i * 3] = r;
    out[plte.start + 8 + i * 3 + 1] = g;
    out[plte.start + 8 + i * 3 + 2] = b;
  }
  // CRC covers the chunk type plus its data.
  const crcStart = plte.start + 4;
  const crc = crc32(out.subarray(crcStart, crcStart + 4 + plte.length));
  out.writeUInt32BE(crc, plte.start + 8 + plte.length);
  return out;
}

const src = readFileSync(source);
const palette = readPalette(src);
const original = [];
for (let i = 0; i < palette.length; i += 3) {
  original.push(
    "#" + [...palette.data.subarray(i, i + 3)].map((x) => x.toString(16).padStart(2, "0")).join(""),
  );
}
console.log("source palette:", original.join(" "));

// Palette index → intent. Derived from the supplied lockup:
//   0-2 page ground, 3 light antialias, 4 gold antialias, 5 gold,
//   6-7 navy antialias (light→dark), 8-9 navy artwork.
const ON_LIGHT = {
  0: "#ffffff", // normalize the off-white ground to pure white so the header
  1: "#ffffff", // reads clean against the card instead of a faint grey box
  2: "#ffffff",
};

// Inverted for a navy header: the ground becomes navy, the navy artwork becomes
// white, antialias ramps flip with it. Gold is the brand's and stays put.
const ON_NAVY = {
  0: "#102a43",
  1: "#102a43",
  2: "#102a43",
  3: "#24405c",
  4: "#8a7233",
  5: "#d8a226",
  6: "#7f95ad",
  7: "#a8bccf",
  8: "#f2f6fa",
  9: "#ffffff",
};

const variants = [
  ["logo-lockup-light.png", ON_LIGHT, "for white / light grounds"],
  ["logo-lockup-on-navy.png", ON_NAVY, "for the navy email header"],
];

for (const [name, mapping, why] of variants) {
  writeFileSync(join(OUT_DIR, name), recolor(src, mapping));
  console.log(`wrote public/brand/${name} — ${why}`);
}
