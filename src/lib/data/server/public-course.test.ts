import { beforeEach, describe, expect, it, vi } from "vitest";

// O cliente falso devolve o que a RLS deixaria ESTE visitante ler: as linhas
// passadas em `rows` ja sao o resultado das policies para ele.
const server = vi.hoisted(() => ({ client: null as unknown, fail: false }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    if (server.fail) throw new Error("sem configuracao");
    return server.client;
  },
}));

const { getCourseRefAccess } = await import("@/lib/data/server/public-course");

type Row = { id: string; title_key: string | null; status: string; owner_id: string };

function fakeClient({
  userId = null,
  rows = [],
  idError = false,
  keyError = false,
}: {
  userId?: string | null;
  rows?: Row[];
  idError?: boolean;
  keyError?: boolean;
}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () =>
            idError
              ? { data: null, error: { code: "22P02" } }
              : { data: rows.find((row) => row.id === value) ?? null, error: null },
          limit: async () =>
            keyError
              ? { data: null, error: { message: "banco fora" } }
              : { data: rows.filter((row) => row.title_key === value), error: null },
        }),
      }),
    }),
  };
}

const draft: Row = { id: "c-1", title_key: "meu-curso", status: "draft", owner_id: "dono" };

describe("getCourseRefAccess", () => {
  beforeEach(() => {
    server.fail = false;
  });

  it("curso que ninguem consegue ler e 404", async () => {
    server.client = fakeClient({});
    expect(await getCourseRefAccess("nao-existe")).toBe("missing");
  });

  it("curso publicado achado pelo title_key e visivel para o visitante anonimo", async () => {
    server.client = fakeClient({ rows: [{ ...draft, status: "published" }] });
    expect(await getCourseRefAccess("meu-curso")).toBe("visible");
  });

  it("rascunho que a RLS devolve para o dono logado continua visivel (previa)", async () => {
    server.client = fakeClient({ userId: "dono", rows: [draft] });
    expect(await getCourseRefAccess("c-1")).toBe("visible");
  });

  it("rascunho sem sessao nunca e visivel", async () => {
    server.client = fakeClient({ rows: [draft] });
    expect(await getCourseRefAccess("c-1")).toBe("missing");
  });

  it("em revisao a policy e publica: so o dono ve", async () => {
    const inReview = { ...draft, status: "in_review" };
    server.client = fakeClient({ userId: "outra-pessoa", rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("missing");
    server.client = fakeClient({ userId: "dono", rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("visible");
  });

  it("ref que nao e uuid falha na busca por id e segue para o title_key", async () => {
    server.client = fakeClient({ idError: true, rows: [{ ...draft, status: "published" }] });
    expect(await getCourseRefAccess("meu-curso")).toBe("visible");
  });

  it("falha de leitura nunca vira 404", async () => {
    server.client = fakeClient({ idError: true, keyError: true });
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
    server.fail = true;
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
  });
});
