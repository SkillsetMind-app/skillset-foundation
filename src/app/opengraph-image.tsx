import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { brand } from "@/data/brand";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// Default share card (1200×630) for every page without an image of its own;
// buildPageMetadata points at this route. The old default was the 1600×320
// logo, which WhatsApp and LinkedIn crop in half on a large card. The PNG
// logo stays for emails. No network: the white lockup is read from /public and
// the text uses ImageResponse's bundled font.
export const alt = brand.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public/brand/logo-full-dark-v2.png"));
  const en = getDictionary("en");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: "#102a43",
          color: "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
        <img
          src={`data:image/png;base64,${logo.toString("base64")}`}
          width={560}
          height={112}
          alt=""
        />
        <div style={{ display: "flex", flexDirection: "column", marginTop: 56, fontSize: 60, lineHeight: 1.15 }}>
          <span>{translate(en, "home.hero.title1")}</span>
          <span style={{ color: "#c99a46" }}>{translate(en, "home.hero.title2")}</span>
        </div>
      </div>
    ),
    size,
  );
}
