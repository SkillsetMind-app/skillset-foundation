import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Living documentation: every path cited between backticks in these documents must
 * exist. If a file moves or goes away, this test breaks and forces the document to
 * be updated in the same PR, instead of the map rotting in silence.
 */
const ROOT = process.cwd();
const DOCUMENTS = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/README.md",
  "docs/ONBOARDING.md",
];
const CITED_PATH = /`((?:src|supabase|scripts|\.github|docs)\/[^`\s]*)`/g;

describe("the documentation only cites paths that exist", () => {
  for (const doc of DOCUMENTS) {
    it(doc, () => {
      const text = readFileSync(join(ROOT, doc), "utf8");
      const paths = [...text.matchAll(CITED_PATH)].map((m) => m[1]);

      // A regex that matches nothing would pass green without checking anything.
      expect(paths.length, `${doc} cites no path`).toBeGreaterThan(0);

      const missing = paths.filter((c) => !existsSync(join(ROOT, c)));
      expect(missing, `${doc} cites paths that do not exist`).toEqual([]);
    });
  }
});
