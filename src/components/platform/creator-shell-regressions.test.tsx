import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformNav } from "@/components/platform/platform-nav";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { AdvisorSidebar } from "@/components/teacher/advisor-sidebar";

const mocks = vi.hoisted(() => ({
  pathname: "/teach/builder",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "teacher-1",
      email: "teacher@example.com",
      displayName: "Teacher",
      emailVerified: true,
      photoURL: null,
      roles: ["teacher"],
    },
  }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "platform.sidebarNavLabel": "Workspace",
        "platform.nav.courseBuilder": "My products",
        "platform.help.needHelp": "Need help?",
        "platform.help.browseHelpCenter": "Browse Help Center",
        "platform.help.openTicket": "Open a support ticket",
        "platform.help.emailSupport": "Email support",
        "platform.help.replyTime": "We aim to reply within 24 hours.",
        "platform.help.openMenu": "Open help menu",
        "platform.opensInNewTab": "Opens in a new tab",
      })[key] ?? key,
  }),
}));

vi.mock("@/lib/advisor/config", () => ({
  isAdvisorEnabled: true,
}));

describe("creator shell regressions", () => {
  beforeEach(() => {
    mocks.pathname = "/teach/builder";
  });

  it("renders the consumer brand name exactly once", () => {
    render(<LogoWordmark />);

    expect(screen.getByRole("link", { name: "SkillsetMind" })).toHaveTextContent(
      /^SkillsetMind$/,
    );
  });

  it("keeps the active navigation row from shrinking inside the scroll rail", () => {
    render(<PlatformNav />);

    const activeLink = screen.getByRole("link", { name: "My products" });
    expect(activeLink).toHaveAttribute("aria-current", "page");
    expect(activeLink).toHaveClass("shrink-0");
    expect(activeLink).toHaveClass("min-h-[50px]");
  });

  it("keeps My products active inside a product management route", () => {
    mocks.pathname = "/teach/courses/course-1/manage";

    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "My products" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("uses the advisor as the only global support action", () => {
    render(<AdvisorSidebar />);

    expect(screen.queryByRole("button", { name: "Open help menu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open studio advisor" }));
    expect(screen.getByRole("dialog", { name: "Studio advisor" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Studio advisor" })).not.toBeInTheDocument();
  });

  it("places the advisor in the single global floating slot", () => {
    render(<AdvisorSidebar />);

    expect(
      screen.getByRole("button", { name: "Open studio advisor" }).parentElement,
    ).toHaveClass("floating-action", "floating-action--advisor");
  });
});
