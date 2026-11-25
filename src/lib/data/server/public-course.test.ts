import { AuthError, AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The fake client returns what RLS would let THIS visitor read: the rows
// passed in `rows` are already the result of the policies for them.
const server = vi.hoisted(() => ({ client: null as unknown, fail: false }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    if (server.fail) throw new Error("no configuration");
    return server.client;
  },
}));

// ANONYMOUS client of hasRealPublishedCourse: no cookie. Keeps the options it
// was created with and returns the fake client of the moment; without a fake client, it creates the
// real one (to see what postgrest-js does with the network).
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

const { getCourseRefAccess, getShowcaseCourseCover, hasRealPublishedCourse, listPublishedCourses, marketplaceIsOpen } =
  await import("@/lib/data/server/public-course");

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

  it("a course nobody can read is a 404", async () => {
    server.client = fakeClient({});
    expect(await getCourseRefAccess("nao-existe")).toBe("missing");
  });

  it("a published course stays visible by id and by title_key", async () => {
    server.client = fakeClient({ rows: [published] });
    expect(await getCourseRefAccess("c-1")).toBe("visible");
    expect(await getCourseRefAccess("meu-curso")).toBe("visible");
  });

  it("a draft that RLS returns to the logged-in owner stays visible (preview)", async () => {
    server.client = fakeClient({ userId: "dono", rows: [draft] });
    expect(await getCourseRefAccess("c-1")).toBe("visible");
  });

  it("Auth down with a valid JWT: the row that RLS returned to the owner does not become a 404", async () => {
    for (const status of ["draft", "needs_changes", "inactive"]) {
      server.client = fakeClient({ userError: authDown, rows: [{ ...draft, status }] });
      expect(await getCourseRefAccess("c-1")).toBe("visible");
    }
  });

  it("in review: a logged-in stranger and an anonymous visitor get a 404, the owner sees it", async () => {
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

  it("in review: admin and ops in an aal2 session see it (moderation queue)", async () => {
    for (const role of ["admin", "ops"]) {
      server.client = fakeClient({ userId: "moderador", roles: [role], level: "aal2", rows: [inReview] });
      expect(await getCourseRefAccess("c-1")).toBe("visible");
    }
  });

  it("in review: an operational role without aal2 does not open the preview", async () => {
    server.client = fakeClient({ userId: "moderador", roles: ["admin"], level: "aal1", rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("missing");
  });

  it("in review: a failure of Auth, of the profile or of the session level never becomes a 404", async () => {
    server.client = fakeClient({ userError: authDown, rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("unknown");
    server.client = fakeClient({ userId: "moderador", rolesError: true, rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("unknown");
    server.client = fakeClient({ userId: "moderador", roles: ["admin"], levelError: true, rows: [inReview] });
    expect(await getCourseRefAccess("c-1")).toBe("unknown");
  });

  it("a failure in the lookup by id does not continue to title_key: it is unknown", async () => {
    server.client = fakeClient({ idError: true, rows: [published] });
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
  });

  // Suspended and restored account: GoTrue still accepts the old session, but the
  // restrictive policy account_access_guard hides every row of it — a published
  // course included. "Did not find it" there is not "does not exist".
  it("revoked session: RLS hides even the published course, and that is not a 404", async () => {
    const denied = new AuthError("Account access is unavailable.", 403, "account_access_denied");
    server.client = fakeClient({ userError: denied });
    expect(await getCourseRefAccess("c-1")).toBe("unknown");
    // Really logged in, a course that does not exist: still a 404.
    server.client = fakeClient({ userId: "aluno" });
    expect(await getCourseRefAccess("nao-existe")).toBe("missing");
  });

  it("a read failure never becomes a 404", async () => {
    server.client = fakeClient({ keyError: true });
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
    server.fail = true;
    expect(await getCourseRefAccess("meu-curso")).toBe("unknown");
  });
});

describe("listPublishedCourses", () => {
  // The store already hid the internal test courses; the sitemap and the home read
  // from here and need the SAME rule, otherwise the search engine indexes what the store hides.
  it("leaves out the internal test courses, by the same predicate as the store", async () => {
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
  // Fake client that records each filter of the chained query.
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

  // ONE row is enough: internal courses are filtered out in the SQL itself, by the same
  // prefixes as the store predicate, instead of fetching a thousand rows to count.
  it("asks the database for a single published course that is not internal", async () => {
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

  it("a store with only internal courses (or empty) answers no", async () => {
    anonClient({ data: [], error: null });
    expect(await hasRealPublishedCourse()).toBe(false);
  });

  // No visitor cookie (an expired token does not become a 401), response cached
  // for 5 min and giving up after 1.5 s: the home does not wait for the database.
  it("uses an anonymous client, with a 5-minute cache and a short deadline", async () => {
    anonClient({ data: [], error: null });
    await hasRealPublishedCourse();

    const options = anon.options as {
      auth: { persistSession: boolean };
      db: { retry?: boolean };
      global: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
    };
    expect(options.auth.persistSession).toBe(false);
    expect(options.db.retry).toBe(false);

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

  // Silent database: the 1.5 s deadline blows up with a TimeoutError, which postgrest-js
  // used to retry 3 times (waiting 1 s, 2 s and 4 s) — each route waited ~13 s.
  // Now it is a single attempt, and the answer is no.
  it("gives up the first time the deadline blows, without retrying", async () => {
    anon.client = null;
    const timedOut = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    vi.stubGlobal("fetch", timedOut);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await hasRealPublishedCourse()).toBe(false);
      expect(timedOut).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("a read failure answers no and goes to the log", async () => {
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

// The "See a real course" card on the home: a course's title and cover, through the same
// anonymous, cached read of hasRealPublishedCourse.
describe("getShowcaseCourseCover", () => {
  function anonClient(result: { data: unknown; error: unknown }) {
    const calls: unknown[][] = [];
    const query = {
      select: (...args: unknown[]) => (calls.push(["select", ...args]), query),
      eq: (...args: unknown[]) => (calls.push(["eq", ...args]), query),
      maybeSingle: async () => (calls.push(["maybeSingle"]), result),
    };
    anon.client = { from: (table: string) => (calls.push(["from", table]), query) };
    return calls;
  }

  it("reads only the title and cover of the published course with that id", async () => {
    const calls = anonClient({ data: { title: "Emotional Intelligence Mastery", cover_image_url: "https://x/capa.jpg" }, error: null });

    expect(await getShowcaseCourseCover("c-1")).toEqual({
      title: "Emotional Intelligence Mastery",
      coverImageUrl: "https://x/capa.jpg",
    });
    expect(calls).toEqual([
      ["from", "courses"],
      ["select", "title, cover_image_url"],
      ["eq", "id", "c-1"],
      ["eq", "status", "published"],
      ["maybeSingle"],
    ]);
  });

  it("a course that is not published (or does not exist) answers null", async () => {
    anonClient({ data: null, error: null });
    expect(await getShowcaseCourseCover("c-1")).toBeNull();
  });

  it("a read failure answers null and goes to the log", async () => {
    anonClient({ data: null, error: { message: "banco fora" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await getShowcaseCourseCover("c-1")).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("getShowcaseCourseCover"), expect.anything());
    } finally {
      log.mockRestore();
    }
  });

  // Silent database: a single attempt, aborted by the deadline, cached for 5 min. The home
  // comes out with the text card instead of waiting and retrying.
  it("gives up the first time the deadline blows, without retrying, and answers null", async () => {
    anon.client = null;
    const timedOut = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    vi.stubGlobal("fetch", timedOut);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await getShowcaseCourseCover("c-1")).toBeNull();
      expect(timedOut).toHaveBeenCalledTimes(1);
      const init = timedOut.mock.calls[0]?.[1] as RequestInit & { next?: { revalidate?: number } };
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.next?.revalidate).toBe(300);
    } finally {
      log.mockRestore();
      vi.unstubAllGlobals();
    }
    const options = anon.options as { auth: { persistSession: boolean }; db: { retry?: boolean } };
    expect(options.auth.persistSession).toBe(false);
    expect(options.db.retry).toBe(false);
  });
});

// Automatic storefront (the owner's decision, Nov 13, 2026): opens with 12 real courses
// published by 5 different teachers, and closes by itself below that.
describe("marketplaceIsOpen", () => {
  const owners = (courses: number, teachers: number) =>
    Array.from({ length: courses }, (_, i) => `t${i % teachers}`);

  it("opens with 12 courses from 5 teachers", () => {
    expect(marketplaceIsOpen(owners(12, 5))).toBe(true);
    expect(marketplaceIsOpen(owners(40, 9))).toBe(true);
  });

  it("stays closed with 11 courses, or with 12 courses from only 4 teachers", () => {
    expect(marketplaceIsOpen(owners(11, 5))).toBe(false);
    expect(marketplaceIsOpen(owners(12, 4))).toBe(false);
    expect(marketplaceIsOpen(owners(2, 1))).toBe(false);
    expect(marketplaceIsOpen([])).toBe(false);
  });
});
