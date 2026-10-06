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

const { default: ProfileOpengraphImage, contentType, size } = await import("./opengraph-image");

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

afterEach(() => vi.unstubAllGlobals());

describe("cartão de compartilhamento do professor", () => {
  it("é um PNG 1200×630 mesmo quando a foto não pode ser desenhada", async () => {
    mocks.profile = {
      uid: "u-1",
      displayName: "Ana Souza",
      username: "ana.souza",
      photoURL: "https://example.supabase.co/storage/v1/object/public/avatars/ana.webp",
      bio: null,
      credentials: [],
    };
    // WebP não é desenhado: o cartão sai com a inicial em vez de quebrar.
    // O renderizador também usa fetch (wasm, fonte): só a foto é falsa.
    const realFetch = globalThis.fetch;
    const photo = vi.fn<typeof fetch>(async () => new Response("x", { headers: { "content-type": "image/webp" } }));
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://example.supabase.co/") ? photo(input, init) : realFetch(input, init));

    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    const response = await ProfileOpengraphImage(params("@ana.souza"));
    const png = Buffer.from(await response.arrayBuffer());

    expect(photo).toHaveBeenCalledTimes(1);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it("perfil que não existe responde 404", async () => {
    const response = await ProfileOpengraphImage(params("@ninguem"));
    expect(response.status).toBe(404);
  });
});
