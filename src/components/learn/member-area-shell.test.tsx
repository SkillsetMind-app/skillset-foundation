import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberAreaShell } from "@/components/learn/member-area-shell";

// The bell needs the notifications subscription; what it does in the shell is
// proved in member-area-bell.test.tsx. Here, only the shell.
vi.mock("@/components/platform/notification-bell", () => ({
  NotificationBell: () => null,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "student-1",
      email: "student@example.com",
      displayName: "Student",
      emailVerified: true,
      photoURL: null,
      roles: ["student"],
    },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: () => () => {},
}));

describe("MemberAreaShell", () => {
  it("puts the members theme on its own root so the --ma-* tokens cover the page", () => {
    const { container } = render(
      <MemberAreaShell theme="dark">
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(
      container.querySelector('[data-members-theme="dark"]'),
    ).not.toBeNull();
  });

  // Theme still unknown (the creator's area is loading): neither light nor dark,
  // so the dark area is not born light and then turns dark.
  // The header stays (logo, Help, account): if the read is slow, the way out
  // stays on screen. And no aria-busy around the loading notice,
  // which the screen reader might silence.
  it("theme null: neutral platform palette, with the header and without aria-busy", () => {
    const { container } = render(
      <MemberAreaShell theme={null}>
        <p role="status">Loading</p>
      </MemberAreaShell>,
    );

    expect(container.querySelector('[data-members-theme="pending"]')).not.toBeNull();
    expect(container.querySelector('[data-members-theme="light"], [data-members-theme="dark"]')).toBeNull();
    expect(container.querySelector("header .logo-wordmark__themed--auto")).not.toBeNull();
    expect(container.querySelector('header a[href="/learn"]')).not.toBeNull();
    expect(container.querySelector("[aria-busy]")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });

  it.each([
    ["dark", "logo-wordmark__themed--dark"],
    ["light", "logo-wordmark__themed--light"],
  ] as const)(
    "the logo follows the course theme (%s), not the app theme",
    (theme, tone) => {
      // The dark course's --ma-bg-top is almost black even with the app in the
      // light theme: the "auto" logo followed <html> and came out navy on dark.
      const { container } = render(
        <MemberAreaShell theme={theme}>
          <p>Lesson</p>
        </MemberAreaShell>,
      );

      expect(container.querySelector(`header .${tone}`)).not.toBeNull();
    },
  );

  it("shows the teacher's mark, with no link to our public home, when the teacher is branded", () => {
    const { container } = render(
      <MemberAreaShell brand={{ name: "Atelier Curie" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(screen.getByText("Atelier Curie")).toBeInTheDocument();
    expect(screen.queryByText("Exit to dashboard")).toBeNull();
    expect(container.querySelector('a[href="/"]')).toBeNull();
  });

  it("the teacher's brand name does not use the display serif", () => {
    // Cormorant is a DISPLAY serif: at 18px, in the top bar, it disappears.
    const { container } = render(
      <MemberAreaShell brand={{ name: "Atelier Curie" }}>
        <p>content</p>
      </MemberAreaShell>,
    );

    const name = container.querySelector("header span");
    expect(name).toHaveTextContent("Atelier Curie");
    expect(name).not.toHaveClass("display-title");
    expect(name?.className).toContain("font-semibold");
  });

  it("only lets a sanitized hex accent reach the CSS custom property", () => {
    const { container, rerender } = render(
      <MemberAreaShell brand={{ name: "Atelier", accentColor: "#123456" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    const root = () =>
      container.querySelector<HTMLElement>("[data-members-theme]");

    expect(root()?.style.getPropertyValue("--ma-accent")).toBe("#123456");

    rerender(
      <MemberAreaShell brand={{ name: "Atelier", accentColor: "javascript:x" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(root()?.style.getPropertyValue("--ma-accent")).toBe("");
  });

  it("pairs the teacher accent with a text colour that reads on it", () => {
    const { container } = render(
      <MemberAreaShell brand={{ name: "Atelier", accentColor: "#f5c518" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    const style = container.querySelector<HTMLElement>("[data-members-theme]")?.style;

    // Fixed white on top of that yellow gave 1.6:1.
    expect(style?.getPropertyValue("--ma-on-accent")).toBe("#0a0d12");
    // The hover must not go back to the platform red with dark ink on top.
    expect(style?.getPropertyValue("--ma-accent-hover")).toBe("#f5c518");
  });

  // The room had no account menu or Help, and the logo led to the public
  // home. Now: logo -> My courses; Help and account at the top, with or without the
  // teacher's brand.
  it("the logo leads to My courses, not to the public home", () => {
    const { container } = render(
      <MemberAreaShell>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(container.querySelector('header a[href="/learn"]')).not.toBeNull();
    expect(container.querySelector('header a[href="/"]')).toBeNull();
  });

  it.each([
    ["sem marca", null],
    ["com a marca do professor", { name: "Atelier Curie" }],
  ])("has Help and an account menu (%s)", (_label, brand) => {
    render(
      <MemberAreaShell brand={brand}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    // Only one Help: the room has no sidebar, so it lives at the top.
    expect(screen.getAllByRole("button", { name: "Help" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeInTheDocument();
  });

  // In the room with the teacher's brand, the account menu does not open doors into
  // SkillsetMind; without a brand, they stay.
  it.each([
    ["sem marca", null, true],
    ["com a marca do professor", { name: "Atelier Curie" }, false],
  ])("account menu %s: 'Become a teacher' and 'Go to dashboard' appear = %s", (_label, brand, shown) => {
    render(
      <MemberAreaShell brand={brand}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    for (const name of ["Become a teacher", "Go to dashboard"]) {
      if (shown) expect(screen.getByRole("link", { name })).toBeInTheDocument();
      else expect(screen.queryByRole("link", { name })).toBeNull();
    }
    // Help is not repeated inside the account menu.
    expect(screen.getAllByRole("button", { name: "Help" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it.each([
    [true, "/learn/courses/curso-1/community"],
    [false, "/learn/courses/curso-1/messages"],
  ])("the lesson question goes to the course community (community enabled: %s)", (communityEnabled, href) => {
    render(
      <MemberAreaShell course={{ href: "/learn/courses/curso-1", communityEnabled }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    expect(within(dialog).getByRole("link", { name: /Question about a lesson/ })).toHaveAttribute("href", href);
    expect(within(dialog).getByRole("link", { name: /Private matter with the teacher/ })).toHaveAttribute(
      "href",
      "/learn/courses/curso-1/messages",
    );
  });
});
