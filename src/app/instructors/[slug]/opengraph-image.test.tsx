// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicProfile } from "@/domain/user-profile";

const mocks = vi.hoisted(() => ({
  profile: null as PublicProfile | null,
}));
vi.mock("@/lib/data/server/public-profile", () => ({
  getPublicProfileByRef: async (ref: string) => (ref === "@ana.souza" ? mocks.profile : null),
  listCreatorCourses: async () => [{ id: "c-1" }, { id: "c-2" }],
}));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseClientConfig: () => ({ url: "https://example.supabase.co", anonKey: "anon" }),
}));

const { default: ProfileOpengraphImage, contentType, size } = await import("./opengraph-image");

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const AVATAR = "https://example.supabase.co/storage/v1/object/public/avatars/ana";

const ana = (photoURL: string): PublicProfile => ({
  uid: "u-1",
  displayName: "Ana Souza",
  username: "ana.souza",
  photoURL,
  bio: null,
  credentials: [],
});

// The renderer also uses fetch (wasm, font): only the photo fetches are
// fake, and they are recorded.
function stubPhotos(body: Uint8Array | string, type: string) {
  const realFetch = globalThis.fetch;
  const photo = vi.fn<typeof fetch>(async () => new Response(body as BodyInit, { headers: { "content-type": type } }));
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith("https://") ? photo(input, init) : realFetch(input, init));
  return photo;
}

async function render(photoURL: string) {
  mocks.profile = ana(photoURL);
  const response = await ProfileOpengraphImage(params("@ana.souza"));
  return { response, png: Buffer.from(await response.arrayBuffer()) };
}

// Card with the initial (a photo that cannot be used): the reference for the
// comparisons below.
async function initialCard() {
  stubPhotos("", "image/png");
  const { png } = await render("https://evil.example/ana.png");
  vi.unstubAllGlobals();
  return png;
}

/** A real PNG with the IHDR width and height swapped (the CRC is wrong, but it is never decoded). */
function pngClaiming(width: number, height: number) {
  const bytes = Uint8Array.from(readFileSync(join(process.cwd(), "public/brand/favicon-solid.png")));
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** Minimal JPEG header: SOI + SOF0 with height and width. */
function jpegClaiming(width: number, height: number) {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
}

afterEach(() => vi.unstubAllGlobals());

describe("teacher sharing card", () => {
  it("is a 1200×630 PNG with CDN cache", async () => {
    stubPhotos("x", "image/webp");
    const { response, png } = await render(`${AVATAR}.webp`);

    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    // The version (?v=) changes with the profile, so the CDN can keep the card.
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
  });

  it("draws the normal-size PNG photo", async () => {
    const initial = await initialCard();
    const photo = stubPhotos(Uint8Array.from(readFileSync(join(process.cwd(), "public/brand/favicon-solid.png"))), "image/png");
    const { png } = await render(`${AVATAR}.png`);

    expect(photo).toHaveBeenCalledTimes(1);
    expect(photo.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(png.equals(initial)).toBe(false);
  });

  // A 12000×12000 PNG fits in ~400 KB and cost ~1.3 GB to draw.
  it.each([
    ["PNG 12000×12000", () => pngClaiming(12_000, 12_000), "image/png"],
    ["PNG 4000×600", () => pngClaiming(4_000, 600), "image/png"],
    ["JPEG 12000×12000", () => jpegClaiming(12_000, 12_000), "image/jpeg"],
    ["PNG without header", () => new TextEncoder().encode("not a png"), "image/png"],
    ["WebP", () => new TextEncoder().encode("RIFF"), "image/webp"],
  ])("a photo that cannot be drawn (%s) becomes the initial", async (_case, body, type) => {
    const initial = await initialCard();
    const photo = stubPhotos(body(), type);
    const { png } = await render(`${AVATAR}.img`);

    expect(photo).toHaveBeenCalledTimes(1);
    expect(png.equals(initial)).toBe(true);
  });

  // SSRF: the photo URL comes from the profile; the server only fetches from the avatar
  // hosts the platform already accepts, on the default port.
  it("does not fetch a photo outside Supabase Storage and Google photos", async () => {
    const photo = stubPhotos("x", "image/png");
    for (const url of [
      "https://evil.example/ana.png",
      "https://example.supabase.co/rest/v1/users",
      "https://example.supabase.co.evil.example/storage/v1/object/public/a.png",
      "http://example.supabase.co/storage/v1/object/public/a.png",
      "https://example.supabase.co:8443/storage/v1/object/public/a.png",
      "https://lh3.googleusercontent.com:444/a/photo",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      const { png } = await render(url);
      expect(png.subarray(1, 4).toString("ascii"), url).toBe("PNG");
    }
    expect(photo).not.toHaveBeenCalled();
  });

  it("a profile that does not exist answers 404", async () => {
    const response = await ProfileOpengraphImage(params("@ninguem"));
    expect(response.status).toBe(404);
  });
});
