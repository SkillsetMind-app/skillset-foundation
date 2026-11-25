import { afterEach, describe, expect, it, vi } from "vitest";

// ANONYMOUS client: keeps the options it was created with and returns the
// fake client of the moment; without a fake client, it creates the real one (to see what
// postgrest-js does with the network).
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

// Fake client that records each step of the chained query.
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
  it("@usuario looks up by username, in lowercase", async () => {
    const calls = fakeClient({ data: row, error: null });

    const profile = await getPublicProfileByRef("@Ana.Souza");

    expect(profile).toMatchObject({ uid: row.uid, displayName: "Ana Souza", username: "ana.souza", credentials: ["ICF"] });
    expect(calls).toContainEqual(["from", "public_profiles"]);
    expect(calls).toContainEqual(["eq", "username", "ana.souza"]);
  });

  // select *: the profile does not break if the deploy arrives before the
  // verified badge migration (missing columns = no badge).
  it("reads with select *, and without the badge columns the profile comes out without a badge", async () => {
    const calls = fakeClient({ data: row, error: null });

    const profile = await getPublicProfileByRef("@ana.souza");

    expect(calls).toContainEqual(["select", "*"]);
    expect(profile).toMatchObject({ uid: row.uid, verification: null });
  });

  it("brings the verified badge: only license or evidence, and the date", async () => {
    fakeClient({
      data: { ...row, verified_professional: true, verification_kind: "license", verified_at: "2026-09-01T12:00:00+00:00" },
      error: null,
    });
    expect((await getPublicProfileByRef("@ana.souza"))?.verification)
      .toEqual({ kind: "license", verifiedAt: "2026-09-01T12:00:00+00:00" });

    fakeClient({ data: { ...row, verified_professional: true, verification_kind: "evidence", verified_at: null }, error: null });
    expect((await getPublicProfileByRef(row.uid))?.verification).toEqual({ kind: "evidence", verifiedAt: null });
  });

  it("without a badge, verification null; an unknown kind becomes evidence (the one that promises less)", async () => {
    fakeClient({ data: { ...row, verified_professional: false, verification_kind: null, verified_at: null }, error: null });
    expect((await getPublicProfileByRef("@ana.souza"))?.verification).toBeNull();

    fakeClient({ data: { ...row, verified_professional: true, verification_kind: "coach", verified_at: null }, error: null });
    expect((await getPublicProfileByRef(row.uid))?.verification).toEqual({ kind: "evidence", verifiedAt: null });
  });

  it("without @, looks up by uid exactly as it came", async () => {
    const calls = fakeClient({ data: row, error: null });
    await getPublicProfileByRef(row.uid);
    expect(calls).toContainEqual(["eq", "uid", row.uid]);
  });

  // Nobody impersonates the platform: @support, @admin... are 404.
  it("a reserved @ is a 404 without going to the database", async () => {
    const calls = fakeClient({ data: row, error: null });
    for (const ref of ["@support", "@Admin", "@skillsetmind", "@billing", "@official"]) {
      expect(await getPublicProfileByRef(ref), ref).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("an @ outside the username format does not even go to the database", async () => {
    const calls = fakeClient({ data: row, error: null });
    for (const ref of ["@a", "@-ana", "@ana souza", "@ana/x", `@${"a".repeat(33)}`]) {
      expect(await getPublicProfileByRef(ref)).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("a profile that does not exist is null (404); a read that failed throws (error page)", async () => {
    fakeClient({ data: null, error: null });
    expect(await getPublicProfileByRef("@ninguem")).toBeNull();

    fakeClient({ data: null, error: { message: "database down" } });
    await expect(getPublicProfileByRef("@ana.souza")).rejects.toMatchObject({ message: "database down" });
  });

  it("uses an anonymous client, with no retry, and a short deadline and cache", async () => {
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

  // Silent database: postgrest-js used to repeat the GET 3 times (1 s, 2 s, 4 s) and
  // Instagram waited ~13 s for an error page. Now it is a single attempt.
  it("gives up the first time the deadline blows", async () => {
    const timedOut = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    vi.stubGlobal("fetch", timedOut);

    await expect(getPublicProfileByRef("@ana.souza")).rejects.toBeTruthy();
    expect(timedOut).toHaveBeenCalledTimes(1);
  });
});

describe("listCreatorCourses", () => {
  it("only the teacher's published ones, without the internal test ones, with the public URL", async () => {
    const calls = fakeClient({
      data: [
        { id: "c-1", title: "Deep Focus", title_key: "deep-focus", slug: null, cover_image_url: null, payment_type: "free", price_amount_minor: null, currency: null, rating_average: null, rating_count: null, enrollment_count: null },
        { id: "c-2", title: "Calm", title_key: null, slug: "calm-legacy", cover_image_url: "https://x/c.jpg", payment_type: "one_time", price_amount_minor: 4900, currency: "usd", rating_average: 4.5, rating_count: 2, enrollment_count: 7 },
      ],
      error: null,
    });

    const courses = await listCreatorCourses("owner");

    expect(calls).toEqual(expect.arrayContaining([
      ["from", "courses"],
      ["eq", "owner_id", "owner"],
      ["eq", "status", "published"],
      ["not", "id", "like", "smoke-%"],
      ["not", "title", "like", "[QA]%"],
    ]));
    expect(courses).toEqual([
      expect.objectContaining({ id: "c-1", href: "/courses/deep-focus", free: true, currency: "USD", ratingCount: 0 }),
      expect.objectContaining({ id: "c-2", href: "/courses/c-2", free: false, priceAmountMinor: 4900, ratingAverage: 4.5, ratingCount: 2 }),
    ]);
    // enrollment_count is not maintained by anything in the database: it is not even read.
    expect(JSON.stringify(calls)).not.toContain("enrollment_count");
    expect(courses?.[0]).not.toHaveProperty("enrollmentCount");
  });

  it("a read failure counts as null and goes to the log", async () => {
    fakeClient({ data: null, error: { message: "database down" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await listCreatorCourses("owner")).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("listCreatorCourses"), expect.anything());
    } finally {
      log.mockRestore();
    }
  });
});
