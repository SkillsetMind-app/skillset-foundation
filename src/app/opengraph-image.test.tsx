// @vitest-environment node
import { describe, expect, it } from "vitest";

import OpengraphImage, { contentType, size } from "./opengraph-image";

// WhatsApp, LinkedIn and X crop a "large" card to ~1.91:1. The old default was
// the 1600×320 logo, which they cut in half.
describe("default share card", () => {
  it("renders a 1200×630 PNG", async () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");

    const png = Buffer.from(await (await OpengraphImage()).arrayBuffer());

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
