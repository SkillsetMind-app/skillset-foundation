import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCourseSlugs } from "@/lib/data/catalog";
import type { PublicCourseSummary } from "@/lib/data/server/public-course";

const state = vi.hoisted(() => ({ courses: [] as PublicCourseSummary[], hasCourses: false }));
vi.mock("@/lib/data/server/public-course", () => ({
  listPublishedCourses: async () => state.courses,
  hasRealPublishedCourse: async () => state.hasCourses,
}));

import sitemap from "./sitemap";

const SITE = "https://www.skillsetmind.com";
const urls = async () => (await sitemap()).map((entry) => entry.url);

beforeEach(() => {
  state.courses = [];
  state.hasCourses = false;
});

describe("sitemap", () => {
  it("lists every public legal page, the copyright policy included", async () => {
    const list = await urls();
    for (const path of ["/legal/terms", "/legal/privacy", "/legal/teacher-terms", "/legal/copyright"]) {
      expect(list).toContain(`${SITE}${path}`);
    }
  });

  it("lists the public how-it-works and refund-policy pages", async () => {
    const list = await urls();
    expect(list).toContain(`${SITE}/how-it-works`);
    expect(list).toContain(`${SITE}/refund-policy`);
  });

  it("leaves out an empty store and the demo course samples", async () => {
    const list = await urls();
    expect(list).not.toContain(`${SITE}/courses`);
    for (const slug of getCourseSlugs()) {
      expect(list).not.toContain(`${SITE}/courses/${slug}`);
    }
  });

  // The store toggle asks the cached, cookie-less check — not the length of
  // the course list, which a stale session or a slow read can empty.
  it("keeps the store listed whenever a real course exists, even if the course list read came back empty", async () => {
    state.hasCourses = true;
    expect(await urls()).toContain(`${SITE}/courses`);
  });

  it("lists the store and each real course once one is published", async () => {
    state.hasCourses = true;
    state.courses = [
      {
        id: "c-1",
        urlSlug: "deep-focus-systems",
        title: "Deep Focus Systems",
        summary: null,
        category: null,
        coverImageUrl: null,
        lessonCount: 3,
        updatedAt: null,
      },
    ];
    const list = await urls();
    expect(list).toContain(`${SITE}/courses`);
    expect(list).toContain(`${SITE}/courses/deep-focus-systems`);
  });
});
