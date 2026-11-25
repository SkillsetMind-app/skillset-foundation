import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  OTHER_SHELL_PREFIXES,
  PLATFORM_SHELL_AREAS,
  opensInPlatformShell,
} from "@/components/platform/platform-routes";

// F-03, stage 0: while the session resolves, the login guard waits with the
// shape of the PlatformShell on the routes that opensInPlatformShell accepts. Source
// read, as in avisos-esperas-restantes.test.tsx: each protected page of the
// five areas has to open in the PlatformShell, or be in the outside list
// (OTHER_SHELL_PREFIXES). A new page with another shell breaks here, instead
// of waiting with a shape that is not its own.

const app = join(process.cwd(), "src", "app");
const components = join(process.cwd(), "src", "components");

// Without comments: several pages mention "PlatformShell" in a comment.
function code(path: string) {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// The pages that pass the guard or the shell to a component. The component
// is read together with the page. A new page that delegates to another: goes here.
const delegates: Record<string, string> = {
  // The internal panel mounts its own PlatformShell.
  "<OpsDashboard": "admin/ops-dashboard.tsx",
  // The classroom pages pass the guard and the MemberAreaShell to it.
  "<LearnCoursePage": "learn/learn-course-page.tsx",
  // Only lets the teacher through: returns the children (the page's PlatformShell) or nothing.
  "<PlansForTeachersOnly": "account/plans-for-teachers-only.tsx",
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

// src/app/teach/sales/[orderId]/page.tsx -> /teach/sales/x (the "(x)" group goes away).
function routeOf(file: string) {
  const segments = relative(app, dirname(file))
    .split(sep)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => (segment.startsWith("[") ? "x" : segment));
  return `/${segments.join("/")}`;
}

const pages = PLATFORM_SHELL_AREAS.flatMap((area) => sources(join(app, area.slice(1))))
  .map((file) => {
    const own = code(file);
    const delegated = Object.entries(delegates)
      .filter(([tag]) => own.includes(tag))
      .map(([, component]) => code(join(components, component)));
    const source = [own, ...delegated].join("\n");
    return {
      file: relative(app, file).split(sep).join("/"),
      route: routeOf(file),
      guarded: source.includes("<ProtectedSurface"),
      shell: source.includes("<PlatformShell"),
    };
  })
  .filter((page) => page.guarded);

describe("the guard wait has the shell of each page", () => {
  // An empty list becomes zero tests and passes silently.
  it("finds the protected pages of the five areas, with and without a shell", () => {
    expect(pages.length).toBeGreaterThan(30);
    expect(pages.some((page) => page.shell)).toBe(true);
    expect(pages.some((page) => !page.shell)).toBe(true);
  });

  it.each(pages.map((page) => [page.file, page] as const))("%s", (_file, page) => {
    // If it broke: the page has another shell (or delegates the PlatformShell to a
    // component that is not yet in `delegates`). Put its path in
    // OTHER_SHELL_PREFIXES, or the component in `delegates`.
    expect(page.shell, `${page.route} opens in the PlatformShell?`).toBe(opensInPlatformShell(page.route));
  });

  // An exception with no page behind it is garbage in the rule: it goes away from here too.
  it.each(OTHER_SHELL_PREFIXES)("%s still has a protected page outside the shell", (prefix) => {
    expect(pages.some((page) => page.route.startsWith(prefix) && !page.shell)).toBe(true);
  });

  it("the delegated components do what the list says", () => {
    expect(code(join(components, "admin/ops-dashboard.tsx"))).toContain("<PlatformShell");
    const classroom = code(join(components, "learn/learn-course-page.tsx"));
    expect(classroom).toContain("<ProtectedSurface");
    expect(classroom).toContain("<MemberAreaShell");
    expect(classroom).not.toContain("<PlatformShell");
    expect(code(join(components, "account/plans-for-teachers-only.tsx"))).toContain("canTeach ? children : null");
  });
});
