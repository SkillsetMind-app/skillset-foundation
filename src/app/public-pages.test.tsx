import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AboutPage from "@/app/about/page";
import ContactPage from "@/app/contact/page";
import CreatorsPage from "@/app/for-creators/page";
import HelpPage from "@/app/help/page";
import NotFound from "@/app/not-found";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

// Async server component (reads the language via next/headers); it is not what
// these tests look at.
vi.mock("@/components/site/site-footer", () => ({
  SiteFooter: () => <footer data-testid="site-footer" />,
}));

vi.mock("@/components/help/assistant-panel", () => ({
  AssistantPanel: () => null,
}));

vi.mock("@/components/help/help-center", () => ({
  HelpCenter: () => null,
}));

afterEach(cleanup);

describe("public site titles", () => {
  it("defines .page-title as a single clamp in globals.css", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toMatch(
      /\.page-title\s*\{[^}]*font-size:\s*clamp\(1\.9rem,\s*6vw,\s*3\.5rem\)/,
    );
  });

  it.each([
    ["About", AboutPage],
    ["Contact", ContactPage],
    ["Help", HelpPage],
    ["404", NotFound],
  ])("%s: the h1 uses .page-title instead of a fixed text-6xl", async (_name, Page) => {
    render(await Page());

    // A fixed 60px overflowed the width of a 360px phone.
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-(5|6)xl/);
  });
});

// S-25: they were six boxes with a shadow, each with one sentence; they became
// a checklist in a single card, like the items on the pricing cards.
describe("/for-creators", () => {
  it("the tools are a single list, with the six items", async () => {
    render(await CreatorsPage());

    const item = screen.getByText("Course builder with modules, lessons, previews, pricing, and drip release.");
    const list = item.closest("ul")!;
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("404 page", () => {
  // The store may still be empty: the 404 sends people to the home, never to a
  // catalog with no course or to the internal /platform showcase.
  it("sends people to the home, not to an empty catalog or to /platform", async () => {
    render(await NotFound());

    expect(within(screen.getByRole("main")).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/"]);
  });

  // It was a loose card: with no menu and no footer, "Go home" was the only way out.
  it("has the site bar and the footer, like the other public pages", async () => {
    render(await NotFound());

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByTestId("site-footer")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "conteudo");
  });
});

describe("support path without login", () => {
  // /support requires an account: for a visitor, "Contact support" was a login
  // screen with no warning. Email becomes the main path and the ticket is
  // presented for what it is.
  it("Help: email as the main button, ticket only for people with an account", async () => {
    render(await HelpPage());

    expect(screen.getByRole("link", { name: "Email support" })).toHaveAttribute(
      "href",
      "mailto:support@skillsetmind.com?subject=Support",
    );
    expect(
      screen.getByRole("link", { name: "Have an account? Open a ticket" }),
    ).toHaveAttribute("href", "/support");
    expect(
      screen.queryByRole("link", { name: "Contact support" }),
    ).not.toBeInTheDocument();
  });

  it("Contact: the support card sends an email; the ticket is stated for people with an account", async () => {
    render(await ContactPage());

    expect(screen.getByRole("link", { name: /Email support/ })).toHaveAttribute(
      "href",
      "mailto:support@skillsetmind.com?subject=Support",
    );
    expect(
      screen.getByRole("link", { name: "Open a tracked ticket" }),
    ).toHaveAttribute("href", "/support");
    expect(
      screen.queryByRole("link", { name: /Open a support ticket/ }),
    ).not.toBeInTheDocument();
  });

  it("Contact: the Enterprise link from /pricing arrives with the subject filled in", async () => {
    render(await ContactPage({ searchParams: Promise.resolve({ subject: "enterprise" }) }));
    expect(screen.getByRole("link", { name: /Email the team/ })).toHaveAttribute(
      "href",
      "mailto:support@skillsetmind.com?subject=Enterprise",
    );
    cleanup();

    render(await ContactPage({ searchParams: Promise.resolve({ subject: "<b>anything</b>" }) }));
    expect(screen.getByRole("link", { name: /Email the team/ })).toHaveAttribute(
      "href",
      "mailto:support@skillsetmind.com?subject=General%20inquiry",
    );
  });
});
