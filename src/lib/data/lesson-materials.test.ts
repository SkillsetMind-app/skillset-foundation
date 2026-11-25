import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseAsset } from "@/domain/course-asset";
import {
  fetchCourseAssets,
  getProtectedCourseAssetObjectUrl,
  renameCourseAsset,
  saveCourseAssetOrder,
  uploadCourseAsset,
} from "@/lib/data/course-assets";

/**
 * Lesson materials on the Supabase client: the download link carries the file
 * name, the list comes out in the teacher's order, renaming and reordering write
 * only what is needed, and .xmind/.epub/.mm go up with the right type.
 */
const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
  upload: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  rows: [] as Record<string, unknown>[],
  bucket: "",
  // When filled in, the storage is the real supabase-js one (only fetch is fake).
  realStorage: null as SupabaseClient["storage"] | null,
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    storage: mocks.realStorage ?? {
      from: (bucket: string) => {
        mocks.bucket = bucket;
        return {
          createSignedUrl: mocks.sign,
          upload: mocks.upload,
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
          remove: vi.fn(async () => ({ error: null })),
        };
      },
    },
    from: () => ({
      insert: mocks.insert,
      update: (patch: unknown) => {
        mocks.update(patch);
        // .update().eq().select("id"): the response says how many rows changed.
        return { eq: (column: string, value: string) => ({ select: () => mocks.eq(column, value) }) };
      },
      select: () => ({ eq: async () => ({ data: mocks.rows, error: null }) }),
    }),
  }),
}));

const material = (overrides: Partial<CourseAsset> = {}): CourseAsset => ({
  id: "asset-1", courseId: "course-1", ownerId: "teacher-1", kind: "lesson_material",
  fileName: "Handout final v3.pdf", contentType: "application/pdf", size: 1024,
  storagePath: "courses/course-1/assets/teacher-1/asset-1/handout-final-v3.pdf",
  isPreview: false, lessonId: "lesson-1", ...overrides,
});

function row(id: string, fileName: string, title: string | null, position: number | null) {
  return {
    id, course_id: "course-1", owner_id: "teacher-1", kind: "lesson_material", file_name: fileName,
    content_type: "application/pdf", size: 1, storage_path: `p/${id}`, download_url: null,
    bunny_video_id: null, is_preview: false, lesson_id: "lesson-1", module_id: null,
    title, position, created_at: null, updated_at: null,
  };
}

