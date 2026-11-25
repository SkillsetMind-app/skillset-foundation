import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { getCourseSlugs } from "@/lib/data/catalog";

/**
 * `generateStaticParams` marks the route as static (SSG) at build time. With an empty
 * list, the build generates no page and does not find out that the route reads the session;
 * in production, the first visit tries to generate the static page, runs into the
 * cookie and Vercel serves /500. That is what took down the classroom tabs, the community
 * question and /learn/community/<course> from Sep 2 to Sep 10.
 *
 * Only the pages below export the function, because their list comes from the catalog
 * and is not empty: when generating the first page, the build runs into the cookie and marks
 * the route as dynamic (ƒ in the route table of the build).
 */
const CATALOG_PAGES = ["courses/[slug]/page.tsx", "learn/courses/[slug]/page.tsx"];
const APP_DIR = join(process.cwd(), "src", "app");

function collectPageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return collectPageFiles(full);
    }
    return entry === "page.tsx" ? [full] : [];
  });
}

describe("routes with generateStaticParams", () => {
  const withStaticParams = collectPageFiles(APP_DIR)
    .filter((file) => readFileSync(file, "utf8").includes("generateStaticParams"))
    .map((file) => relative(APP_DIR, file).split(sep).join("/"));

  it("only the catalog pages export the function", () => {
    expect(withStaticParams.filter((page) => !CATALOG_PAGES.includes(page))).toEqual([]);
  });

  it("the catalog that feeds these pages is not empty", () => {
    expect(getCourseSlugs().length).toBeGreaterThan(0);
  });
});
