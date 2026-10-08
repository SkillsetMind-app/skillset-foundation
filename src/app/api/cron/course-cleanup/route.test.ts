import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signBunnyAssetPath } from "@/lib/bunny/server";

const mocks = vi.hoisted(() => ({ getAdmin: vi.fn(), fetch: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));

// O apagador de verdade roda: so o banco (um falso em memoria) e a rede (fetch)
// sao trocados, entao estes casos provam o que chegou ao Storage, a Bunny e ao
// alerta, nao o que um mock disse que mandou.
import { GET } from "@/app/api/cron/course-cleanup/route";

const CRON_TOKEN = "test-cron-token";
const BUNNY_KEY = "test-bunny-key-never-logged";
const LIBRARY = "4242";
const RELAY = "https://relay.example.test/hook";
const NOW = Date.parse("2026-10-10T08:07:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const BUNNY_VIDEOS = `https://video.bunnycdn.com/library/${LIBRARY}/videos/`;

type Row = {
  course_id: string;
  owner_id: string;
  bunny_assets: unknown;
  attempts: number;
  requested_at: string;
  status: string;
  last_error?: string | null;
  finished_at?: string | null;
};
type StoredObject = { bucket: string; name: string };

let queue: Row[];
let storage: StoredObject[];
let foreignListing: { object_bucket: string; object_name: string }[];
let assetsStillUsing: string[];
let listError: string | null;
let bunnyStatus: number;
let onList: () => void;
const removed: { bucket: string; names: string[] }[] = [];

function job(courseId: string, hours: number, extra: Partial<Row> = {}): Row {
  return {
    course_id: courseId,
    owner_id: "owner-1",
    bunny_assets: [],
    attempts: 0,
    requested_at: hoursAgo(hours),
    status: "pending",
    ...extra,
  };
}
const video = (courseId: string, videoId: string, ownerId = "owner-1") => ({
  videoId,
  ownerId,
  receipt: signBunnyAssetPath(courseId, ownerId, videoId),
});

function fakeAdmin() {
  return {
    from(table: string) {
      if (table === "course_assets") {
        return {
          select: () => ({
            in: (_column: string, ids: string[]) =>
              Promise.resolve({
                data: assetsStillUsing.filter((id) => ids.includes(id)).map((id) => ({ bunny_video_id: id })),
                error: null,
              }),
          }),
        };
      }
      expect(table).toBe("course_deletions");
      return {
        // Filtros como o PostgREST: todos valem antes do limit, em qualquer ordem.
        select: () => {
          const filters: ((row: Row) => boolean)[] = [];
          let max = Infinity;
          const builder = {
            in: (column: keyof Row, values: unknown[]) => {
              filters.push((row) => values.includes(row[column]));
              return builder;
            },
            lt: (column: keyof Row, value: string | number) => {
              filters.push((row) => (row[column] as string | number) < value);
              return builder;
            },
            order: () => builder,
            limit: (count: number) => {
              max = count;
              return builder;
            },
            then: (ok: (value: unknown) => unknown) =>
              ok({
                data: queue
                  .filter((row) => filters.every((keep) => keep(row)))
                  .sort((a, b) => a.requested_at.localeCompare(b.requested_at))
                  .slice(0, max)
                  .map(({ course_id, bunny_assets, attempts, requested_at }) => ({
                    course_id, bunny_assets, attempts, requested_at,
                  })),
                error: null,
              }),
          };
          return builder;
        },
        update: (patch: Partial<Row>) => ({
          eq: (_column: string, id: string) => {
            Object.assign(queue.find((row) => row.course_id === id)!, patch);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
    rpc(name: string, args: { p_course_id: string }) {
      expect(name).toBe("course_storage_objects_for_cleanup");
      onList();
      if (listError) return Promise.resolve({ data: null, error: { message: listError } });
      const prefix = `courses/${args.p_course_id}/`;
      const own = storage
        .filter((object) => object.name.startsWith(prefix))
        .map((object) => ({ object_bucket: object.bucket, object_name: object.name }));
      return Promise.resolve({ data: [...own, ...foreignListing], error: null });
    },
    storage: {
      from: (bucket: string) => ({
        remove: (names: string[]) => {
          removed.push({ bucket, names });
          storage = storage.filter((object) => !(object.bucket === bucket && names.includes(object.name)));
          return Promise.resolve({ data: [], error: null });
        },
      }),
    },
  };
}

function call(authorization?: string) {
  return GET(new Request("http://localhost/api/cron/course-cleanup", {
    headers: authorization ? { authorization } : {},
  }));
}
const authed = () => call(`Bearer ${CRON_TOKEN}`);
const bunnyDeletes = () =>
  mocks.fetch.mock.calls
    .filter(([url]) => String(url).startsWith(BUNNY_VIDEOS))
    .map(([url, init]) => [(init as RequestInit).method, String(url).slice(BUNNY_VIDEOS.length)]);
const alerts = () => mocks.fetch.mock.calls.filter(([url]) => url === RELAY);
const row = (id: string) => queue.find((item) => item.course_id === id)!;

describe("course cleanup cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("CRON_SECRET", CRON_TOKEN);
    vi.stubEnv("BUNNY_STREAM_API_KEY", BUNNY_KEY);
    vi.stubEnv("NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID", LIBRARY);
    vi.stubEnv("OPS_ALERT_WEBHOOK_URL", RELAY);
    vi.stubEnv("OPS_ALERT_WEBHOOK_SECRET", "");
    vi.stubEnv("COURSE_CLEANUP_LIVE", "");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockImplementation((url: string) =>
      Promise.resolve(new Response(null, { status: url === RELAY ? 200 : bunnyStatus })));
    mocks.getAdmin.mockImplementation(fakeAdmin);
    queue = [];
    storage = [
      { bucket: "course-content", name: "courses/c1/assets/owner-1/a1/workbook.pdf" },
      { bucket: "public-media", name: "courses/c1/landing/hero.webp" },
      { bucket: "public-media", name: "courses/c1-b/landing/neighbour.webp" },
      { bucket: "course-content", name: "elsewhere/c1/stray.pdf" },
    ];
    foreignListing = [];
    assetsStillUsing = [];
    listError = null;
    bunnyStatus = 200;
    onList = () => undefined;
    removed.length = 0;
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["missing header", undefined],
    ["wrong value", `Bearer not-${CRON_TOKEN}`],
  ])("refuses a %s without reading the queue", async (_label, header) => {
    const response = await call(header);

    expect(response.status).toBe(401);
    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("dry run by default: lists what it would delete, even inside the 24 h, and touches nothing", async () => {
    queue = [
      job("c1", 30, { bunny_assets: [video("c1", "vid-1")] }),
      job("c2", 2),
    ];
    const before = JSON.stringify(queue);

    const response = await authed();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      live: false,
      jobs: [
        { courseId: "c1", due: true, objects: 2, videos: 1, skippedVideos: 0, inUseVideos: 0, done: false },
        { courseId: "c2", due: false, objects: 0, videos: 0, skippedVideos: 0, inUseVideos: 0, done: false },
      ],
    });
    expect(removed).toEqual([]);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(queue)).toBe(before);
  });

  it("COURSE_CLEANUP_LIVE other than 1 is still a dry run", async () => {
    vi.stubEnv("COURSE_CLEANUP_LIVE", "true");
    queue = [job("c1", 30)];

    expect((await (await authed()).json()).live).toBe(false);
    expect(removed).toEqual([]);
  });

  describe("live", () => {
    beforeEach(() => vi.stubEnv("COURSE_CLEANUP_LIVE", "1"));

    it("only touches deletions older than 24 h", async () => {
      queue = [job("c1", 30), job("c2", 23)];

      const body = await (await authed()).json();

      expect(body.jobs.map((item: { courseId: string }) => item.courseId)).toEqual(["c1"]);
      expect(row("c1").status).toBe("done");
      expect(row("c2").status).toBe("pending");
    });

    it("removes only courses/<id>/ in the two buckets, even when the listing brings a stranger", async () => {
      queue = [job("c1", 30)];
      foreignListing = [
        { object_bucket: "public-media", object_name: "courses/c1-b/landing/neighbour.webp" },
        { object_bucket: "course-content", object_name: "elsewhere/c1/stray.pdf" },
        { object_bucket: "avatars", object_name: "courses/c1/not-a-course-bucket.png" },
      ];

      const response = await authed();

      expect(response.status).toBe(200);
      expect(removed).toEqual([
        { bucket: "course-content", names: ["courses/c1/assets/owner-1/a1/workbook.pdf"] },
        { bucket: "public-media", names: ["courses/c1/landing/hero.webp"] },
      ]);
      expect(storage.map((object) => object.name)).toEqual([
        "courses/c1-b/landing/neighbour.webp",
        "elsewhere/c1/stray.pdf",
      ]);
      expect(row("c1")).toMatchObject({ status: "done", last_error: null });
      expect(row("c1").finished_at).toBe(new Date(NOW).toISOString());
    });

    it("deletes a proven video, and a video Bunny no longer has (404) still counts as done", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-1")] }), job("c2", 29, { bunny_assets: [video("c2", "vid-2")] })];
      bunnyStatus = 404;

      await authed();

      expect(bunnyDeletes()).toEqual([["DELETE", "vid-1"], ["DELETE", "vid-2"]]);
      const [, init] = mocks.fetch.mock.calls[0];
      expect((init as RequestInit).headers).toMatchObject({ AccessKey: BUNNY_KEY });
      expect(row("c1").status).toBe("done");
      expect(row("c2").status).toBe("done");
    });

    it("skips a video whose receipt does not prove this course and this owner", async () => {
      queue = [job("c1", 30, {
        bunny_assets: [
          { ...video("c1", "vid-forged"), receipt: "bunny/vid-forged/0000" },
          video("c9", "vid-other-course"),
          { ...video("c1", "vid-other-owner", "owner-2"), ownerId: "owner-1" },
          { videoId: "vid-no-receipt", ownerId: "owner-1" },
          "not-an-object",
          video("c1", "vid-good"),
        ],
      })];

      const body = await (await authed()).json();

      expect(bunnyDeletes()).toEqual([["DELETE", "vid-good"]]);
      expect(body.jobs[0]).toMatchObject({ videos: 1, skippedVideos: 5 });
      expect(row("c1").status).toBe("done");
    });

    it("never deletes a video that a live course_assets row still uses", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-shared"), video("c1", "vid-free")] })];
      assetsStillUsing = ["vid-shared"];

      const body = await (await authed()).json();

      expect(bunnyDeletes()).toEqual([["DELETE", "vid-free"]]);
      expect(body.jobs[0]).toMatchObject({ videos: 1, inUseVideos: 1 });
    });

    it("is idempotent: a second run finds nothing left to do", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-1")] })];

      await authed();
      removed.length = 0;
      mocks.fetch.mockClear();
      const body = await (await authed()).json();

      expect(body.jobs).toEqual([]);
      expect(removed).toEqual([]);
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("a failure is counted and retried next hour, with no alert before the 5th", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-1")] })];
      bunnyStatus = 500;

      const response = await authed();

      expect(response.status).toBe(200);
      expect(row("c1")).toMatchObject({
        status: "failed",
        attempts: 1,
        last_error: "Bunny delete video failed: 500",
      });
      expect(alerts()).toEqual([]);
    });

    it("an unreadable file listing marks the job failed", async () => {
      queue = [job("c1", 30)];
      listError = "Course id is in use again.";

      await authed();

      expect(row("c1")).toMatchObject({ status: "failed", attempts: 1, last_error: "list files: Course id is in use again." });
      expect(removed).toEqual([]);
    });

    it("files still there after removal is a failure, never a silent done", async () => {
      queue = [job("c1", 30)];
      let calls = 0;
      onList = () => {
        calls += 1;
        // A segunda listagem (a conferencia) acha um arquivo novo.
        if (calls === 2) storage.push({ bucket: "public-media", name: "courses/c1/landing/late.webp" });
      };

      await authed();

      expect(row("c1")).toMatchObject({ status: "failed", attempts: 1 });
      expect(row("c1").last_error).toContain("still in storage");
    });

    it("the 5th failure alerts the team once, and then the job is left alone", async () => {
      queue = [job("c1", 30, { status: "failed", attempts: 4, bunny_assets: [video("c1", "vid-1")] })];
      bunnyStatus = 500;

      const response = await authed();

      expect(response.status).toBe(200);
      expect(row("c1")).toMatchObject({ status: "failed", attempts: 5 });
      expect(alerts()).toHaveLength(1);
      const sent = JSON.parse(alerts()[0][1].body as string);
      expect(sent).toMatchObject({ event: "course_cleanup_failed", severity: "warn", context: { courseId: "c1", attempts: 5 } });

      mocks.fetch.mockClear();
      const again = await (await authed()).json();
      expect(again.jobs).toEqual([]);
      expect(alerts()).toEqual([]);
    });

    it("an alert nobody received turns the run red", async () => {
      queue = [job("c1", 30, { attempts: 4, bunny_assets: [video("c1", "vid-1")] })];
      bunnyStatus = 500;
      mocks.fetch.mockImplementation((url: string) =>
        Promise.resolve(new Response(null, { status: url === RELAY ? 502 : 500 })));

      const response = await authed();

      expect(response.status).toBe(500);
      expect((await response.json()).ok).toBe(false);
    });

    it("stops starting new jobs after the time budget", async () => {
      queue = [job("c1", 30), job("c2", 29)];
      onList = () => vi.setSystemTime(Date.now() + 46_000);

      const body = await (await authed()).json();

      expect(body.jobs.map((item: { courseId: string }) => item.courseId)).toEqual(["c1"]);
      expect(row("c2").status).toBe("pending");
    });

    it("logs counts, never the Bunny key, the cron secret or a file name", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-1"), { videoId: "vid-x", ownerId: "o", receipt: "r" }] })];
      bunnyStatus = 500;

      await authed();

      const logged = JSON.stringify([
        ...vi.mocked(console.info).mock.calls,
        ...vi.mocked(console.warn).mock.calls,
        ...vi.mocked(console.error).mock.calls,
      ]);
      expect(logged).not.toContain(BUNNY_KEY);
      expect(logged).not.toContain(CRON_TOKEN);
      expect(logged).not.toContain("workbook.pdf");
      expect(logged).not.toContain(signBunnyAssetPath("c1", "owner-1", "vid-1"));
    });
  });
});
