import { AuthError, AuthSessionMissingError } from "@supabase/supabase-js";
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

// Cliente ANÔNIMO de hasRealPublishedCourse: sem cookie. Guarda as opções com
// que foi criado e devolve o cliente falso da vez.
const anon = vi.hoisted(() => ({ client: null as unknown, options: null as unknown }));
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: (_url: string, _key: string, options: unknown) => {
    anon.options = options;
    return anon.client;
  },
}));
vi.mock("@/lib/supabase/config", () => ({
  assertSupabaseClientConfig: () => ({ url: "https://example.supabase.co", anonKey: "anon" }),
}));

const { getCourseRefAccess, hasRealPublishedCourse, listPublishedCourses } = await import("@/lib/data/server/public-course");

type Row = { id: string; title_key: string | null; status: string; owner_id: string };

function fakeClient({
  userId = null,
  userError = null,
  rows = [],
  idError = false,
  keyError = false,
  roles = ["student"],
  rolesError = false,
  level = "aal1",
  levelError = false,
}: {
  userId?: string | null;
  userError?: unknown;
  rows?: Row[];
  idError?: boolean;
  keyError?: boolean;
  roles?: string[];
  rolesError?: boolean;
  level?: string;
  levelError?: boolean;
}) {
  const fora = { message: "banco fora" };
  const courses = (value: string) => ({
    maybeSingle: async () =>
      idError
        ? { data: null, error: fora }
        : { data: rows.find((row) => row.id === value) ?? null, error: null },
    limit: async () =>
      keyError
        ? { data: null, error: fora }
        : { data: rows.filter((row) => row.title_key === value), error: null },
  });
  const users = (value: string) => ({
    maybeSingle: async () =>
      rolesError
        ? { data: null, error: fora }
        : { data: value === userId ? { roles } : null, error: null },
  });
  const session = {
    getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: userError }),
    mfa: {
      getAuthenticatorAssuranceLevel: async () =>
        levelError
          ? { data: null, error: fora }
          : { data: { currentLevel: level }, error: null },
    },
  };
  return {
    auth: session,
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, value: string) =>
          table === "users" ? users(value) : courses(value),
      }),
    }),
  };
}

const draft: Row = { id: "c-1", title_key: "meu-curso", status: "draft", owner_id: "dono" };
const published: Row = { ...draft, status: "published" };
const inReview: Row = { ...draft, status: "in_review" };
const authDown = new AuthError("fetch failed", 0, "unexpected_failure");

