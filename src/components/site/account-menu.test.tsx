import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/components/site/account-menu";

const mocks = vi.hoisted(() => ({
  pathname: "/learn",
  subscribeToUserProfile: vi.fn(() => () => {}),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: mocks.subscribeToUserProfile,
}));

function openMenu(roles: string[], pathname: string) {
  mocks.pathname = pathname;
  render(
    <AccountMenu
      user={
        {
          uid: "u-1",
          email: "person@example.com",
          displayName: "Test Person",
          roles,
        } as never
      }
      onSignOut={async () => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("account menu viewport and dismissal", () => {
  function geometry(width = 320, height = 700, x = 201.6) {
    vi.stubGlobal("innerWidth", width);
    vi.stubGlobal("innerHeight", height);
    vi.stubGlobal("visualViewport", undefined);
    // jsdom has no layout. These dimensions reproduce the measured trigger
    // and menu; assertions below exercise positioning, not browser rendering.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "account-menu-panel") {
        return new DOMRect(0, 0,
          Math.min(280, parseFloat(this.style.maxWidth) || 280),
          Math.min(612, parseFloat(this.style.maxHeight) || 612));
      }
      if (this.classList.contains("account-menu-trigger") || this.querySelector(":scope > .account-menu-trigger")) {
        return new DOMRect(x, 7, 44, 44);
      }
      return new DOMRect();
    });
  }

  it.each([
    [320, 700, 201.6],
    [240, 260, 170],
    [768, 300, 610],
    [1440, 700, 1380],
  ])("keeps the panel inside %sx%s at anchor %s", (width, height, x) => {
    geometry(width, height, x);
    openMenu(["admin", "teacher"], "/teach");
    const panel = document.getElementById("account-menu-panel")!;
    const left = x + parseFloat(panel.style.left);
    const top = 7 + parseFloat(panel.style.top);
    const bounds = panel.getBoundingClientRect();
    expect(left, "menu left must clear the viewport edge").toBeGreaterThanOrEqual(8);
    expect(left + bounds.width).toBeLessThanOrEqual(width - 8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + bounds.height).toBeLessThanOrEqual(height - 8);
    expect(panel.style.overflowY).toBe("auto");
  });

  it("repositions when the visible viewport shrinks or pans", () => {
    geometry();
    const viewport = Object.assign(new EventTarget(), { width: 320, height: 700, offsetLeft: 0, offsetTop: 0 });
    vi.stubGlobal("visualViewport", viewport);
    openMenu(["admin", "teacher"], "/teach");
    const panel = document.getElementById("account-menu-panel")!;
    viewport.width = 200;
    viewport.height = 260;
    viewport.offsetLeft = 40;
    viewport.offsetTop = 30;
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    const bounds = panel.getBoundingClientRect();
    expect(201.6 + parseFloat(panel.style.left)).toBeGreaterThanOrEqual(48);
    expect(201.6 + parseFloat(panel.style.left) + bounds.width).toBeLessThanOrEqual(232);
    expect(7 + parseFloat(panel.style.top) + bounds.height).toBeLessThanOrEqual(282);
  });

  it("returns focus to the trigger when Escape closes a focused account link", () => {
    openMenu(["admin", "teacher"], "/teach");
    const trigger = document.querySelector<HTMLButtonElement>(".account-menu-trigger")!;
    const link = screen.getByRole("link", { name: /go to.*dashboard/i });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(document.getElementById("account-menu-panel")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("does not steal focus from an outside click", () => {
    openMenu(["teacher"], "/teach");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    fireEvent.mouseDown(outside);
    expect(document.getElementById("account-menu-panel")).toBeNull();
    expect(outside).toHaveFocus();
    outside.remove();
  });
});

describe("workspace switcher in the account menu", () => {
  it("offers an admin who also teaches both of their other workspaces", () => {
    // The founder holds admin and teacher on one account. Staff used to be
    // excluded from the switcher outright, so he had no way into his own
    // studio from the menu — the bug this exists to prevent coming back.
    openMenu(["admin", "teacher"], "/learn");

    expect(screen.getByRole("link", { name: /teacher view/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /operations view/i })).toBeInTheDocument();
  });

  it("hides the workspace you are already in", () => {
    // Otherwise it is a list of links, not a toggle.
    openMenu(["admin", "teacher"], "/teach");

    expect(screen.queryByRole("link", { name: /teacher view/i })).toBeNull();
    expect(screen.getByRole("link", { name: /student view/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /operations view/i })).toBeInTheDocument();
  });

  it("matches a workspace by its subpaths too", () => {
    openMenu(["admin", "teacher"], "/teach/courses/abc");

    expect(screen.queryByRole("link", { name: /teacher view/i })).toBeNull();
  });

  it("offers no studio to someone who does not teach, only the application", () => {
    openMenu(["student"], "/learn");

    expect(screen.queryByRole("link", { name: /teacher view/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /operations view/i })).toBeNull();
    expect(
      screen.getByRole("link", { name: /become a teacher/i }),
    ).toBeInTheDocument();
  });

  it("offers no operations to a teacher who is not an admin", () => {
    openMenu(["teacher"], "/teach");

    expect(screen.queryByRole("link", { name: /operations view/i })).toBeNull();
    expect(screen.getByRole("link", { name: /student view/i })).toBeInTheDocument();
  });

  // O admin procurava "ver como" no menu do avatar (reanalise Ops 5). E um
  // atalho para a fila de acessos, onde o "ver como" de verdade mora.
  it("gives an admin a 'View as' shortcut to the access queue, and nobody else", () => {
    openMenu(["admin"], "/ops");
    expect(screen.getByRole("link", { name: /view as/i })).toHaveAttribute(
      "href",
      "/ops?tab=access",
    );
    cleanup();

    openMenu(["teacher"], "/teach");
    expect(screen.queryByRole("link", { name: /view as/i })).toBeNull();
  });
});
