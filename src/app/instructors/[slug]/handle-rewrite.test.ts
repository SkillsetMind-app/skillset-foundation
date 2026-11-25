// @vitest-environment node
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../../next.config";

// `/@usuario` cannot be a folder (in the App Router, @ is a parallel route slot):
// it is a next.config rewrite to the profile page. Same matcher and same
// destination builder that Next uses.
async function rewriteOf(pathname: string): Promise<string | null> {
  const rewrites = await nextConfig.rewrites!();
  const list = Array.isArray(rewrites)
    ? rewrites
    : [...(rewrites.beforeFiles ?? []), ...(rewrites.afterFiles ?? []), ...(rewrites.fallback ?? [])];
  for (const rule of list) {
    const params = getPathMatch(rule.source)(pathname);
    if (params) {
      return prepareDestination({ appendParamsToQuery: false, destination: rule.destination, params, query: {} }).newUrl;
    }
  }
  return null;
}

describe("/@usuario", () => {
  it("serves the profile page without changing the URL", async () => {
    expect(await rewriteOf("/@ana.souza")).toBe("/instructors/@ana.souza");
    expect(await rewriteOf("/@ana_souza-2")).toBe("/instructors/@ana_souza-2");
  });

  it("does not swallow other routes or subpaths", async () => {
    for (const path of ["/courses", "/instructors/abc", "/ana", "/@ana/extra", "/@"]) {
      expect(await rewriteOf(path), path).toBeNull();
    }
  });
});