describe("getCourseRefAccess", () => {
  beforeEach(() => {
    server.fail = false;
  });

  it("curso que ninguem consegue ler e 404", async () => {
    server.client = fakeClient({});
    expect(await getCourseRefAccess("nao-existe")).toBe("missing");
  });

  it("curso publicado continua visivel pelo id e pelo title_key", async () => {
    server.client = fakeClient({ rows: [published] });
    expect(await getCourseRefAccess("c-1")).toBe("visible");
    expect(await getCourseRefAccess("meu-curso")).toBe("visible");
  });

  it("rascunho que a RLS devolve para o dono logado continua visivel (previa)", async () => {
    server.client = fakeClient({ userId: "dono", rows: [draft] });
    expect(await getCourseRefAccess("c-1")).toBe("visible");
  });

  it("Auth fora com o JWT valido: a linha que a RLS devolveu ao dono nao vira 404", async () => {
    for (const status of ["draft", "needs_changes", "inactive"]) {
      server.client = fakeClient({ userError: authDown, rows: [{ ...draft, status }] });
      expect(await getCourseRefAccess("c-1")).toBe("visible");
    }
  });

  it("em revisao: estranho logado e visitante anonimo recebem 404, o dono ve", async () => {
    server.client = fakeClient({ userId: "outra-pessoa", rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("missing");
    server.client = fakeClient({ rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("missing");
    server.client = fakeClient({ userError: new AuthSessionMissingError(), rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("missing");
    server.client = fakeClient({
      userError: new AuthError("Finish signing in.", 401, "mfa_required"),
      rows: [inReview],
    });
    expect(await getCourseRefAccess("c-1")).toBe("missing");
    server.client = fakeClient({ userId: "dono", rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("visible");
  });

  it("em revisao: admin e ops em sessao aal2 veem (fila de moderacao)", async () => {
    for (const role of ["admin", "ops"]) {
      server.client = fakeClient({ userId: "moderador", roles: [role], level: "aal2", rows: [inReview] });
      expect(await getCourseRefAccess("c-1")).toBe("visible");
    }
  });

  it("em revisao: papel operacional sem aal2 nao abre a previa", async () => {
    server.client = fakeClient({ userId: "moderador", roles: ["admin"], level: "aal1", rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("missing");
  });

  it("em revisao: falha do Auth, do perfil ou do nivel de sessao nunca vira 404", async () => {
    server.client = fakeClient({ userError: authDown, rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("unknown");
    server.client = fakeClient({ userId: "moderador", rolesError: true, rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("unknown");
    server.client = fakeClient({ userId: "moderador", roles: ["admin"], levelError: true, rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("unknown");
  });

  it("falha na busca por id nao segue para o title_key: e unknown", async () => {
    server.client = fakeClient({ idError: true, rows: [published] });
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
  });

  // Conta suspensa e restaurada: o GoTrue ainda aceita a sessao antiga, mas a
  // policy restritiva account_access_guard esconde toda linha dela — curso
  // publicado inclusive. "Nao achei" ali nao e "nao existe".
  it("sessao revogada: a RLS esconde ate o curso publicado, e isso nao e 404", async () => {
    const denied = new AuthError("Account access is unavailable.", 403, "account_access_denied");
    server.client = fakeClient({ userError: denied });
    expect(await getCourseRefAccess("c-1")).toBe("unknown");
    // Logado de verdade, curso que nao existe: continua 404.
    server.client = fakeClient({ userId: "aluno" });
    expect(await getCourseRefAccess("nao-existe")).toBe("missing");
  });

  it("falha de leitura nunca vira 404", async () => {
    server.client = fakeClient({ keyError: true });
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
    server.fail = true;
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
  });
});

describe("listPublishedCourses", () => {
  // A loja já escondia os cursos internos de teste; o sitemap e a home leem
  // daqui e precisam da MESMA regra, senão o buscador indexa o que a loja esconde.
  it("deixa de fora os cursos internos de teste, pelo mesmo predicado da loja", async () => {
    const base = { summary: null, category: null, cover_image_url: null, lesson_count: 2, slug: null, status: "published", updated_at: null };
    const rows = [
      { ...base, id: "c-real", title: "Deep Focus Systems", title_key: "deep-focus-systems" },
      { ...base, id: "smoke-ci-course", title: "Smoke checkout", title_key: "smoke-checkout" },
      { ...base, id: "c-qa", title: "[QA] Curso de teste interno", title_key: "qa-curso-de-teste-interno" },
    ];
    server.fail = false;
    server.client = {
      from: () => ({
        select: () => ({
          eq: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }),
        }),
      }),
    };

    expect((await listPublishedCourses()).map((course) => course.urlSlug)).toEqual(["deep-focus-systems"]);
  });
});

describe("hasRealPublishedCourse", () => {
  // Cliente falso que anota cada filtro da consulta encadeada.
  function anonClient(result: { data: unknown[] | null; error: unknown }) {
    const calls: unknown[][] = [];
    const query = {
      select: (...args: unknown[]) => (calls.push(["select", ...args]), query),
      eq: (...args: unknown[]) => (calls.push(["eq", ...args]), query),
      not: (...args: unknown[]) => (calls.push(["not", ...args]), query),
      limit: async (...args: unknown[]) => (calls.push(["limit", ...args]), result),
    };
    anon.client = { from: (table: string) => (calls.push(["from", table]), query) };
    return calls;
  }

  // Basta UMA linha: os cursos internos saem no próprio SQL, pelos mesmos
  // prefixos do predicado da loja, em vez de trazer mil linhas para contar.
  it("pergunta ao banco por um único curso publicado que não seja interno", async () => {
    const calls = anonClient({ data: [{ id: "c-real" }], error: null });

    expect(await hasRealPublishedCourse()).toBe(true);
    expect(calls).toEqual([
      ["from", "courses"],
      ["select", "id"],
      ["eq", "status", "published"],
      ["not", "id", "like", "smoke-%"],
      ["not", "title", "like", "[QA]%"],
      ["limit", 1],
    ]);
  });

  it("loja só com cursos internos (ou vazia) responde não", async () => {
    anonClient({ data: [], error: null });
    expect(await hasRealPublishedCourse()).toBe(false);
  });

  // Sem cookie do visitante (token vencido não vira 401), resposta guardada
  // por 5 min e desistência em 1,5 s: a home não espera o banco.
  it("usa cliente anônimo, com cache de 5 minutos e prazo curto", async () => {
    anonClient({ data: [], error: null });
    await hasRealPublishedCourse();

    const options = anon.options as {
      auth: { persistSession: boolean };
      global: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
    };
    expect(options.auth.persistSession).toBe(false);

    const realFetch = vi.fn<typeof fetch>(async () => new Response("[]"));
    vi.stubGlobal("fetch", realFetch);
    try {
      await options.global.fetch("https://example.supabase.co/rest/v1/courses", { method: "GET" });
    } finally {
      vi.unstubAllGlobals();
    }
    const init = realFetch.mock.calls[0]?.[1] as RequestInit & { next?: { revalidate?: number } };
    expect(init.method).toBe("GET");
    expect(init.next?.revalidate).toBe(300);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("falha de leitura responde não e fica no log", async () => {
    anonClient({ data: null, error: { message: "banco fora" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await hasRealPublishedCourse()).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("hasRealPublishedCourse"), expect.anything());
    } finally {
      log.mockRestore();
    }
  });
});