beforeEach(() => {
  mocks.realStorage = null;
  for (const fn of [mocks.sign, mocks.upload, mocks.insert, mocks.update, mocks.eq]) fn.mockReset();
  mocks.sign.mockResolvedValue({ data: { signedUrl: "https://storage.test/signed" }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.eq.mockResolvedValue({ data: [{ id: "changed" }], error: null });
});

describe("signed link", () => {
  it("the download link carries the original file name, with the same 1 hour", async () => {
    const url = await getProtectedCourseAssetObjectUrl(material(), { download: true });

    expect(mocks.bucket).toBe("course-content");
    // The name does not go through the library option (it encodes twice); it goes
    // at the end of the link, encoded only once.
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(material().storagePath, 3600);
    expect(url).toBe("https://storage.test/signed?download=Handout%20final%20v3.pdf");
  });

  it("the open link stays without the download option", async () => {
    await getProtectedCourseAssetObjectUrl(material());

    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(material().storagePath, 3600);
  });

  it("storage refusal (no enrollment or closed lesson) becomes an error, not a link", async () => {
    mocks.sign.mockResolvedValue({ data: null, error: new Error("Object not found") });

    await expect(getProtectedCourseAssetObjectUrl(material(), { download: true })).rejects.toThrow("Object not found");
  });
});

/**
 * The real storage-js builds the link (only the server response is fake).
 * It encodes the name twice (URLSearchParams and then encodeURI) and the
 * storage server decodes once: "Résumé.pdf" used to arrive as
 * "R%C3%A9sum%C3%A9.pdf". Here the link is read the way the server reads it
 * (one decoding, like the browser URL) and the name has to arrive identical.
 */
describe("downloaded file name, with the real storage-js", () => {
  const signFetch = vi.fn(async (input: RequestInfo | URL) => {
    const signedPath = String(input).split("/object/sign/")[1];
    return new Response(JSON.stringify({ signedURL: `/object/sign/${signedPath}?token=t0k3n` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const realStorage = createClient("https://project.test", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: signFetch },
  }).storage;

  it.each(["Handout (1).pdf", "Résumé.pdf","a,b&c#d+e%f.pdf"])("%s arrives the same at the server", async (fileName) => {
    mocks.realStorage = realStorage;

    const url = await getProtectedCourseAssetObjectUrl(material({ fileName }), { download: true });

    expect(String(signFetch.mock.lastCall?.[0])).toContain("/storage/v1/object/sign/course-content/courses/course-1/");
    const query = new URL(url).searchParams;
    expect(query.get("download")).toBe(fileName);
    expect(query.get("token")).toBe("t0k3n");
  });

  it("the open link gets no name at all", async () => {
    mocks.realStorage = realStorage;

    const url = await getProtectedCourseAssetObjectUrl(material({ fileName: "Résumé.pdf" }));

    expect(new URL(url).searchParams.has("download")).toBe(false);
  });
});

describe("order and name", () => {
  it("reads by position, then by the name shown; a file without a position goes to the end", async () => {
    mocks.rows = [
      row("new-b", "b.pdf", null, null),
      row("second", "zz.pdf", "Workbook", 1),
      row("new-a", "a.pdf", null, null),
      row("first", "yy.pdf", "Slides", 0),
    ];

    const assets = await fetchCourseAssets("course-1");

    expect(assets.map((asset) => asset.id)).toEqual(["first", "second", "new-a", "new-b"]);
    expect(assets[0]).toMatchObject({ title: "Slides", position: 0 });
  });

  it("also reads before the migration (without the new columns)", async () => {
    const old: Record<string, unknown> = row("old", "notes.pdf", null, null);
    delete old.title;
    delete old.position;
    mocks.rows = [old];

    const [asset] = await fetchCourseAssets("course-1");

    expect(asset).toMatchObject({ title: null, position: null, fileName: "notes.pdf" });
  });

  it("renaming trims the text; empty goes back to the file name", async () => {
    await renameCourseAsset("asset-1", "  Study guide  ");
    await renameCourseAsset("asset-1", "   ");

    expect(mocks.update.mock.calls).toEqual([[{ title: "Study guide" }], [{ title: null }]]);
    expect(mocks.eq).toHaveBeenCalledWith("id", "asset-1");
  });

  it("reordering writes only the rows whose position changed", async () => {
    await saveCourseAssetOrder([
      { id: "b", position: 1 },
      { id: "a", position: 0 },
      { id: "c", position: 2 },
    ]);

    expect(mocks.update.mock.calls).toEqual([[{ position: 0 }], [{ position: 1 }]]);
    expect(mocks.eq.mock.calls).toEqual([["id", "b"], ["id", "a"]]);
  });

  it("a failure writing the order reaches the caller", async () => {
    mocks.eq.mockResolvedValueOnce({ error: new Error("denied") });

    await expect(saveCourseAssetOrder([{ id: "b", position: 1 }, { id: "a", position: 0 }])).rejects.toThrow("denied");
  });

  // RLS filters the row without an error (session without a second factor, course
  // of another owner): no row changed, and that must not become "saved".
  it("a rename that changed no row is an error, not 'saved'", async () => {
    mocks.eq.mockResolvedValueOnce({ data: [], error: null });

    await expect(renameCourseAsset("asset-1", "Guide")).rejects.toThrow("course-asset-not-updated");
  });

  it("reordering with a row that did not change is an error, not 'saved'", async () => {
    mocks.eq.mockResolvedValueOnce({ data: [{ id: "b" }], error: null }).mockResolvedValueOnce({ data: [], error: null });

    await expect(saveCourseAssetOrder([{ id: "b", position: 1 }, { id: "a", position: 0 }]))
      .rejects.toThrow("course-asset-not-updated");
  });
});

describe("file type on upload", () => {
  it.each([
    ["map.xmind", "", "application/vnd.xmind.workbook"],
    ["map.mm", "text/x-objective-c++", "application/x-freemind"],
    ["book.epub", "application/epub+zip", "application/epub+zip"],
    ["notes.md", "", "application/octet-stream"],
    // Active content: opened inline, the script would run on the storage domain.
    ["logo.svg", "image/svg+xml", "application/octet-stream"],
    ["page.html", "text/html", "application/octet-stream"],
    ["feed.xml", "text/xml", "application/octet-stream"],
  ])("%s (browser said %j) goes up as %s", async (name, browserType, expected) => {
    const file = new File(["content"], name, { type: browserType });

    await uploadCourseAsset({
      courseId: "course-1", ownerId: "teacher-1", kind: "lesson_material", file,
      isPreview: false, lessonId: "lesson-1",
    });

    expect(mocks.upload).toHaveBeenCalledWith(expect.any(String), expect.any(File), { contentType: expected, upsert: false });
    // storage-js ignores `contentType` when the body is a File and writes the
    // File's own type. The safe type has to be on the file that goes up.
    const body = mocks.upload.mock.lastCall?.[1] as File;
    expect(body.type).toBe(expected);
    expect(body.name).toBe(name);
    expect(await body.text()).toBe("content");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ content_type: expected, file_name: name }));
  });
});

describe("old file with active content", () => {
  it.each([
    ["logo.svg", "image/svg+xml"],
    ["page.html", "text/html"],
    ["feed.xml", "text/xml"],
  ])("the open link for %s (%s) comes as an attachment, with the same signed request", async (fileName, contentType) => {
    const url = await getProtectedCourseAssetObjectUrl(material({ fileName, contentType }));

    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(material().storagePath, 3600);
    expect(url).toBe(`https://storage.test/signed?download=${fileName}`);
  });

  it("PDF, regular image and video keep opening on screen", async () => {
    for (const contentType of ["application/pdf", "image/png", "video/mp4"]) {
      expect(await getProtectedCourseAssetObjectUrl(material({ contentType }))).toBe("https://storage.test/signed");
    }
  });

  it("storage refusal (no enrollment or closed lesson) still becomes an error", async () => {
    mocks.sign.mockResolvedValue({ data: null, error: new Error("Object not found") });

    await expect(getProtectedCourseAssetObjectUrl(material({ contentType: "image/svg+xml" })))
      .rejects.toThrow("Object not found");
  });
});
