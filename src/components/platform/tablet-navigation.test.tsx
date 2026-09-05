import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlatformShell } from "./platform-shell";

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
  user: { uid: "teacher-test", displayName: "Teacher", roles: ["teacher"] },
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("./platform-header", () => ({ PlatformHeader: () => null }));
vi.mock("./status-banner", () => ({ StatusBanner: () => null }));

function viewport(initialWidth: number) {
  let width = initialWidth;
  const queries: { matches: () => boolean; listeners: Set<() => void> }[] = [];
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    const min = Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
    const max = Number(query.match(/max-width:\s*(\d+)px/)?.[1] ?? Infinity);
    const exclusiveMax = Number(query.match(/width\s*<\s*(\d+)px/)?.[1] ?? Infinity);
    const matches = () => query.includes("width") && width >= min && width <= max && width < exclusiveMax;
    const listeners = new Set<() => void>();
    queries.push({ matches, listeners });
    return {
      get matches() { return matches(); },
      addEventListener(_event: string, listener: () => void) { listeners.add(listener); },
      removeEventListener(_event: string, listener: () => void) { listeners.delete(listener); },
    };
  }));
  // jsdom has no layout. Simulate only the two navigation surfaces disappearing
  // at the phone breakpoint; actual sizes and overflow are checked in a browser.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    const hidden = !this.isConnected || this.closest("[hidden]") ||
      (width < 768 && this.closest(".platform-sidebar")) ||
      (width >= 768 && this.closest(".platform-mobile-nav"));
    return (hidden ? [] : [new DOMRect(0, 0, 44, 44)]) as unknown as DOMRectList;
  });
  return (nextWidth: number) => {
    const previous = queries.map((query) => ({ ...query, wasMatching: query.matches() }));
    act(() => {
      width = nextWidth;
      for (const query of previous) {
        if (query.wasMatching !== query.matches()) {
          for (const listener of [...query.listeners]) listener();
        }
      }
    });
  };
}

function openGroup(section: "Marketing" | "Tools") {
  const trigger = screen.getByRole("button", { name: `Open ${section} navigation` });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  mocks.pathname = "/teach";
});

