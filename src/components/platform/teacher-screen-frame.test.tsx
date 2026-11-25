import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformPageHeader } from "@/components/platform/platform-page-header";
import { PlatformShell } from "@/components/platform/platform-shell";

// What the person saw: on a wide monitor each teacher screen ran from edge to
// edge (the title of a sale on the left border, the value 1500px later), and
// sibling screens had five different headers (48px serif, 36px sans-serif,
// 20px on a phone, title inside a card). Now: a column of at most
// 1280px in the studio and a single header.

const mocks = vi.hoisted(() => ({ pathname: "/teach/sales" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-test", displayName: "Teacher", roles: ["teacher"] } }),
}));
vi.mock("./platform-header", () => ({ PlatformHeader: () => null }));
vi.mock("./status-banner", () => ({ StatusBanner: () => null }));
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({ useTeacherInboxCount: () => undefined }));

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

function frame() {
  return document.querySelector(".platform-content")!.firstElementChild as HTMLElement;
}

afterEach(() => {
  cleanup();
  mocks.pathname = "/teach/sales";
});

describe("frame of the teacher screens", () => {
  it("in the studio the column is at most 1280px, centered, only from 1440px up", () => {
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Your sales">Rows</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).toHaveClass("mx-auto", "w-full", "min-[1440px]:max-w-7xl");
    // The section is still the one that scrolls: the bar stays at the window edge.
    expect(frame().parentElement).toHaveClass("platform-content");
    expect(frame()).toHaveTextContent("Rows");
  });

  // The builder uses the full width, decided by the address: by the loaded
  // editor's class, the skeleton came out at 1280px and the page jumped afterwards.
  it.each([
    ["without a course (list, skeleton, error)", <p key="list">Loading products</p>],
    ["with the editor loaded", <div key="editor" className="course-builder-shell">Editor</div>],
  ])("/teach/builder %s uses the full width from the first frame", (_label, children) => {
    mocks.pathname = "/teach/builder";
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="My products" hideHeader>{children}</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).not.toHaveClass("min-[1440px]:max-w-7xl");
    expect(frame()).not.toHaveClass("mx-auto");
  });

  // The account (Earnings opens from the teacher bar) and the learner lists get
  // the same column: they were the screens that still ran edge to edge.
  it.each([
    "/account",
    "/account/payments",
    "/account/billing",
    "/account/notifications",
    "/learn",
    "/learn/events",
    "/learn/messages",
    "/learn/wishlist",
    "/learn/credentials",
    "/learn/community",
  ])("%s gets the 1280px column, only from 1440px up", (pathname) => {
    mocks.pathname = pathname;
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Events">Rows</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).toHaveClass("mx-auto", "w-full", "min-[1440px]:max-w-7xl");
    expect(frame().parentElement).toHaveClass("platform-content");
  });

  // The classroom uses the full width by design; the members area,
  // support and the plan payment screens stay as they were.
  it.each([
    "/learn/courses/course-1",
    "/learn/courses/course-1/community",
    "/learn/areas/x",
    "/support",
    "/account/billing/upgrade",
    "/account/billing/return",
    "/account/plans",
    "/ops",
  ])("%s stays with the width it had before", (pathname) => {
    mocks.pathname = pathname;
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Events">Rows</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).not.toHaveClass("min-[1440px]:max-w-7xl");
    expect(frame()).not.toHaveClass("mx-auto");
  });

  it.each([false, true])("in the studio: a single h1, in 30px serif at any width (compact=%s), with the bottom line", (compact) => {
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Students" description="Everyone who joined." compact={compact}>
          Rows
        </PlatformShell>
      </I18nProvider>,
    );

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Students$/);
    expect(headings[0]).toHaveClass("display-title", "text-3xl");
    expect(headings[0].className).not.toMatch(/\b(?:sm|lg):text-|text-xl|text-5xl/);
    expect(screen.getByText("Everyone who joined.")).toHaveClass("mt-2", "max-w-2xl");
    const header = headings[0].closest(".pb-5") as HTMLElement;
    expect(header).toHaveClass("border-b", "border-[var(--color-line)]");
    // The old shell's rule does not apply here: it would override the breathing room.
    expect(header).not.toHaveClass("platform-page-heading");
  });

  // Decision: this package does not change the header of the learner classroom, account,
  // support or the internal panel. It comes out exactly as before.
  it.each([
    ["/learn/events", false, ["text-3xl", "sm:text-4xl", "lg:text-5xl"]],
    ["/account", true, ["text-xl", "sm:text-2xl", "lg:text-3xl"]],
    ["/ops/users/u-1", true, ["text-xl", "sm:text-2xl", "lg:text-3xl"]],
  ] as const)("%s (compact=%s) stays with the old header", (pathname, compact, sizes) => {
    mocks.pathname = pathname;
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell eyebrow="Account" title="Settings" description="Your preferences." compact={compact}>
          Rows
        </PlatformShell>
      </I18nProvider>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Settings" });
    expect(heading).toHaveClass("display-title", "max-w-4xl", ...sizes);
    const wrapper = heading.parentElement as HTMLElement;
    expect(wrapper).toHaveClass("platform-page-heading");
    expect(wrapper.classList.contains("platform-page-heading--compact")).toBe(compact);
    expect(wrapper).not.toHaveClass("border-b");
    expect(screen.getByText("Account")).toHaveClass("font-semibold", "tracking-[0.22em]");
    expect(screen.getByText("Your preferences.")).toHaveClass("max-w-3xl", "leading-7", compact ? "mt-2" : "mt-3");
    // The stylesheet's rule is also the same as before: no bottom line.
    const body = css.match(/\n\.platform-page-heading \{([^}]*)\}/)?.[1] ?? "";
    expect(body).toMatch(/padding:\s*0\.5rem 0 0\.25rem/);
    expect(body).not.toMatch(/border/);
  });

  it("the page actions stay in the same header, to the right of the title", () => {
    render(
      <PlatformPageHeader
        eyebrow="Products"
        title="Members & communities"
        actions={<button type="button">New product</button>}
      />,
    );

    const header = screen.getByRole("heading", { level: 1 }).closest(".pb-5") as HTMLElement;
    expect(header).toHaveClass("flex", "items-end", "justify-between");
    expect(within(header).getByText("Products")).toHaveClass("uppercase");
    expect(within(header).getByRole("button", { name: "New product" })).toBeInTheDocument();
  });

  // The Advisor anchored at the top sits right below the bar's layer: the
  // bell panel and the account menu, which live in it, open above the conversation.
  it("the anchored Advisor sits below the top bar's layer", () => {
    // Only the declaration (the bar comment cites "z-index: 1" in the middle of the text).
    const zIndex = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      const body = start === -1 ? "" : css.slice(start, css.indexOf("}", start));
      return Number(body.match(/\n\s*z-index:\s*(\d+);/)?.[1]);
    };
    const bar = zIndex(".platform-topbar");
    const anchored = zIndex(".floating-action--advisor.floating-action--anchored");
    expect(bar).toBe(60);
    expect(anchored).toBeLessThan(bar);
  });
});
