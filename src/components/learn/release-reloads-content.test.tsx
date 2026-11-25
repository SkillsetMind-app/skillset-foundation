import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * RLS only delivers the text, link and material of a lesson that has already opened
 * (migration 20260915020000), and nothing in the database changes when a lesson opens. The
 * classroom has to fetch again, but only when some lesson actually opens, without
 * resubscribing the realtime channels and without replacing the object of an attachment that did not
 * change (the uploaded video player would re-sign the URL and restart in the middle).
 *
 * Here the data modules are the real ones, on top of a fake Supabase that
 * applies the "RLS" (serverOpen) and counts every select, every channel subscribe and
 * every URL signing.
 */

type Row = Record<string, unknown>;

function makeEnrollment() {
  return {
    id: "student-1__course-1",
    userId: "student-1",
    courseId: "course-1",
    courseSlug: "demo-course",
    courseTitle: "Demo course",
    courseCategory: "Leadership",
    courseImage: "",
    status: "active",
    source: "payment",
    progressPercent: 0,
    lastLessonId: null as string | null,
    createdAt: "2026-03-01T12:00:00.000Z",
  };
}

const db = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Row[]>,
    // Lessons the database RLS already releases (the server clock).
    serverOpen: new Set<string>(),
    // Tables whose next select comes back with an error.
    failNext: new Set<string>(),
    // With hold, the responses stay parked until the test releases them (reload "in flight").
    hold: false,
    held: [] as Array<() => void>,
    selects: {} as Record<string, number>,
    subscribes: 0,
    signs: 0,
    realtime: new Map<string, () => void>(),
    searchParams: new URLSearchParams(),
    completed: null as null | ((ids: string[]) => void),
    // Enrollment: delivered right away, or held until the test emits.
    holdEnrollment: false,
    emitEnrollment: null as null | ((value: unknown) => void),
    enrollment: null as unknown,
    auth: {
      status: "authenticated",
      user: { uid: "student-1", email: "student@example.test", roles: ["student"] },
    },
  };
  const rowsFor = (table: string) =>
    (state.tables[table] ?? []).filter(
      (row) => row.lesson_id == null || state.serverOpen.has(String(row.lesson_id)),
    );
  // Any .select().eq()... chain ends in an await that returns the rows
  // visible at that moment.
  const from = (table: string) => {
    state.selects[table] = (state.selects[table] ?? 0) + 1;
    const failed = state.failNext.delete(table);
    const builder: unknown = new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === "then"
            ? (resolve: (value: unknown) => void) => {
                // The rows are computed at delivery time, with the "RLS" of that moment.
                const deliver = () =>
                  resolve(
                    failed
                      ? { data: null, error: { message: "falha simulada" } }
                      : { data: rowsFor(table), error: null },
                  );
                if (state.hold) {
                  state.held.push(deliver);
                } else {
                  deliver();
                }
              }
            : () => builder,
      },
    );
    return builder;
  };
  const channel = () => {
    const created = {
      on: (_event: string, filter: { table: string }, callback: () => void) => {
        state.realtime.set(filter.table, callback);
        return created;
      },
      subscribe: () => {
        state.subscribes += 1;
        return created;
      },
    };
    return created;
  };
  const client = {
    from,
    channel,
    removeChannel: () => Promise.resolve("ok"),
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          state.signs += 1;
          return { data: { signedUrl: "https://files.example.test/aula-1.mp4" }, error: null };
        },
      }),
    },
  };
  return { state, client };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => db.client,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => db.state.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => db.state.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: (_uid: string, _slug: string, onNext: (value: unknown) => void) => {
    db.state.emitEnrollment = onNext;
    if (!db.state.holdEnrollment) {
      onNext(db.state.enrollment);
    }
    return () => undefined;
  },
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: (_id: string, onNext: (ids: string[]) => void) => {
    db.state.completed = onNext;
    onNext([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: () => () => undefined,
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// Lesson 1 (uploaded video, no Bunny) open; lesson 2 opens 24h after
// enrollment (time_drip_lesson, interval 1).
const timeDripCourse = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  dripStrategy: "time_drip_lesson",
  dripIntervalDays: 1,
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        { id: "l1", title: "Lesson one", type: "video", videoSource: "upload", duration: "5 min", isPreview: false },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false },
      ],
    },
  ],
} as unknown as Course;

