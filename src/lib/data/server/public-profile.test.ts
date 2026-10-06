import { afterEach, describe, expect, it, vi } from "vitest";

// Cliente ANÔNIMO: guarda as opções com que foi criado e devolve o cliente
// falso da vez; sem cliente falso, cria o de verdade (para ver o que o
// postgrest-js faz com a rede).
const anon = vi.hoisted(() => ({ client: null as unknown, options: null as unknown }));
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  return {
    ...actual,
    createClient: (url: string, key: string, options: Parameters<typeof actual.createClient>[2]) => {
      anon.options = options;
      return anon.client ?? actual.createClient(url, key, options);
    },
  };
});
vi.mock("@/lib/supabase/config", () => ({
  assertSupabaseClientConfig: () => ({ url: "https://example.supabase.co", anonKey: "anon" }),
}));

const { getPublicProfileByRef, listCreatorCourses } = await import("@/lib/data/server/public-profile");

// Cliente falso que anota cada passo da consulta encadeada.
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const query = {
    select: (...args: unknown[]) => (calls.push(["select", ...args]), query),
    eq: (...args: unknown[]) => (calls.push(["eq", ...args]), query),
    not: (...args: unknown[]) => (calls.push(["not", ...args]), query),
    order: (...args: unknown[]) => (calls.push(["order", ...args]), query),
    limit: async (...args: unknown[]) => (calls.push(["limit", ...args]), result),
    maybeSingle: async () => (calls.push(["maybeSingle"]), result),
  };
  anon.client = { from: (table: string) => (calls.push(["from", table]), query) };
  return calls;
}

const row = {
  uid: "6f1c2a7e-0000-4000-8000-000000000001",
  display_name: "Ana Souza",
  username: "ana.souza",
  photo_url: null,
  bio: "Coach",
  credentials: ["ICF"],
  storefront: null,
  updated_at: null,
};

afterEach(() => {
  anon.client = null;
  vi.unstubAllGlobals();
});

describe("getPublicProfileByRef", () => {
  it("@usuario procura pelo username, em minúsculas", async () => {
    const calls = fakeClient({ data: row, error: null });

    const profile = await getPublicProfileByRef("@Ana.Souza");

    expect(profile).toMatchObject({ uid: row.uid, displayName: "Ana Souza", username: "ana.souza", credentials: ["ICF"] });
    expect(calls).toContainEqual(["from", "public_profiles"]);
    expect(calls).toContainEqual(["eq", "username", "ana.souza"]);
  });

  it("sem @, procura pelo uid exatamente como veio", async () => {
    const calls = fakeClient({ data: row, error: null });
    await getPublicProfileByRef(row.uid);
    expect(calls).toContainEqual(["eq", "uid", row.uid]);
  });

  // Ninguém se passa pela plataforma: @support, @admin... são 404.
  it("@ reservado é 404 sem ir ao banco", async () => {
    const calls = fakeClient({ data: row, error: null });
    for (const ref of ["@support", "@Admin", "@skillsetmind", "@billing", "@official"]) {
      expect(await getPublicProfileByRef(ref), ref).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("@ fora do formato de username nem vai ao banco", async () => {
    const calls = fakeClient({ data: row, error: null });
    for (const ref of ["@a", "@-ana", "@ana souza", "@ana/x", `@${"a".repeat(33)}`]) {
      expect(await getPublicProfileByRef(ref)).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("perfil que não existe é null (404); leitura que falhou lança (página de erro)", async () => {
    fakeClient({ data: null, error: null });
    expect(await getPublicProfileByRef("@ninguem")).toBeNull();

    fakeClient({ data: null, error: { message: "banco fora" } });
    await expect(getPublicProfileByRef("@ana.souza")).rejects.toMatchObject({ message: "banco fora" });
  });

  it("usa cliente anônimo, sem nova tentativa, com prazo e cache curtos", async () => {
    fakeClient({ data: row, error: null });
    await getPublicProfileByRef("@ana.souza");

    const options = anon.options as {
      auth: { persistSession: boolean };
      db: { retry?: boolean };
      global: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
    };
    expect(options.auth.persistSession).toBe(false);
    expect(options.db.retry).toBe(false);

    const realFetch = vi.fn<typeof fetch>(async () => new Response("[]"));
    vi.stubGlobal("fetch", realFetch);
    await options.global.fetch("https://example.supabase.co/rest/v1/public_profiles", { method: "GET" });
    const init = realFetch.mock.calls[0]?.[1] as RequestInit & { next?: { revalidate?: number } };
    expect(init.next?.revalidate).toBe(60);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // Banco mudo: o postgrest-js repetia o GET 3 vezes (1 s, 2 s, 4 s) e o
  // Instagram esperava ~13 s por uma página de erro. Agora é uma tentativa.
  it("desiste na primeira vez que o prazo estoura", async () => {
    const timedOut = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    vi.stubGlobal("fetch", timedOut);

    await expect(getPublicProfileByRef("@ana.souza")).rejects.toBeTruthy();
    expect(timedOut).toHaveBeenCalledTimes(1);
  });
});

describe("listCreatorCourses", () => {
  it("só os publicados do professor, sem os internos de teste, com a URL pública", async () => {
    const calls = fakeClient({
      data: [
        { id: "c-1", title: "Deep Focus", title_key: "deep-focus", slug: null, cover_image_url: null, payment_type: "free", price_amount_minor: null, currency: null, rating_average: null, rating_count: null, enrollment_count: null },
        { id: "c-2", title: "Calm", title_key: null, slug: "calm-legacy", cover_image_url: "https://x/c.jpg", payment_type: "one_time", price_amount_minor: 4900, currency: "usd", rating_average: 4.5, rating_count: 2, enrollment_count: 7 },
      ],
      error: null,
    });

    const courses = await listCreatorCourses("dono");

    expect(calls).toEqual(expect.arrayContaining([
      ["from", "courses"],
      ["eq", "owner_id", "dono"],
      ["eq", "status", "published"],
      ["not", "id", "like", "smoke-%"],
      ["not", "title", "like", "[QA]%"],
    ]));
    expect(courses).toEqual([
      expect.objectContaining({ id: "c-1", href: "/courses/deep-focus", free: true, currency: "USD", ratingCount: 0 }),
      expect.objectContaining({ id: "c-2", href: "/courses/c-2", free: false, priceAmountMinor: 4900, ratingAverage: 4.5, ratingCount: 2 }),
    ]);
    // enrollment_count não é mantido por nada no banco: nem é lido.
    expect(JSON.stringify(calls)).not.toContain("enrollment_count");
    expect(courses?.[0]).not.toHaveProperty("enrollmentCount");
  });

  it("falha de leitura vale null e fica no log", async () => {
    fakeClient({ data: null, error: { message: "banco fora" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await listCreatorCourses("dono")).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("listCreatorCourses"), expect.anything());
    } finally {
      log.mockRestore();
    }
  });
});
