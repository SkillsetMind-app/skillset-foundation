import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseLandingEditor } from "@/components/teacher/course-landing-editor";
import type { CourseLandingBlock } from "@/domain/course-landing";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { CourseLanding } from "@/lib/data/course-landings";
import { saveCourseLanding } from "@/lib/data/course-landings";

// Fake Supabase at the lowest seam, so the test exercises the real upload and
// cleanup code. Each upload stays pending until the test finishes it.
const sb = vi.hoisted(() => {
  const base = "https://proj.supabase.co/storage/v1";
  const uploads: { path: string; finish: () => void }[] = [];
  const removed: string[] = [];
  const tables: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) =>
          new Promise((resolve) => uploads.push({ path, finish: () => resolve({ error: null }) })),
        getPublicUrl: (path: string) => ({ data: { publicUrl: encodeURI(`${base}/object/public/${bucket}/${path}`) } }),
        remove: async (paths: string[]) => {
          removed.push(...paths);
          return { data: [], error: null };
        },
      }),
    },
    from: (table: string) => {
      tables.push(table);
      return {
        insert: async (row: Record<string, unknown>) => {
          rows.push(row);
          return { error: null };
        },
        select: () => ({ eq: async () => ({ data: rows, error: null }) }),
      };
    },
  };
  return { base, uploads, removed, tables, rows, client };
});

const state = vi.hoisted(() => ({ landing: { template: "classic", blocks: [] } as CourseLanding }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "teacher" } }) }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => sb.client }));
vi.mock("@/lib/data/user-profiles", () => ({ getUserProfile: vi.fn(async () => ({ currentPlanId: "plus" })) }));
vi.mock("@/lib/data/course-landings", () => ({
  getCourseLanding: vi.fn(async () => state.landing),
  saveCourseLanding: vi.fn(async () => ({ ok: true })),
}));

const course = { id: "c1", ownerId: "teacher", title: "Course" } as TeacherCourse;
const landingUrl = (name: string) => `${sb.base}/object/public/public-media/courses/c1/landing/${name}`;

function hero(imageUrl: string | null = null): CourseLandingBlock {
  return { kind: "hero", heading: "Old title", subheading: "", imageUrl };
}
function about(imageUrl: string | null = null): CourseLandingBlock {
  return { kind: "about", heading: "About me", body: "", imageUrl };
}

async function mountEditor(blocks: CourseLandingBlock[]) {
  state.landing = { template: "classic", blocks };
  render(
    <I18nProvider initialLocale="en">
      <CourseLandingEditor course={course} />
    </I18nProvider>,
  );
  await screen.findByLabelText("Headline");
}

function pick(blockIndex: number) {
  const input = document.querySelectorAll<HTMLInputElement>("input[type=file]")[blockIndex];
  fireEvent.change(input, { target: { files: [new File(["x"], "photo.png", { type: "image/png" })] } });
}

async function finishUpload() {
  await waitFor(() => expect(sb.uploads).toHaveLength(1));
  await act(async () => sb.uploads[0].finish());
}

async function save() {
  vi.mocked(saveCourseLanding).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Save page" }));
  await waitFor(() => expect(saveCourseLanding).toHaveBeenCalledTimes(1));
  await screen.findByRole("status");
  return vi.mocked(saveCourseLanding).mock.calls[0][1].blocks;
}

beforeEach(() => {
  sb.uploads.length = 0;
  sb.removed.length = 0;
  sb.tables.length = 0;
  sb.rows.length = 0;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("sales page image upload while the creator keeps editing", () => {
  it("keeps the title typed while the image was uploading", async () => {
    await mountEditor([hero(), about()]);
    pick(0);
    await waitFor(() => expect(sb.uploads).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Headline"), { target: { value: "Typed during upload" } });
    await finishUpload();
    await screen.findByRole("img", { name: "Preview of Background image URL" });

    const [savedHero] = await save();
    expect(savedHero).toMatchObject({ kind: "hero", heading: "Typed during upload" });
    expect(savedHero).toHaveProperty("imageUrl", expect.stringMatching(/^https:\/\/proj\.supabase\.co\//));
  });

  it("puts the image on the section that asked for it after the sections moved", async () => {
    await mountEditor([hero(), about()]);
    pick(1);
    await waitFor(() => expect(sb.uploads).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    await finishUpload();
    await screen.findByRole("img", { name: "Preview of Your photo URL" });

    const saved = await save();
    expect(saved.map((block) => block.kind)).toEqual(["about", "hero"]);
    expect(saved[0]).toHaveProperty("imageUrl", expect.stringMatching(/^https:\/\/proj\.supabase\.co\//));
    expect(saved[1]).toEqual(hero());
  });

  it("drops and deletes the upload when its section was removed meanwhile", async () => {
    await mountEditor([hero(), about()]);
    pick(1);
    await waitFor(() => expect(sb.uploads).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Remove About you section" }));
    await finishUpload();

    await waitFor(() => expect(sb.removed).toEqual([sb.uploads[0].path]));
    expect(await save()).toEqual([hero()]);
  });
});

describe("sales page images stay out of course material", () => {
  it("never writes a course_assets row, so Materials and the builder lists never show them", async () => {
    await mountEditor([hero(), about()]);
    pick(0);
    await finishUpload();
    await screen.findByRole("img", { name: "Preview of Background image URL" });
    await save();

    expect(sb.uploads[0].path).toMatch(/^courses\/c1\/landing\/[\w-]+\.png$/);
    expect(sb.rows).toEqual([]);
    expect(sb.tables).not.toContain("course_assets");
  });
});

describe("sales page image cleanup", () => {
  it("never deletes storage objects on save, even for a replaced or removed image", async () => {
    await mountEditor([hero(landingUrl("old.png")), about(landingUrl("gone.png"))]);
    pick(0);
    await finishUpload();
    await waitFor(() =>
      expect(screen.getAllByRole("img")[0].getAttribute("src")).not.toBe(landingUrl("old.png")),
    );
    fireEvent.change(screen.getAllByLabelText("Or paste a link")[1], { target: { value: "" } });

    await save();
    expect(sb.removed).toEqual([]);
  });

  it("saves image links trimmed", async () => {
    await mountEditor([hero(), about()]);
    fireEvent.change(screen.getAllByLabelText("Or paste a link")[0], {
      target: { value: "  https://cdn.example.com/a.png  " },
    });

    const saved = await save();
    expect(saved[0]).toMatchObject({ imageUrl: "https://cdn.example.com/a.png" });
  });
});
