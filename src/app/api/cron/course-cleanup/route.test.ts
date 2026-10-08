import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signBunnyAssetPath } from "@/lib/bunny/server";

const mocks = vi.hoisted(() => ({ getAdmin: vi.fn(), fetch: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));

// O apagador de verdade roda: so o banco (um falso em memoria) e a rede (fetch)
// sao trocados, entao estes casos provam o que chegou ao Storage, a Bunny e ao
// alerta, nao o que um mock disse que mandou. O relogio e falso: o tempo so
// anda quando um caso manda.
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
  title: string;
  bunny_assets: unknown;
  attempts: number;
  stalled_runs: number;
  requested_at: string;
  status: string;
  last_error?: string | null;
  last_progress_at?: string | null;
  finished_at?: string | null;
  result?: unknown;
};
type StoredObject = { bucket: string; name: string };

let queue: Row[];
let storage: StoredObject[];
let foreignListing: { object_bucket: string; object_name: string; in_use: boolean }[];
let referencedFiles: string[];
let videosStillNeeded: string[];
let listError: string | null;
let removeDoesNothing: boolean;
let bunnyStatus: number;
let onList: () => void;
let onBunnyDelete: (videoId: string) => void;
const removed: { bucket: string; names: string[] }[] = [];
const rpcSignals: unknown[] = [];
// max-rows do PostgREST: vale tambem para RPC, entao a lista vem cortada.
const MAX_ROWS = 1000;
const timeline: string[] = [];