const sequentialCourse = {
  ...timeDripCourse,
  dripStrategy: "sequential_progress",
} as unknown as Course;

function assetRow(id: string, lessonId: string, kind: string, contentType: string) {
  return {
    id,
    course_id: "course-1",
    owner_id: "teacher-1",
    kind,
    file_name: `${id}.bin`,
    content_type: contentType,
    size: 10,
    storage_path: `courses/course-1/assets/teacher-1/${id}/${id}.bin`,
    download_url: null,
    bunny_video_id: null,
    is_preview: false,
    lesson_id: lessonId,
    module_id: null,
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: null,
  };
}

function contentRow(lessonId: string, text: string) {
  return { lesson_id: lessonId, course_id: "course-1", content_text: text, external_url: null };
}

const second = 1000;
const minute = 60 * second;
const day = 24 * 60 * minute;

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let turn = 0; turn < 5; turn += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
  });
}

// Releases the responses parked by hold and lets the classroom settle.
async function releaseHeld() {
  db.state.hold = false;
  await act(async () => {
    for (const deliver of db.state.held.splice(0)) {
      deliver();
    }
  });
  await flush();
}

async function mount(course: Course, lesson = "l1") {
  db.state.searchParams = new URLSearchParams(`lesson=${lesson}`);
  render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);
  await flush();
}

function counts() {
  return {
    assets: db.state.selects.course_assets ?? 0,
    content: db.state.selects.course_lesson_content ?? 0,
    subscribes: db.state.subscribes,
    signs: db.state.signs,
  };
}

