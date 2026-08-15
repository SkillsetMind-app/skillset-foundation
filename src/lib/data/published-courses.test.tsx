import { describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));

import {
  courseUrlSlug,
  subscribeToViewableTeacherCourse,
} from "@/lib/data/published-courses";
import type { Database } from "@/lib/supabase/database.types";

type CourseRow = Database["public"]["Tables"]["courses"]["Row"];

const courseRow = {
  id: "course-abc123",
  owner_id: "teacher-1",
  title: "Clinical Performance",
  title_key: "clinical-performance",
  summary: "A course.",
  category: "performance",
  categories: [],
  learning_outcomes: [],
  status: "published",
  modules: [],
  lesson_count: 3,
  price_amount_minor: 24900,
  currency: "USD",
  community_enabled: false,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
} as unknown as CourseRow;

/**
 * Minimal Supabase stub: records which columns were queried and what the
 * realtime channel was filtered on. `hit` decides whether the id lookup
 * matches, which is the whole branch under test.
 */
function stubClient({ idMatches }: { idMatches: boolean }) {
  const queriedColumns: string[] = [];
  const channelFilters: string[] = [];

  const client = {
    from: () => ({
      select: () => ({
        eq: (column: string) => {
          queriedColumns.push(column);
          return {
            maybeSingle: async () => ({
              data: idMatches ? courseRow : null,
              error: null,
            }),
            limit: async () => ({ data: [courseRow], error: null }),
          };
        },
      }),
    }),
    channel: () => ({
      on: (
        _event: string,
        config: { filter: string },
      ) => {
        channelFilters.push(config.filter);
        return { subscribe: () => ({}) };
      },
    }),
    removeChannel: () => undefined,
  };

  supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);
  return { queriedColumns, channelFilters };
}

describe("courseUrlSlug", () => {
  it("prefers the title_key slug and falls back to the id", () => {
    expect(courseUrlSlug({ id: "course-abc123", titleKey: "clinical-performance" }))
      .toBe("clinical-performance");
    expect(courseUrlSlug({ id: "course-abc123", titleKey: undefined }))
      .toBe("course-abc123");
  });
});

describe("subscribeToViewableTeacherCourse", () => {
  it("resolves an id segment without falling through to the slug lookup", async () => {
    const { queriedColumns, channelFilters } = stubClient({ idMatches: true });
    const onCourse = vi.fn();

    subscribeToViewableTeacherCourse("course-abc123", onCourse, () => {});
    await vi.waitFor(() => expect(onCourse).toHaveBeenCalled());

    expect(queriedColumns).toEqual(["id"]);
    expect(onCourse.mock.calls[0][0]).toMatchObject({ id: "course-abc123" });
    expect(channelFilters).toEqual(["id=eq.course-abc123"]);
  });

  it("falls back to title_key and still subscribes by primary key", async () => {
    const { queriedColumns, channelFilters } = stubClient({ idMatches: false });
    const onCourse = vi.fn();

    subscribeToViewableTeacherCourse("clinical-performance", onCourse, () => {});
    await vi.waitFor(() => expect(onCourse).toHaveBeenCalled());

    expect(queriedColumns).toEqual(["id", "title_key"]);
    expect(onCourse.mock.calls[0][0]).toMatchObject({ id: "course-abc123" });
    // The realtime filter must never carry the slug the visitor typed.
    expect(channelFilters).toEqual(["id=eq.course-abc123"]);
  });
});
