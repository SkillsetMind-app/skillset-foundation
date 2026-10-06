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

// O renderizador também usa fetch (wasm, fonte): só as buscas de foto são
// falsas, e ficam anotadas.
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

// Cartão com a inicial (foto que não pode ser usada): a referência das
// comparações abaixo.
async function initialCard() {
  stubPhotos("", "image/png");
  const { png } = await render("https://evil.example/ana.png");
  vi.unstubAllGlobals();
  return png;
}

/** PNG de verdade com a largura e a altura do IHDR trocadas (o CRC fica errado, mas nunca chega a ser decodificado). */
function pngClaiming(width: number, height: number) {
  const bytes = Uint8Array.from(readFileSync(join(process.cwd(), "public/brand/favicon-solid.png")));
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** Cabeçalho JPEG mínimo: SOI + SOF0 com altura e largura. */
function jpegClaiming(width: number, height: number) {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
}

afterEach(() => vi.unstubAllGlobals());

describe("cartão de compartilhamento do professor", () => {
  it("é um PNG 1200×630 com cache de CDN", async () => {
    stubPhotos("x", "image/webp");
    const { response, png } = await render(`${AVATAR}.webp`);

    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    // A versão (?v=) muda com o perfil, então o CDN pode guardar o cartão.
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
  });

  it("desenha a foto PNG de tamanho normal", async () => {
    const initial = await initialCard();
    const photo = stubPhotos(Uint8Array.from(readFileSync(join(process.cwd(), "public/brand/favicon-solid.png"))), "image/png");
    const { png } = await render(`${AVATAR}.png`);

    expect(photo).toHaveBeenCalledTimes(1);
    expect(photo.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(png.equals(initial)).toBe(false);
  });

  // Um PNG de 12000×12000 cabe em ~400 KB e custava ~1,3 GB para desenhar.
  it.each([
    ["PNG 12000×12000", () => pngClaiming(12_000, 12_000), "image/png"],
    ["PNG 4000×600", () => pngClaiming(4_000, 600), "image/png"],
    ["JPEG 12000×12000", () => jpegClaiming(12_000, 12_000), "image/jpeg"],
    ["PNG sem cabeçalho", () => new TextEncoder().encode("not a png"), "image/png"],
    ["WebP", () => new TextEncoder().encode("RIFF"), "image/webp"],
  ])("foto que não dá para desenhar (%s) vira a inicial", async (_case, body, type) => {
    const initial = await initialCard();
    const photo = stubPhotos(body(), type);
    const { png } = await render(`${AVATAR}.img`);

    expect(photo).toHaveBeenCalledTimes(1);
    expect(png.equals(initial)).toBe(true);
  });

  // SSRF: a URL da foto vem do perfil; o servidor só busca nos hosts de
  // avatar que a plataforma já aceita, na porta padrão.
  it("não busca foto fora do Storage do Supabase e das fotos do Google", async () => {
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

  it("perfil que não existe responde 404", async () => {
    const response = await ProfileOpengraphImage(params("@ninguem"));
    expect(response.status).toBe(404);
  });
});