describe("the classroom fetches again only when a lesson opens", () => {
  beforeEach(() => {
    // Only the clock and setTimeout: the watermarked player sets up short
    // setIntervals, and advancing 24h with them faked runs tens of thousands of renders.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
    db.state.tables = {
      course_assets: [
        assetRow("video-l1", "l1", "lesson_video", "video/mp4"),
        assetRow("pdf-l2", "l2", "lesson_material", "application/pdf"),
      ],
      course_lesson_content: [contentRow("l1", "Texto da aula um"), contentRow("l2", "Texto da aula dois")],
    };
    db.state.serverOpen = new Set(["l1"]);
    db.state.failNext = new Set();
    db.state.hold = false;
    db.state.held = [];
    db.state.selects = {};
    db.state.subscribes = 0;
    db.state.signs = 0;
    db.state.realtime.clear();
    db.state.completed = null;
    db.state.holdEnrollment = false;
    db.state.emitEnrollment = null;
    db.state.enrollment = makeEnrollment();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returning to the tab with no new lesson released: nothing is fetched and the video is not re-signed", async () => {
    await mount(timeDripCourse);
    expect(db.state.signs).toBe(1);
    const before = counts();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush(10 * second);

    expect(counts()).toEqual(before);
  });

  it("the deadline that releases a lesson triggers a single reload, without resubscribing the channel", async () => {
    await mount(timeDripCourse);
    const before = counts();
    db.state.serverOpen.add("l2");

    // 5s of slack after the deadline.
    await flush(day + 4 * second);
    expect(counts()).toEqual(before);

    await flush(2 * second);
    expect(counts()).toEqual({
      assets: before.assets + 1,
      content: before.content + 1,
      subscribes: before.subscribes,
      // The video for lesson 1 came back the same: the same object, with no new signing.
      signs: before.signs,
    });

    // The lesson arrived: no extra attempt.
    await flush(10 * minute);
    expect(counts().content).toBe(before.content + 1);
  });

  it("device clock running ahead: tries again in 30s and shows the content", async () => {
    await mount(timeDripCourse, "l2");
    const before = counts();

    await flush(day + 6 * second);
    expect(counts().content).toBe(before.content + 1);
    expect(screen.queryByText("Texto da aula dois")).toBeNull();

    db.state.serverOpen.add("l2");
    await flush(30 * second);
    expect(screen.getByText("Texto da aula dois")).toBeTruthy();
    expect(counts().content).toBe(before.content + 2);

    await flush(5 * minute);
    expect(counts().content).toBe(before.content + 2);
  });

  it("near the deadline, with the lesson not in the database, stops after 3 extra attempts", async () => {
    await mount(timeDripCourse, "l2");
    const before = counts();

    await flush(day + 6 * second);
    await flush(10 * minute);

    expect(counts().content).toBe(before.content + 1 + 3);
    expect(counts().subscribes).toBe(before.subscribes);
  });

  it("realtime keeps delivering after a reload", async () => {
    await mount(timeDripCourse, "l2");
    const before = counts();
    db.state.serverOpen.add("l2");
    await flush(day + 6 * second);
    expect(screen.getByText("Texto da aula dois")).toBeTruthy();

    db.state.tables.course_lesson_content = [
      contentRow("l1", "Texto da aula um"),
      contentRow("l2", "Texto revisado da aula dois"),
    ];
    await act(async () => {
      db.state.realtime.get("course_lesson_content")?.();
    });
    await flush();

    expect(screen.getByText("Texto revisado da aula dois")).toBeTruthy();
    expect(counts().subscribes).toBe(before.subscribes);
  });

  it("the set of completed lessons changing reloads once, without resubscribing", async () => {
    await mount(sequentialCourse);
    const before = counts();

    db.state.serverOpen.add("l2");
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush();
    expect(counts()).toEqual({
      assets: before.assets + 1,
      content: before.content + 1,
      subscribes: before.subscribes,
      signs: before.signs,
    });

    // The same set again (another list, same content): nothing.
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush();
    expect(counts().content).toBe(before.content + 1);
  });

  it("completing a lesson brings the enrollment again (new object): without resubscribing the channels or re-signing the video", async () => {
    await mount(sequentialCourse);
    const before = counts();

    // record_lesson_progress writes to enrollments, and the enrollment arrives again
    // through realtime as another object.
    db.state.serverOpen.add("l2");
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await act(async () => {
      db.state.emitEnrollment?.({ ...makeEnrollment(), progressPercent: 50, lastLessonId: "l1" });
    });
    await flush(minute);

    expect(counts()).toEqual({
      assets: before.assets + 1,
      content: before.content + 1,
      subscribes: before.subscribes,
      signs: before.signs,
    });
  });

  it("an enrollment that arrives after mounting: lesson 1 opens right away, with no extra reload", async () => {
    db.state.holdEnrollment = true;
    await mount(timeDripCourse);
    await flush(10 * minute);

    // Checkout flow: the enrollment is created now, after mounting.
    db.state.enrollment = { ...makeEnrollment(), createdAt: new Date(Date.now()).toISOString() };
    await act(async () => {
      db.state.emitEnrollment?.(db.state.enrollment);
    });
    await flush();
    expect(db.state.signs).toBe(1);

    const afterArrival = counts();
    await flush(10 * second);
    expect(counts()).toEqual(afterArrival);
  });

  it("a completion inside the 30s window does not cancel the retry for the missing lesson", async () => {
    await mount(timeDripCourse, "l2");

    // Deadline: the reload comes back without lesson 2 (device clock running ahead).
    await flush(day + 6 * second);
    expect(screen.queryByText("Texto da aula dois")).toBeNull();

    // Another change inside the retry window.
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush(10 * second);

    db.state.serverOpen.add("l2");
    await flush(minute);
    expect(screen.getByText("Texto da aula dois")).toBeTruthy();
  });

  it("an open lesson without protected content (sequential) spends at most one extra attempt", async () => {
    db.state.tables = {
      course_assets: [assetRow("video-l1", "l1", "lesson_video", "video/mp4")],
      course_lesson_content: [contentRow("l1", "Texto da aula um")],
    };
    await mount(sequentialCourse);
    const before = counts();

    db.state.serverOpen.add("l2");
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush(5 * minute);

    expect(counts().content).toBe(before.content + 1 + 1);
  });

  it("a reload that fails keeps the attachments on screen, with no error state", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await mount(timeDripCourse);
    const before = counts();

    db.state.serverOpen.add("l2");
    db.state.failNext.add("course_assets");
    await flush(day + 6 * second);

    expect(document.getElementById("member-lesson-player")).not.toBeNull();
    expect(counts().signs).toBe(before.signs);
  });

  // The player's big notice (h3): locked, loading, or the real empty state.
  // A ready reading lesson has no video box: null.
  function playerNotice() {
    return (
      document
        .getElementById("member-lesson-player")
        ?.querySelector(".member-video-empty h3")?.textContent ?? null
    );
  }

  it("a lesson that opens by deadline shows loading while the reload is in flight", async () => {
    await mount(timeDripCourse, "l2");

    // Deadline + slack; the reload is sent and stays in flight.
    db.state.serverOpen.add("l2");
    db.state.hold = true;
    await flush(day + 6 * second);
    expect(playerNotice()).toBe("Loading lesson content...");

    await releaseHeld();
    expect(screen.getByText("Texto da aula dois")).toBeTruthy();
    expect(playerNotice()).toBeNull();
  });

  it("a lesson that was already open does not flash loading while another lesson opens", async () => {
    const textFirstCourse = {
      ...timeDripCourse,
      modules: [
        {
          ...timeDripCourse.modules[0],
          lessons: [
            { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: false },
            timeDripCourse.modules[0].lessons[1],
          ],
        },
      ],
    } as unknown as Course;
    db.state.tables = {
      course_assets: [assetRow("pdf-l2", "l2", "lesson_material", "application/pdf")],
      course_lesson_content: [contentRow("l1", "Texto da aula um"), contentRow("l2", "Texto da aula dois")],
    };
    await mount(textFirstCourse, "l1");
    expect(playerNotice()).toBeNull();

    // Lesson 2 opens and stays queued (database behind); lesson 1 does not change.
    await flush(day + 6 * second);
    expect(playerNotice()).toBeNull();
    await flush(minute);
    expect(playerNotice()).toBeNull();
  });

  it("a lesson that comes back empty shows the real state right after the first reload", async () => {
    await mount(timeDripCourse, "l2");

    db.state.hold = true;
    await flush(day + 6 * second);
    expect(playerNotice()).toBe("Loading lesson content...");

    // Database still closed: the reload comes back without the lesson. The screen shows the real state
    // right away; the retries continue behind the scenes without holding the "loading".
    await releaseHeld();
    expect(playerNotice()).toBeNull();
    await flush(10 * minute);
    expect(playerNotice()).toBeNull();
  });

  it("in sequential mode, the next lesson without protected content shows the real state right after the first reload", async () => {
    // Lesson 2 without a protected row: quiz, text only in the curriculum, or embed.
    db.state.tables = {
      course_assets: [assetRow("video-l1", "l1", "lesson_video", "video/mp4")],
      course_lesson_content: [contentRow("l1", "Texto da aula um")],
    };
    await mount(sequentialCourse, "l2");

    db.state.serverOpen.add("l2");
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush();

    expect(playerNotice()).toBeNull();
  });

  it("a lesson that opens with its text in the curriculum itself does not show loading", async () => {
    const inlineTextCourse = {
      ...timeDripCourse,
      modules: [
        {
          ...timeDripCourse.modules[0],
          lessons: [
            timeDripCourse.modules[0].lessons[0],
            {
              id: "l2",
              title: "Lesson two",
              type: "text",
              duration: "7 min",
              isPreview: false,
              contentText: "Texto no currículo da aula dois",
            },
          ],
        },
      ],
    } as unknown as Course;
    db.state.tables = {
      course_assets: [assetRow("video-l1", "l1", "lesson_video", "video/mp4")],
      course_lesson_content: [contentRow("l1", "Texto da aula um")],
    };
    await mount(inlineTextCourse, "l2");

    db.state.serverOpen.add("l2");
    db.state.hold = true;
    await flush(day + 6 * second);
    expect(playerNotice()).toBeNull();
    expect(screen.getByText("Texto no currículo da aula dois")).toBeTruthy();

    await releaseHeld();
    expect(playerNotice()).toBeNull();
  });
});
