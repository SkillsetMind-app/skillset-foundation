import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformNav } from "@/components/platform/platform-nav";

// The menus by role. The learner saw 10 links in two groups that opened and
// closed (someone in "Learn" did not see "Messages"); the teacher saw 18
// links, with the learners' messages hidden inside "Marketing" and three
// items that did nothing. Now: learner with four fixed items + Help, and
// purchases/settings at the bottom; teacher with eight items at the first level.

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
  roles: ["teacher"] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "person-1",
      email: "person@example.com",
      displayName: "Person",
      emailVerified: true,
      photoURL: null,
      roles: mocks.roles,
    },
  }),
}));

afterEach(() => {
  cleanup();
  mocks.pathname = "/teach";
  mocks.roles = ["teacher"];
});

/** What the person sees at the first level, in order: direct links, group
 *  triggers and the Help button. The footer (Marketplace) is left out. */
function firstLevel() {
  const nav = screen.getByRole("navigation", { name: "Workspace" });
  return [...nav.querySelectorAll(":scope > .platform-nav-section")].flatMap((section) =>
    [...section.querySelectorAll(":scope > a, :scope > button, :scope > .help-menu > button")].map(
      (control) => control.textContent?.trim(),
    ),
  );
}

describe("teacher sidebar", () => {
  it("eight items at the first level (plus Events inside Products), Help last", () => {
    render(<PlatformNav />);

    expect(firstLevel()).toEqual([
      "Home",
      "My products",
      "Online events",
      "Students",
      "Inbox",
      "Sales",
      "Earnings",
      "Promote",
      "Help",
    ]);
  });

  it("os destinos diretos", () => {
    render(<PlatformNav />);

    for (const [label, href] of [
      ["Home", "/teach"],
      ["My products", "/teach/builder"],
      ["Students", "/teach/students"],
      ["Inbox", "/teach/messages"],
      ["Earnings", "/account/payments"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("Sales and Promote are the only two groups", () => {
    render(<PlatformNav />);

    // Sales is the first group: it comes open.
    const sales = screen.getByRole("button", { name: "Sales" });
    expect(sales).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Sales" })).toHaveAttribute("href", "/teach/sales");
    expect(screen.getByRole("link", { name: "Subscriptions" })).toHaveAttribute("href", "/teach/subscriptions");
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/teach/reports");

    const promote = screen.getByRole("button", { name: "Promote" });
    fireEvent.click(promote);
    expect(promote).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Marketing overview" })).toHaveAttribute("href", "/teach/marketing");
    expect(screen.getByRole("link", { name: "Storefront & pages" })).toHaveAttribute("href", "/teach/storefront");
    expect(screen.getByRole("link", { name: "Media library" })).toHaveAttribute("href", "/teach/media");
  });

  it("the items that left: dead ones, tools (avatar) and the jump to the learner side (top)", () => {
    render(<PlatformNav />);
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));

    for (const gone of [
      "Collaborators",
      "Integrations",
      "Coupons",
      "Verification",
      "Members & communities",
      "Messages",
      "My courses",
      "Plans & fees",
    ]) {
      expect(screen.queryByRole("link", { name: gone }), gone).toBeNull();
    }
  });

  it("the number of pending items appears beside Inbox", () => {
    render(<PlatformNav navigationCounts={{ "/teach/messages": 3 }} />);

    const inbox = screen.getByRole("link", { name: /Inbox/ });
    expect(inbox).toHaveAttribute("href", "/teach/messages");
    expect(inbox).toHaveTextContent("3");
  });

  it("Marketplace segue no pe da barra", () => {
    render(<PlatformNav />);

    const footer = screen.getByRole("link", { name: "Marketplace" }).closest(".platform-nav-footer");
    expect(footer).not.toBeNull();
    expect(within(footer as HTMLElement).getAllByRole("link")).toHaveLength(1);
  });
});

describe("learner sidebar", () => {
  it.each([
    ["so estuda", ["student"], ["My purchases", "/account/billing"]],
    ["tambem ensina", ["student", "teacher"], ["Billing", "/account/billing"]],
  ] as const)("four fixed items, Help, and at the bottom purchases and settings (%s)", (_label, roles, purchases) => {
    mocks.roles = [...roles];
    mocks.pathname = "/learn";
    render(<PlatformNav />);

    expect(firstLevel()).toEqual([
      "My courses",
      "Messages",
      "Communities",
      "Certificates",
      "Help",
      purchases[0],
      "Settings",
    ]);
    expect(screen.getByRole("link", { name: "My courses" })).toHaveAttribute("href", "/learn");
    expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("href", "/learn/messages");
    expect(screen.getByRole("link", { name: "Communities" })).toHaveAttribute("href", "/learn/community");
    expect(screen.getByRole("link", { name: "Certificates" })).toHaveAttribute("href", "/learn/credentials");
    expect(screen.getByRole("link", { name: purchases[0] })).toHaveAttribute("href", purchases[1]);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/account");
  });

  it("no creator plans, no 'Classroom' and no jump to the studio on the bar", () => {
    mocks.roles = ["student", "teacher"];
    mocks.pathname = "/learn";
    render(<PlatformNav />);

    expect(screen.queryByRole("link", { name: "Plans & fees" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Classroom" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Teach" })).toBeNull();
    expect(document.querySelector('a[href="/account/plans"]')).toBeNull();
    expect(document.querySelector('a[href="/teach"]')).toBeNull();
  });

  it("the bar's Help opens the learner's three choices in place", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/learn";
    render(<PlatformNav />);

    const help = screen.getByRole("button", { name: "Help" });
    fireEvent.click(help);

    expect(help).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    expect(within(dialog).getByRole("link", { name: /Question about a lesson/ })).toHaveAttribute("href", "/learn/community");
    expect(within(dialog).getByRole("link", { name: /Private matter with the teacher/ })).toHaveAttribute("href", "/learn/messages");
  });
});