function job(courseId: string, hours: number, extra: Partial<Row> = {}): Row {
  return {
    course_id: courseId,
    owner_id: "owner-1",
    title: `Product ${courseId}`,
    bunny_assets: [],
    attempts: 0,
    stalled_runs: 0,
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

// Filtros como o PostgREST: todos valem, em qualquer ordem, antes do limit.
function filtered<T extends object>(rows: T[]) {
  const filters: ((row: T) => boolean)[] = [];
  return {
    filters,
    eq: (column: keyof T, value: unknown) => filters.push((row) => row[column] === value),
    keep: () => rows.filter((row) => filters.every((pass) => pass(row))),
  };
}

function fakeAdmin() {
  return {
    from(table: string) {
      expect(table).toBe("course_deletions");
      return {
        select: () => {
          const where = filtered(queue);
          let max = Infinity;
          let ascending = true;
          const builder = {
            eq: (column: keyof Row, value: unknown) => {
              where.eq(column, value);
              return builder;
            },
            lt: (column: keyof Row, value: string | number) => {
              where.filters.push((row) => (row[column] as string | number) < value);
              return builder;
            },
            order: (_column: string, options: { ascending: boolean }) => {
              ascending = options.ascending;
              return builder;
            },
            limit: (count: number) => {
              max = count;
              return builder;
            },
            then: (ok: (value: unknown) => unknown) =>
              ok({
                data: where.keep()
                  .sort((a, b) => a.requested_at.localeCompare(b.requested_at) * (ascending ? 1 : -1))
                  .slice(0, max)
                  .map(({ course_id, bunny_assets, attempts, stalled_runs, requested_at }) => ({
                    course_id, bunny_assets, attempts, stalled_runs, requested_at,
                  })),
                error: null,
              }),
          };
          return builder;
        },
        update: (patch: Partial<Row>) => {
          const where = filtered(queue);
          const builder = {
            eq: (column: keyof Row, value: unknown) => {
              where.eq(column, value);
              return builder;
            },
            then: (ok: (value: unknown) => unknown) => {
              for (const row of where.keep()) Object.assign(row, structuredClone(patch));
              return ok({ error: null });
            },
          };
          return builder;
        },
      };
    },
    rpc(name: string, args: { p_course_id: string; p_video_id?: string }) {
      const answer = () => {
        if (name === "course_cleanup_video_deletable") {
          timeline.push(`check ${args.p_video_id}`);
          return Promise.resolve({ data: !videosStillNeeded.includes(args.p_video_id!), error: null });
        }
        expect(name).toBe("course_storage_objects_for_cleanup");
        onList();
        if (listError) return Promise.resolve({ data: null, error: { message: listError } });
        const prefix = `courses/${args.p_course_id}/`;
        const own = storage
          .filter((object) => object.name.startsWith(prefix))
          .map((object) => ({
            object_bucket: object.bucket,
            object_name: object.name,
            in_use: referencedFiles.includes(object.name),
          }));
        return Promise.resolve({ data: [...own, ...foreignListing].slice(0, MAX_ROWS), error: null });
      };
      // Toda RPC da rotina sai com freio proprio (abortSignal).
      return {
        abortSignal: (signal: unknown) => {
          rpcSignals.push(signal);
          return answer();
        },
      };
    },
    storage: {
      from: (bucket: string) => ({
        remove: (names: string[]) => {
          removed.push({ bucket, names });
          if (!removeDoesNothing) {
            storage = storage.filter((object) => !(object.bucket === bucket && names.includes(object.name)));
          }
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
const run = async () => (await authed()).json();
const bunnyDeletes = () =>
  mocks.fetch.mock.calls
    .filter(([url]) => String(url).startsWith(BUNNY_VIDEOS))
    .map(([url, init]) => [(init as RequestInit).method, String(url).slice(BUNNY_VIDEOS.length)]);
const alerts = () => mocks.fetch.mock.calls.filter(([url]) => url === RELAY);
const row = (id: string) => queue.find((item) => item.course_id === id)!;
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

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
    mocks.fetch.mockImplementation((url: string) => {
      if (url === RELAY) return Promise.resolve(new Response(null, { status: 200 }));
      const videoId = String(url).slice(BUNNY_VIDEOS.length);
      timeline.push(`DELETE ${videoId}`);
      onBunnyDelete(videoId);
      return Promise.resolve(new Response(null, { status: bunnyStatus }));
    });
    mocks.getAdmin.mockImplementation(fakeAdmin);
    queue = [];
    storage = [
      { bucket: "course-content", name: "courses/c1/assets/owner-1/a1/workbook.pdf" },
      { bucket: "public-media", name: "courses/c1/landing/hero.webp" },
      { bucket: "public-media", name: "courses/c1-b/landing/neighbour.webp" },
      { bucket: "course-content", name: "elsewhere/c1/stray.pdf" },
    ];
    foreignListing = [];
    referencedFiles = [];
    videosStillNeeded = [];
    listError = null;
    removeDoesNothing = false;
    bunnyStatus = 200;
    onList = () => undefined;
    onBunnyDelete = () => undefined;
    removed.length = 0;
    rpcSignals.length = 0;
    timeline.length = 0;
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

  describe("dry run (default)", () => {
    it("lists what it would delete, newest first and even inside the first day, and touches nothing", async () => {
      queue = [
        job("c1", 30, { bunny_assets: [video("c1", "vid-1"), { videoId: "vid-old", ownerId: "owner-1" }] }),
        job("c2", 2),
      ];
      referencedFiles = ["courses/c1/landing/hero.webp"];
      const before = JSON.stringify(queue);

      const response = await authed();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        live: false,
        jobs: [
          { courseId: "c2", due: false, objects: 0, keptFiles: 0, videos: 0, skippedNoReceipt: 0, inUseVideos: 0, done: false },
          { courseId: "c1", due: true, objects: 1, keptFiles: 1, videos: 1, skippedNoReceipt: 1, inUseVideos: 0, done: false },
        ],
      });
      expect(removed).toEqual([]);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(queue)).toBe(before);
    });

    // Com 5 produtos antigos na fila, o ensaio mostrava sempre os mesmos 5 e o
    // produto [QA] recem-apagado nunca aparecia no log.
    it("a product deleted just now shows up even when older ones fill the batch", async () => {
      queue = [30, 40, 50, 60, 70, 80].map((hours, index) => job(`old-${index}`, hours));
      queue.push(job("qa-just-deleted", 0.1));

      const body = await run();

      expect(body.jobs).toHaveLength(5);
      expect(body.jobs[0].courseId).toBe("qa-just-deleted");
    });

    it("COURSE_CLEANUP_LIVE other than 1 is still a dry run", async () => {
      vi.stubEnv("COURSE_CLEANUP_LIVE", "true");
      queue = [job("c1", 30)];

      expect((await run()).live).toBe(false);
      expect(removed).toEqual([]);
    });

    it("never reads a failed or cancelled row", async () => {
      queue = [job("c1", 30, { status: "failed", attempts: 5 }), job("c2", 30, { status: "cancelled" })];

      expect((await run()).jobs).toEqual([]);
    });
  });

  describe("live", () => {
    beforeEach(() => vi.stubEnv("COURSE_CLEANUP_LIVE", "1"));

    it("only touches pending deletions older than a day, oldest first", async () => {
      queue = [job("c2", 25), job("c1", 30), job("c3", 23), job("c4", 40, { status: "cancelled" })];

      const body = await run();

      expect(body.jobs.map((item: { courseId: string }) => item.courseId)).toEqual(["c1", "c2"]);
      expect(row("c1").status).toBe("done");
      expect(row("c3").status).toBe("pending");
      expect(row("c4").status).toBe("cancelled");
    });

    it("removes only courses/<id>/ in the two buckets, even when the listing brings a stranger", async () => {
      queue = [job("c1", 30)];
      foreignListing = [
        { object_bucket: "public-media", object_name: "courses/c1-b/landing/neighbour.webp", in_use: false },
        { object_bucket: "course-content", object_name: "elsewhere/c1/stray.pdf", in_use: false },
        { object_bucket: "avatars", object_name: "courses/c1/not-a-course-bucket.png", in_use: false },
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

    // Arquivo "emprestado": a pagina de venda de outro produto vivo usa a
    // imagem que mora na pasta do produto apagado.
    it("keeps a file another live row still uses, and says how many it kept", async () => {
      queue = [job("c1", 30)];
      referencedFiles = ["courses/c1/landing/hero.webp"];

      const body = await run();

      expect(removed).toEqual([{ bucket: "course-content", names: ["courses/c1/assets/owner-1/a1/workbook.pdf"] }]);
      expect(storage.map((object) => object.name)).toContain("courses/c1/landing/hero.webp");
      expect(body.jobs[0]).toMatchObject({ objects: 1, keptFiles: 1, done: true });
      expect(row("c1").result).toMatchObject({ keptFiles: 1 });
      expect(vi.mocked(console.info)).toHaveBeenCalledWith("Course cleanup kept referenced files", "c1", 1);
    });

    it("deletes a proven video, and a video Bunny no longer has (404) still counts as done", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-1")] }), job("c2", 29, { bunny_assets: [video("c2", "vid-2")] })];
      bunnyStatus = 404;

      await authed();

      expect(bunnyDeletes()).toEqual([["DELETE", "vid-1"], ["DELETE", "vid-2"]]);
      const [, init] = mocks.fetch.mock.calls[0];
      expect((init as RequestInit).headers).toMatchObject({ AccessKey: BUNNY_KEY });
      expect(row("c1")).toMatchObject({ status: "done", bunny_assets: [] });
      expect(row("c2").status).toBe("done");
    });

    it("skips a video whose receipt does not prove this course and this owner, and lists it on the done row", async () => {
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

      const body = await run();

      expect(bunnyDeletes()).toEqual([["DELETE", "vid-good"]]);
      expect(body.jobs[0]).toMatchObject({ videos: 1, skippedNoReceipt: 5, done: true });
      expect(row("c1").status).toBe("done");
      expect(row("c1").result).toEqual({
        keptFiles: 0,
        skippedNoReceipt: ["vid-forged", "vid-other-course", "vid-other-owner", "vid-no-receipt", "unknown"],
        inUseVideos: [],
      });
      expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
        "Course cleanup skipped videos without a valid receipt", "c1", 5);
    });

    it("a done row keeps ids and counts, not the product name", async () => {
      queue = [job("c1", 30)];

      await authed();

      expect(row("c1")).toMatchObject({ status: "done", title: "", owner_id: "owner-1", course_id: "c1" });
    });

    it("never deletes a video the database says is still needed", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-shared"), video("c1", "vid-free")] })];
      videosStillNeeded = ["vid-shared"];

      const body = await run();

      expect(bunnyDeletes()).toEqual([["DELETE", "vid-free"]]);
      expect(body.jobs[0]).toMatchObject({ videos: 1, inUseVideos: 1 });
      expect(row("c1").result).toMatchObject({ inUseVideos: ["vid-shared"] });
    });

    // O id pode voltar (ou outra aula passar a usar o video) entre um DELETE e
    // outro: a pergunta ao banco vem logo antes de cada um, nao uma vez so.
    it("asks the database right before each Bunny delete", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-a"), video("c1", "vid-b")] })];
      onBunnyDelete = (videoId) => {
        if (videoId === "vid-a") videosStillNeeded.push("vid-b");
      };

      const body = await run();

      expect(timeline).toEqual(["check vid-a", "DELETE vid-a", "check vid-b"]);
      expect(body.jobs[0]).toMatchObject({ videos: 1, inUseVideos: 1, done: true });
    });

    it("is idempotent: a second run finds nothing left to do", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-1")] })];

      await authed();
      removed.length = 0;
      mocks.fetch.mockClear();
      const body = await run();

      expect(body.jobs).toEqual([]);
      expect(removed).toEqual([]);
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("a failure is counted and retried next hour, still pending, with no alert before the 5th", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-1")] })];
      bunnyStatus = 500;

      const response = await authed();

      expect(response.status).toBe(200);
      expect(row("c1")).toMatchObject({
        status: "pending",
        attempts: 1,
        last_error: "Bunny delete video failed: 500",
      });
      expect(alerts()).toEqual([]);
    });

    it("an unreadable file listing counts as a failure", async () => {
      queue = [job("c1", 30)];
      listError = "Course id is in use again.";

      await authed();

      expect(row("c1")).toMatchObject({ status: "pending", attempts: 1, last_error: "list files: Course id is in use again." });
      expect(removed).toEqual([]);
    });

    it("a file that shows up during removal is never a silent done: the next run picks it up", async () => {
      queue = [job("c1", 30)];
      let calls = 0;
      onList = () => {
        calls += 1;
        // A segunda listagem (a conferencia) acha um arquivo novo.
        if (calls === 2) storage.push({ bucket: "public-media", name: "courses/c1/landing/late.webp" });
      };

      const first = await run();
      expect(first.jobs[0].done).toBe(false);
      expect(row("c1")).toMatchObject({ status: "pending", attempts: 0, last_progress_at: new Date(NOW).toISOString() });

      await authed();
      expect(row("c1").status).toBe("done");
      expect(storage.map((object) => object.name)).not.toContain("courses/c1/landing/late.webp");
    });

    it("files that do not go away count as a failure", async () => {
      queue = [job("c1", 30)];
      removeDoesNothing = true;

      await authed();

      expect(row("c1")).toMatchObject({ status: "pending", attempts: 1 });
      expect(row("c1").last_error).toContain("still in storage");
    });

    // Revisao focada do #507 (A3): a lista do banco para em ~1000 linhas. A
    // conferencia so conta como falha o arquivo mandado apagar que ficou.
    it("a folder with more than 2000 files goes out over several runs, with no failure counted", async () => {
      queue = [job("c1", 30)];
      for (let index = 0; index < 2_500; index += 1) {
        storage.push({ bucket: "course-content", name: `courses/c1/assets/bulk/${index}.pdf` });
      }
      const left = () => storage.filter((object) => object.name.startsWith("courses/c1/")).length;
      expect(left()).toBe(2_502);

      const first = await run();
      expect(first.jobs[0]).toMatchObject({ courseId: "c1", done: false });
      expect(row("c1")).toMatchObject({ status: "pending", attempts: 0, stalled_runs: 0 });
      expect(left()).toBe(1_502);

      await authed();
      expect(row("c1")).toMatchObject({ status: "pending", attempts: 0 });
      expect(left()).toBe(502);

      await authed();
      expect(row("c1")).toMatchObject({ status: "done", attempts: 0 });
      expect(left()).toBe(0);
      expect(removed.every((batch) => batch.names.length <= 100)).toBe(true);
      expect(storage.map((object) => object.name)).toContain("courses/c1-b/landing/neighbour.webp");
    });

    it("every database call of the cleanup carries its own timeout", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-1")] })];

      await authed();

      // 2 listagens (antes e depois do remove) + 1 conferencia do video.
      expect(rpcSignals).toHaveLength(3);
      expect(rpcSignals.every((signal) => signal instanceof AbortSignal && !signal.aborted)).toBe(true);
    });

    it("the 5th failure marks the row failed, alerts the team once, and then the row is left alone", async () => {
      queue = [job("c1", 30, { attempts: 4, bunny_assets: [video("c1", "vid-1")] })];
      bunnyStatus = 500;

      const response = await authed();

      expect(response.status).toBe(200);
      expect(row("c1")).toMatchObject({ status: "failed", attempts: 5 });
      expect(alerts()).toHaveLength(1);
      const sent = JSON.parse(alerts()[0][1].body as string);
      expect(sent).toMatchObject({ event: "course_cleanup_failed", severity: "warn", context: { courseId: "c1", attempts: 5 } });

      mocks.fetch.mockClear();
      const again = await run();
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

    it("a cancel by the team in the middle of a run is never undone", async () => {
      queue = [job("c1", 30, { bunny_assets: [video("c1", "vid-1")] })];
      onBunnyDelete = () => {
        row("c1").status = "cancelled";
      };

      await authed();

      expect(row("c1").status).toBe("cancelled");
      expect(row("c1").bunny_assets).toHaveLength(1);
    });

    describe("time budget (about 40 s per run)", () => {
      it("stops in the middle of a product, saves what went, burns no attempt, and the next run finishes", async () => {
        queue = [job("c1", 30, {
          bunny_assets: ["v1", "v2", "v3", "v4"].map((id) => video("c1", id)),
        })];
        onBunnyDelete = () => advance(15_000);

        const first = await run();

        expect(bunnyDeletes().map(([, id]) => id)).toEqual(["v1", "v2", "v3"]);
        expect(first.jobs[0]).toMatchObject({ courseId: "c1", done: false });
        expect(row("c1")).toMatchObject({ status: "pending", attempts: 0, stalled_runs: 0 });
        expect(row("c1").last_progress_at).toBe(new Date(NOW + 45_000).toISOString());
        expect((row("c1").bunny_assets as { videoId: string }[]).map((item) => item.videoId)).toEqual(["v4"]);

        mocks.fetch.mockClear();
        vi.setSystemTime(NOW + 3_600_000);
        await authed();

        expect(bunnyDeletes().map(([, id]) => id)).toEqual(["v4"]);
        expect(row("c1").status).toBe("done");
      });

      it("does not start the next product after the budget", async () => {
        queue = [job("c1", 30, { bunny_assets: [video("c1", "v1")] }), job("c2", 29)];
        onBunnyDelete = () => advance(41_000);

        const body = await run();

        expect(body.jobs.map((item: { courseId: string }) => item.courseId)).toEqual(["c1"]);
        expect(row("c1").status).toBe("done");
        expect(row("c2").status).toBe("pending");
      });

      it("three runs in a row with no progress count as one attempt", async () => {
        queue = [job("c1", 30, { bunny_assets: [video("c1", "v1")] })];
        storage = [];
        // A listagem demora: o tempo acaba antes do primeiro video.
        onList = () => advance(41_000);

        await authed();
        expect(row("c1")).toMatchObject({ status: "pending", attempts: 0, stalled_runs: 1 });
        await authed();
        expect(row("c1")).toMatchObject({ attempts: 0, stalled_runs: 2 });
        await authed();
        expect(row("c1")).toMatchObject({ status: "pending", attempts: 1, stalled_runs: 0 });
        expect(row("c1").last_error).toBe("no progress in 3 runs");
        expect(bunnyDeletes()).toEqual([]);
        expect(alerts()).toEqual([]);
      });

      it("a row stuck for good ends failed with one alert", async () => {
        queue = [job("c1", 30, { attempts: 4, stalled_runs: 2, bunny_assets: [video("c1", "v1")] })];
        storage = [];
        onList = () => advance(41_000);

        await authed();

        expect(row("c1")).toMatchObject({ status: "failed", attempts: 5 });
        expect(alerts()).toHaveLength(1);
      });
    });

    it("logs counts, never the Bunny key, the cron secret, a file name or the product name", async () => {
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
      expect(logged).not.toContain("Product c1");
      expect(logged).not.toContain(signBunnyAssetPath("c1", "owner-1", "vid-1"));
    });
  });
});
