import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

import { getMemberArea } from "@/lib/learn/server/member-area";

// One module now backs both the student classroom (/learn/courses/[slug]) and
// the teacher preview (/teach/builder/[id]/preview). These assertions are what
// makes "the preview shows exactly what a student sees" a property of the code
// instead of two copies someone has to keep in sync by hand.

type Row = Record<string, unknown> | null;

/** Stands in for the query chain: .from(t).select().eq().maybeSingle() */
function supabaseReturning(rows: { courses: Row; public_profiles: Row }) {
  return {
    from: (table: keyof typeof rows) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: rows[table], error: null }),
        }),
      }),
    }),
  };
}

describe("getMemberArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps our mark when the plan does not include whitelabel", async () => {
    mocks.createServer.mockResolvedValue(
      supabaseReturning({
        courses: { owner_id: "teacher-1", members_theme: "dark" },
        public_profiles: {
          display_name: "Ana",
          // No hidePlatformBrand: the DB decides, and absent means "not paid for".
          storefront: { branding: { logoUrl: "https://cdn.example/a.png" } },
        },
      }),
    );

    await expect(getMemberArea("course-1")).resolves.toEqual({
      brand: null,
      theme: "dark",
    });
  });

  it("swaps in the teacher's mark when hidePlatformBrand is true", async () => {
    mocks.createServer.mockResolvedValue(
      supabaseReturning({
        courses: { owner_id: "teacher-1", members_theme: "dark" },
        public_profiles: {
          display_name: "  Ana Souza  ",
          storefront: {
            branding: {
              hidePlatformBrand: true,
              logoUrl: "https://cdn.example/a.png",
              accentColor: "#a1b2c3",
            },
          },
        },
      }),
    );

    await expect(getMemberArea("course-1")).resolves.toEqual({
      brand: {
        name: "Ana Souza",
        logoUrl: "https://cdn.example/a.png",
        accentColor: "#a1b2c3",
      },
      theme: "dark",
    });
  });

  it("falls back to Instructor rather than rendering an empty brand name", async () => {
    mocks.createServer.mockResolvedValue(
      supabaseReturning({
        courses: { owner_id: "teacher-1", members_theme: "light" },
        public_profiles: {
          display_name: "   ",
          storefront: { branding: { hidePlatformBrand: true } },
        },
      }),
    );

    await expect(getMemberArea("course-1")).resolves.toEqual({
      brand: { name: "Instructor", logoUrl: null, accentColor: null },
      theme: "light",
    });
  });

  it("defaults an unknown members_theme to light instead of passing it through", async () => {
    mocks.createServer.mockResolvedValue(
      supabaseReturning({
        courses: { owner_id: null, members_theme: "neon" },
        public_profiles: null,
      }),
    );

    await expect(getMemberArea("course-1")).resolves.toEqual({
      brand: null,
      theme: "light",
    });
  });

  it("still renders the classroom when the branding lookup throws", async () => {
    // The point of the catch: a paying student never gets locked out of their
    // class because a cosmetic lookup failed.
    mocks.createServer.mockRejectedValue(new Error("supabase unreachable"));

    await expect(getMemberArea("course-1")).resolves.toEqual({
      brand: null,
      theme: "light",
    });
  });
});
