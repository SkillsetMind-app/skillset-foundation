import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The eight /ops panels opened with a 30px serif headline plus a
// three-line paragraph: the operator scrolled past a headline before seeing the queue
// (Ops reanalysis 4). The title became 16px without serif, like the Audit log one.

const adminDir = join(process.cwd(), "src/components/admin");

describe("paineis de /ops", () => {
  it("no panel opens with a serif headline (display-title)", () => {
    const panels = readdirSync(adminDir).filter(
      (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"),
    );
    expect(panels.length).toBeGreaterThan(5);

    // Single exception: the person's record draws the PAGE's h1, in place of the
    // shell's (which goes with hideHeader), because the name only arrives in the browser
    // (I-03). It is the page title, not a panel headline: one use, in an h1.
    const offenders = panels.filter((name) => {
      const source = readFileSync(join(adminDir, name), "utf8");
      const uses = source.match(/display-title/g)?.length ?? 0;
      if (name === "ops-user-dossier.tsx") return uses !== 1 || !source.includes('<h1 className="display-title');
      return uses > 0;
    });
    expect(offenders).toEqual([]);
  });
});

describe("internal links open in the same tab", () => {
  // Exception: legal terms opened from inside a form (onboarding).
  // Navigating in the same tab would lose what the person already filled in.
  it("no <Link> to an internal route (literal href with /) asks for target _blank", () => {
    const files = readdirSync(join(process.cwd(), "src/components"), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((e) => e.isFile() && e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx"))
      .map((e) => join(e.parentPath, e.name));
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<Link\b[^>]*>/g)) {
        const tag = match[0];
        if (/href="\/(?!legal\/)[^"]*"/.test(tag) && tag.includes('target="_blank"')) {
          violations.push(`${file}: ${tag.slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
