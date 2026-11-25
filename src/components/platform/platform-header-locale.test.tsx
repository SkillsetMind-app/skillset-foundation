import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformHeader } from "@/components/platform/platform-header";

// The language selector only existed on the public site. Inside the platform
// (/teach, /learn, /account, /ops) there was no way to switch: the person
// had to leave for the site, switch there, and come back. All four surfaces go
// through this same header, so this is where it goes in — and at the far right,
// where the eye looks.
//
// I18nProvider is the real one, not a mock: the button's label comes from the dictionary
// through the same path the whole page uses. AccountMenu is real too:
// its width has to survive the generic styles of the icon buttons.

const mocks = vi.hoisted(() => ({ pathname: "/teach", roles: ["teacher"] as string[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
      roles: mocks.roles,
    },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/platform/notification-bell", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: () => () => {},
}));

vi.mock("@/components/shared/theme-toggle", () => ({
  ThemeToggle: () => <div data-testid="theme" />,
}));

function renderHeader(pathname: string) {
  mocks.pathname = pathname;
  const { container } = render(
    <I18nProvider initialLocale="en">
      <PlatformHeader />
    </I18nProvider>,
  );
  const actions = container.querySelector(".platform-topbar__actions");
  if (!actions) throw new Error("right cluster does not exist in the header");
  return { actions, trigger: screen.getByRole("button", { name: "Language: English" }) };
}

beforeEach(() => {
  mocks.pathname = "/teach";
  mocks.roles = ["teacher"];
});

afterEach(() => {
  cleanup();
  document.cookie = "skillset.locale.v1=; max-age=0; path=/";
  document.documentElement.lang = "";
});

describe("language on the platform's top bar", () => {
  it.each(["/teach", "/learn", "/ops", "/account"])(
    "%s has the selector, and it is the last item of the right cluster",
    (pathname) => {
      const { actions, trigger } = renderHeader(pathname);
      expect(actions).toContainElement(trigger);
      // The component wraps the trigger in a <div class="relative"> (the menu is
      // absolute). That wrapper is what has to be the last child.
      expect(actions.lastElementChild).toBe(trigger.parentElement);
      // After the account menu: further right than everything.
      expect(actions.querySelector(".account-menu-trigger")!.compareDocumentPosition(trigger))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    },
  );

  it.each(["/teach", "/learn", "/ops", "/account"])(
    "%s keeps the real account menu out of fixed-width icon rules",
    (pathname) => {
      const { actions, trigger } = renderHeader(pathname);
      const account = actions.querySelector(".account-menu-trigger")!;
      expect(account).toHaveTextContent("Teacher");
      const sheet = postcss.parse(readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8"));
      const fixedSelectors: string[] = [];
      sheet.walkRules((rule) => {
        if (!rule.selector.includes(".platform-topbar__actions") || !rule.selector.includes("> button")) return;
        rule.walkDecls("width", (declaration) => {
          if (declaration.value === "44px" && declaration.important) fixedSelectors.push(rule.selector);
        });
      });
      expect(fixedSelectors.length).toBeGreaterThan(0);
      const icon = document.createElement("button");
      actions.append(icon);
      for (const selector of fixedSelectors) {
        expect(icon.matches(selector), "icon actions retain their fixed target").toBe(true);
        expect(trigger.matches(selector), "compact language keeps its own style").toBe(false);
        expect(account.matches(selector), "account must retain its intrinsic width").toBe(false);
      }
    },
  );

  it("keeps the account avatar compact on mobile without clipping its contents", () => {
    const { actions } = renderHeader("/teach");
    const account = actions.querySelector(".account-menu-trigger")!;
    const sheet = postcss.parse(readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8"));
    const accountRules: Record<string, string>[] = [];
    const hiddenSelectors: string[] = [];
    sheet.walkAtRules("media", (media) => {
      if (media.params !== "(max-width: 640px)") return;
      media.walkRules((rule) => {
        if (rule.selector === ".platform-topbar__actions .account-menu-trigger") {
          const declarations: Record<string, string> = {};
          rule.walkDecls((d) => { declarations[d.prop] = d.value; });
          accountRules.push(declarations);
        }
        rule.walkDecls("display", (d) => {
          if (d.value === "none") hiddenSelectors.push(rule.selector);
        });
      });
    });
    expect(accountRules).toContainEqual(expect.objectContaining({
      width: "44px", height: "44px", padding: "0", gap: "0", "justify-content": "center",
    }));
    const chevron = account.querySelector(":scope > svg")!;
    const avatar = account.querySelector(".avatar-fallback")!;
    expect(hiddenSelectors.some((selector) => chevron.matches(selector))).toBe(true);
    expect(hiddenSelectors.some((selector) => avatar.matches(selector))).toBe(false);
    expect(account).toHaveAttribute("aria-expanded", "false");
    expect(account.getAttribute("aria-label")).toBeTruthy();
  });

  // The component stays the compact one (44px, no arrow, no frame of its own: on the
  // site it stays discreet). On the platform bar it gets its neighbors' frame
  // through the stylesheet: with no border or background, the "EN" looked like loose text.
  it("uses the compact variant: 44px target with no arrow; on the bar, the same frame as its neighbors", () => {
    const { trigger } = renderHeader("/teach");
    expect(trigger).toHaveClass("size-11", "locale-switcher-compact", "bg-transparent");
    expect(trigger).not.toHaveClass("border");
    expect(trigger).not.toHaveClass("rounded-full");
    expect(trigger).toHaveTextContent("EN");
    expect(trigger.querySelector("svg")).toBeNull();
    const sheet = postcss.parse(readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8"));
    const framed: Record<string, string> = {};
    sheet.walkRules((rule) => {
      if (rule.selector !== ".platform-topbar__actions .locale-switcher-compact") return;
      rule.walkDecls((d) => { framed[d.prop] = d.value; });
    });
    expect(trigger.matches(".platform-topbar__actions .locale-switcher-compact")).toBe(true);
    expect(framed).toMatchObject({ border: "1px solid var(--color-line)", background: "var(--color-surface)" });
  });

  it("switches the language without leaving the platform, and persists", () => {
    const { trigger } = renderHeader("/teach");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Español" }));

    expect(screen.getByRole("button", { name: "Idioma: Español" })).toBeInTheDocument();
    expect(document.cookie).toContain("skillset.locale.v1=es");
    expect(document.documentElement.lang).toBe("es");
  });
});

// The page name at the top: "My purchases" for the learner, "Billing" for whoever
// teaches, the same page.
describe("name of /account/billing at the top", () => {
  it.each([
    [["student"], "My purchases"],
    [["student", "teacher"], "Billing"],
  ])("%j reads %s", (roles, label) => {
    mocks.roles = roles;
    renderHeader("/account/billing");
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.querySelector(".cur")?.textContent).toBe(label);
  });
});
