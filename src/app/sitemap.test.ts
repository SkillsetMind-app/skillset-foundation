import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data/server/public-course", () => ({ listPublishedCourses: async () => [] }));

import sitemap from "./sitemap";

describe("sitemap", () => {
  it("lists every public legal page, the copyright policy included", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    for (const path of ["/legal/terms", "/legal/privacy", "/legal/teacher-terms", "/legal/copyright"]) {
      expect(urls).toContain(`https://www.skillsetmind.com${path}`);
    }
  });
});
