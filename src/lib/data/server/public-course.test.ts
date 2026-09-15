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

const { getCourseRefAccess } = await import("@/lib/data/server/public-course");

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

  it("falha de leitura nunca vira 404", async () => {
    server.client = fakeClient({ keyError: true });
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
    server.fail = true;
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
  });
});
