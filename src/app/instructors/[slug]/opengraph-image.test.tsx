// @vitest-environment node
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
function stubPhotos(response: () => Response) {
  const realFetch = globalThis.fetch;
  const photo = vi.fn<typeof fetch>(async () => response());
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith("https://") ? photo(input, init) : realFetch(input, init));
  return photo;
}

async function render() {
  const response = await ProfileOpengraphImage(params("@ana.souza"));
  return Buffer.from(await response.arrayBuffer());
}

afterEach(() => vi.unstubAllGlobals());

describe("cartão de compartilhamento do professor", () => {
  it("é um PNG 1200×630 mesmo quando a foto não pode ser desenhada", async () => {
    mocks.profile = ana("https://example.supabase.co/storage/v1/object/public/avatars/ana.webp");
    // WebP não é desenhado: o cartão sai com a inicial em vez de quebrar.
    const photo = stubPhotos(() => new Response("x", { headers: { "content-type": "image/webp" } }));

    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    const png = await render();

    expect(photo).toHaveBeenCalledTimes(1);
    expect(photo.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  // SSRF: a URL da foto vem do perfil; o servidor só busca nos hosts de
  // avatar que a plataforma já aceita.
  it("não busca foto fora do Storage do Supabase e das fotos do Google", async () => {
    const photo = stubPhotos(() => new Response("x", { headers: { "content-type": "image/png" } }));
    for (const url of [
      "https://evil.example/ana.png",
      "https://example.supabase.co/rest/v1/users",
      "https://example.supabase.co.evil.example/storage/v1/object/public/a.png",
      "http://example.supabase.co/storage/v1/object/public/a.png",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      mocks.profile = ana(url);
      const png = await render();
      expect(png.subarray(1, 4).toString("ascii"), url).toBe("PNG");
    }
    expect(photo).not.toHaveBeenCalled();
  });

  it("perfil que não existe responde 404", async () => {
    const response = await ProfileOpengraphImage(params("@ninguem"));
    expect(response.status).toBe(404);
  });
});
