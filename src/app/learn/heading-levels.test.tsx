import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every /learn page is mounted inside `PlatformShell`, and the shell is what
 * emits the `<h1>`. So the first heading of the component the page renders is
 * level 2 — not 3.
 *
 * Nine /learn components opened on `h3` and three on `h4`, directly under the
 * h1: the whole learner area skipped a level, and anyone navigating by heading
 * (screen reader, navigation shortcut) dropped from the page title straight
 * into a subsection, without the middle level that says "this is the main
 * section".
 *
 * This proof reads SOURCE CODE, on purpose. The obvious attempt — render the
 * page and read the tree — passes without seeing anything: the /learn hubs are
 * client components behind `ProtectedSurface`, and in the test harness only the
 * shell's h1 reaches the DOM. A test like that would stay green with the defect
 * back, which is worse than having no test.
 */

const LEARN_PAGES_DIR = join(process.cwd(), "src", "app", "learn");
const LEARN_COMPONENTS_DIR = join(process.cwd(), "src", "components", "learn");

function collectPageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return collectPageFiles(full);
    }
    return entry === "page.tsx" ? [full] : [];
  });
}

/** `@/components/learn/...` components imported by a page. */
function importedLearnComponents(pageSource: string): string[] {
  return Array.from(
    pageSource.matchAll(/from\s+"@\/components\/learn\/([\w-]+)"/g),
  ).map((match) => match[1]);
}

function firstHeadingLevel(componentSource: string): number | null {
  const match = componentSource.match(/<h([1-6])[\s>]/);
  return match ? Number(match[1]) : null;
}

describe("heading levels of the learner area", () => {
  const pages = collectPageFiles(LEARN_PAGES_DIR);

  it("encontra as páginas de /learn", () => {
    expect(pages.length).toBeGreaterThan(5);
  });

  it("no top-level /learn component opens below h2", () => {
    const offenders: string[] = [];

    for (const page of pages) {
      const pageSource = readFileSync(page, "utf8");

      // Only pages that go through the shell: they are the ones that already have an h1 above.
      if (!pageSource.includes("PlatformShell")) {
        continue;
      }

      for (const componentName of importedLearnComponents(pageSource)) {
        const componentPath = join(
          LEARN_COMPONENTS_DIR,
          `${componentName}.tsx`,
        );
        let source: string;
        try {
          source = readFileSync(componentPath, "utf8");
        } catch {
          continue;
        }

        const level = firstHeadingLevel(source);
        if (level !== null && level > 2) {
          offenders.push(`${componentName}.tsx abre em h${level}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("heading levels of the open lesson", () => {
  // The lesson title was h4 right below the course h1, and the comments, quiz
  // and stage notices (locked, loading, no media) were h5: two levels skipped
  // for anyone navigating by heading.
  const read = (file: string) => readFileSync(join(LEARN_COMPONENTS_DIR, file), "utf8");

  it("the lesson is h2 and its subsections are h3", () => {
    const workspace = read("enrolled-course-workspace.tsx");
    const panel = workspace.slice(workspace.indexOf("function LessonContentPanel"));
    expect(firstHeadingLevel(panel)).toBe(2);
    expect(panel).not.toMatch(/<h[45][\s>]/);
    for (const file of ["lesson-comments.tsx", "lesson-quiz.tsx"]) {
      const source = read(file);
      expect(firstHeadingLevel(source), file).toBe(3);
      expect(source, file).not.toMatch(/<h[45][\s>]/);
    }
  });

  // Under the cover the lesson title (h2) is 18px (text-lg); the stage notice
  // right below it (h3: locked, no media) was 20px. A subtitle cannot be
  // larger than its title.
  it("the stage notice is not larger than the lesson title under the cover", () => {
    const workspace = read("enrolled-course-workspace.tsx");
    expect(workspace).toContain('underHero ? "text-lg font-semibold"');
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const at = css.indexOf(".member-video-empty h5 {");
    expect(at).toBeGreaterThan(-1);
    const [, size] = css.slice(at, css.indexOf("}", at)).match(/font-size: (\d+)px;/)!;
    expect(Number(size)).toBeLessThanOrEqual(18);
  });
});