it.each([768, 1023, 1023.5])("opens both requested groups with labels and working destinations at %s px", (width) => {
  viewport(width);
  render(<PlatformShell title="Home">Content</PlatformShell>);
  const groups = {
    Marketing: [
      ["Marketing overview", "/teach/marketing"],
      ["Storefront & pages", "/teach/storefront"],
      ["Media library", "/teach/media"],
      ["Coupons", "/teach/coupons"],
    ],
    Tools: [
      ["Collaborators", "/teach/team"],
      ["Verification", "/teach/verification"],
      ["Integrations", "/teach/integrations"],
    ],
  };
  for (const section of ["Marketing", "Tools"] as const) {
    const trigger = openGroup(section);
    const drawer = screen.getByRole("dialog", { name: "Platform navigation" });
    expect(within(drawer).getByRole("button", { name: section }))
      .toHaveAttribute("aria-expanded", "true");
    for (const [label, href] of groups[section]) {
      expect(within(drawer).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
    expect(drawer).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(localStorage.getItem("skillset_sidebar_state")).toBeNull();
  }
});

it("keeps initial Shift+Tab and both focus boundaries inside the drawer", () => {
  viewport(768);
  render(<PlatformShell title="Home"><button>Page action</button></PlatformShell>);
  openGroup("Tools");
  const drawer = screen.getByRole("dialog");
  const links = within(drawer).getAllByRole("link");
  const first = links[0];
  const last = links[links.length - 1];
  expect(last).toHaveAttribute("href", "/account?tab=profile");
  expect(drawer).toHaveFocus();

  expect(fireEvent.keyDown(drawer, { key: "Tab", shiftKey: true })).toBe(false);
  expect(last).toHaveFocus();
  expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
  expect(first).toHaveFocus();
  expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
  expect(last).toHaveFocus();

  const outside = screen.getByRole("button", { name: "Page action" });
  outside.focus();
  expect(fireEvent.keyDown(outside, { key: "Tab" })).toBe(false);
  expect(first).toHaveFocus();
});

it("closes when the current route is selected, even when the pathname does not change", () => {
  viewport(768);
  mocks.pathname = "/teach/team";
  render(<PlatformShell title="Collaborators">Content</PlatformShell>);
  const trigger = openGroup("Tools");
  const link = within(screen.getByRole("dialog")).getByRole("link", { name: "Collaborators" });
  expect(link).toHaveAttribute("href", "/teach/team");
  expect(link).toHaveAttribute("aria-current", "page");
  fireEvent.click(link);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});

it.each(["close button", "backdrop", "swipe"])("closes via %s and returns focus", (action) => {
  viewport(768);
  render(<PlatformShell title="Home">Content</PlatformShell>);
  const trigger = openGroup("Marketing");
  const drawer = screen.getByRole("dialog");
  if (action === "close button") {
    fireEvent.click(within(drawer).getByRole("button", { name: "Close navigation" }));
  } else if (action === "backdrop") {
    fireEvent.click(drawer.parentElement!.querySelector("button")!);
  } else {
    fireEvent.touchStart(drawer, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(drawer, { changedTouches: [{ clientX: 100 }] });
  }
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});

it.each([767, 768])("returns focus to visible navigation after crossing the phone boundary from %i px", (width) => {
  const resize = viewport(width);
  render(<PlatformShell title="Home">Content</PlatformShell>);
  const trigger = width === 767
    ? screen.getByRole("button", { name: "Open more navigation" })
    : screen.getByRole("button", { name: "Open Tools navigation" });
  trigger.focus();
  fireEvent.click(trigger);
  const drawer = screen.getByRole("dialog");
  resize(width === 767 ? 768 : 767);
  expect(drawer).toHaveFocus();
  expect(trigger.getClientRects()).toHaveLength(0);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  const fallback = width === 767
    ? within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("link", { name: "Home" })
    : screen.getByRole("button", { name: "Open more navigation" });
  expect(fallback).toHaveFocus();
  expect(fallback.getClientRects()).toHaveLength(1);
});

it.each(["expanded", "collapsed"])("closes at desktop, releases Tab and preserves the saved %s preference", async (preference) => {
  const resize = viewport(1024);
  localStorage.setItem("skillset_sidebar_state", preference);
  const writes = vi.spyOn(Storage.prototype, "setItem");
  const { container } = render(<PlatformShell title="Home"><button>Page action</button></PlatformShell>);
  const sidebar = container.querySelector(".platform-sidebar");
  await waitFor(() => expect(sidebar).toHaveClass(`sidebar-${preference}`));
  resize(768);
  expect(sidebar).toHaveClass("sidebar-collapsed");
  const trigger = openGroup("Tools");
  resize(1023);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  resize(1024);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(sidebar).toHaveClass(`sidebar-${preference}`);
  expect(trigger).toHaveFocus();
  expect(localStorage.getItem("skillset_sidebar_state")).toBe(preference);
  expect(writes).not.toHaveBeenCalled();

  const outside = screen.getByRole("button", { name: "Page action" });
  outside.focus();
  expect(fireEvent.keyDown(outside, { key: "Tab" })).toBe(true);
  resize(1023);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("still expands a collapsed desktop sidebar when a group is requested", async () => {
  viewport(1024);
  localStorage.setItem("skillset_sidebar_state", "collapsed");
  const { container } = render(<PlatformShell title="Home">Content</PlatformShell>);
  await waitFor(() => expect(container.querySelector(".platform-sidebar")).toHaveClass("sidebar-collapsed"));
  openGroup("Tools");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(container.querySelector(".platform-sidebar")).toHaveClass("sidebar-expanded");
  expect(screen.getByRole("button", { name: "Tools" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: "Collaborators" })).toHaveAttribute("href", "/teach/team");
  expect(localStorage.getItem("skillset_sidebar_state")).toBe("expanded");
});

it("closes when resizing directly from phone to desktop without crossing the rail state", async () => {
  const resize = viewport(390);
  localStorage.setItem("skillset_sidebar_state", "collapsed");
  const { container } = render(<PlatformShell title="Home">Content</PlatformShell>);
  await waitFor(() => expect(container.querySelector(".platform-sidebar")).toHaveClass("sidebar-collapsed"));
  const trigger = screen.getByRole("button", { name: "Open more navigation" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog")).toHaveFocus();

  // The rail query is false on BOTH ends: no parent render can substitute
  // for the drawer's own breakpoint listener.
  resize(1024);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement?.getClientRects()).toHaveLength(1);
});
