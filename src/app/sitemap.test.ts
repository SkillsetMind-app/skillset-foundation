import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCourseSlugs } from "@/lib/data/catalog";
import type { PublicCourseSummary } from "@/lib/data/server/public-course";

const state = vi.hoisted(() => ({ courses: [] as PublicCourseSummary[] }));
vi.mock("@/lib/data/server/public-course", () => ({ listPublishedCourses: async () => state.courses }));

import sitemap from "./sitemap";

const SITE = "https://www.skillsetmind.com";
const urls = async () => (await sitemap()).map((entry) => entry.url);

beforeEach(() => {
  state.courses = [];
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

  it("lists the store and each real course once one is published", async () => {
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
