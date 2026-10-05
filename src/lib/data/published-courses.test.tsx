import { describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));

import {
  courseUrlSlug,
  fetchCoursesByIds,
  fetchPublishedCoursesForRows,
  rowToTeacherCourse,
  subscribeToViewableTeacherCourse,
  teacherCourseToLearningCourse,
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

describe("teacherCourseToLearningCourse module covers", () => {
  it("preserves explicit cover selection from the database module through the learner adapter", () => {
    const teacher = rowToTeacherCourse({
      ...courseRow,
      modules: [
        { id: "m1", title: "Module one", summary: "Authored description", coverAssetId: "selected-cover",
          lessons: [{ id: "l1", title: "First lesson", type: "text", description: "Lesson description" }] },
        { id: "m2", title: "Legacy module", lessons: [] },
      ],
    });
    const result = teacherCourseToLearningCourse(teacher);
    expect(result.modules[0]).toMatchObject({
      id: "m1", title: "Module one", summary: "Authored description", coverAssetId: "selected-cover",
      lessons: [{ id: "l1", title: "First lesson", type: "text", description: "Lesson description" }],
    });
    expect(result.modules[1].coverAssetId).toBeNull();
    expect(teacher.modules[0].coverAssetId).toBe("selected-cover");
  });

  // "Self-paced" em toda linha e "N lessons" como descricao de modulo nao sao
  // dados: eram texto de enchimento repetido pela sala inteira.
  it("leaves duration and module summary empty when the teacher gave none", () => {
    const teacher = rowToTeacherCourse({
      ...courseRow,
      modules: [
        { id: "m1", title: "Module one", lessons: [
          { id: "l1", title: "No duration", type: "text" },
          { id: "l2", title: "Timed", type: "video", durationMinutes: 12 },
        ] },
      ],
    });
    const result = teacherCourseToLearningCourse(teacher);
    expect(result.modules[0].summary).toBe("");
    expect(result.modules[0].lessons.map((lesson) => lesson.duration)).toEqual(["", "12 min"]);
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

/** Chainable stub recording the columns and filters of every read. */
function recordingClient(rows: unknown[] = [courseRow]) {
  const reads: { columns: string; filters: string[] }[] = [];
  supabaseMocks.getSupabaseBrowserClient.mockReturnValue({
    from: () => ({
      select: (columns: string) => {
        const read = { columns, filters: [] as string[] };
        reads.push(read);
        const builder = {
          eq: (column: string, value: string) => {
            read.filters.push(`${column}=eq.${value}`);
            return builder;
          },
          in: (column: string, values: string[]) => {
            read.filters.push(`${column}=in.${values.join("|")}`);
            return builder;
          },
          limit: () => builder,
          then: (resolve: (value: unknown) => void) =>
            resolve({ data: rows, error: null }),
        };
        return builder;
      },
    }),
  });
  return reads;
}

describe("student dashboard course reads", () => {
  it("reads the student's own courses by id with the outline, and no status filter (RLS lets an enrolled student read an unpublished course)", async () => {
    const reads = recordingClient();

    const courses = await fetchCoursesByIds(["course-abc123"]);

    expect(reads).toHaveLength(1);
    expect(reads[0].columns).not.toContain("*");
    expect(reads[0].columns).toContain("modules");
    expect(reads[0].filters).toEqual(["id=in.course-abc123"]);
    expect(courses).toMatchObject([{ id: "course-abc123", ownerId: "teacher-1" }]);
  });

  it("offers only published courses, slim, and lists a course found by both reads once", async () => {
    const reads = recordingClient();

    const courses = await fetchPublishedCoursesForRows(["course-abc123"], ["teacher-1"]);

    expect(reads.map((read) => read.filters)).toEqual([
      ["status=eq.published", "id=in.course-abc123"],
      ["status=eq.published", "owner_id=in.teacher-1"],
    ]);
    expect(reads.every((read) => !read.columns.includes("modules"))).toBe(true);
    expect(courses).toHaveLength(1);
  });

  it("never offers an internal smoke-test course under 'More from <instructor>'", async () => {
    recordingClient([courseRow, { ...courseRow, id: "smoke-checkout-1" }]);

    const courses = await fetchPublishedCoursesForRows([], ["teacher-1"]);

    expect(courses.map((course) => course.id)).toEqual(["course-abc123"]);
  });
});
