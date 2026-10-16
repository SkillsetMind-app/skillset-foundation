import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MobileSidebarDrawer } from "@/components/platform/mobile-sidebar-drawer";
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
        "platform.openSectionNav": "Open {section} navigation",
        "platform.navSection.home": "Home",
        "platform.navSection.products": "Products",
        "platform.navSection.promote": "Promote",
        "platform.navSection.sales": "Sales",
        "platform.navSection.earnings": "Earnings",
        "platform.navSection.discover": "Discover",
        "platform.nav.studio": "Home",
        "platform.nav.courseBuilder": "My products",
        "platform.nav.students": "Students",
        "platform.nav.inbox": "Inbox",
        "helpMenu.trigger": "Help",
        "platform.nav.marketingOverview": "Marketing overview",
        "platform.nav.storefrontPages": "Storefront & pages",
        "platform.nav.mediaLibrary": "Media library",
        "platform.nav.coupons": "Coupons",
        "platform.nav.sales": "Sales orders",
        "platform.nav.subscriptions": "Subscriptions",
        "platform.nav.reports": "Reports",
        "platform.nav.verification": "Verification",
        "platform.nav.integrations": "Integrations",
        "platform.nav.messages": "Messages",
        "platform.nav.myCourses": "My courses",
        "platform.nav.marketplace": "Marketplace",
        "platform.nav.earnings": "Earnings",
        "platform.nav.onlineEvents": "Online events",
        "platform.help.needHelp": "Need help?",
        "platform.help.browseHelpCenter": "Browse Help Center",
        "platform.help.openTicket": "Open a support ticket",
        "platform.help.emailSupport": "Email support",
        "platform.help.replyTime": "We aim to reply within 24 hours.",
        "platform.help.openMenu": "Open help menu",
        "platform.opensInNewTab": "Opens in a new tab",
        "advisor.open": "Open studio advisor",
        "advisor.close": "Close advisor",
        "advisor.title": "Studio advisor",
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

    expect(screen.getByRole("link", { name: "SkillsetMind" })).toHaveTextContent(/^SkillsetMind$/);
  });

  it("keeps the active navigation row at the same fixed height as its peers", () => {
    render(<PlatformNav />);

    const activeLink = screen.getByRole("link", { name: "My products" });
    expect(activeLink).toHaveAttribute("aria-current", "page");
    expect(activeLink).toHaveClass("shrink-0");
    expect(activeLink).toHaveClass("h-11", "min-h-11");
  });

  // Os grupos acumulam: abrir um nao fecha o outro. Sobraram dois grupos,
  // Vendas (vendas, assinaturas, relatorios) e Promover; o primeiro vem aberto.
  it("abre o primeiro grupo e deixa vários grupos abertos ao mesmo tempo", () => {
    render(<PlatformNav />);

    const sales = screen.getByRole("button", { name: "Sales" });
    const promote = screen.getByRole("button", { name: "Promote" });

    expect(sales).toHaveAttribute("aria-expanded", "true");
    expect(promote).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Subscriptions" })).toBeInTheDocument();

    fireEvent.click(promote);

    expect(sales).toHaveAttribute("aria-expanded", "true");
    expect(promote).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Subscriptions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Marketing overview" })).toBeInTheDocument();
  });

  it("fecha um grupo ao clicar nele de novo", () => {
    render(<PlatformNav />);

    const sales = screen.getByRole("button", { name: "Sales" });
    expect(sales).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(sales);

    expect(sales).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Subscriptions" })).toBeNull();
  });

  it("keeps the day-to-day work flat and only two groups", () => {
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/teach");
    expect(screen.getByRole("link", { name: "My products" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Students" })).toHaveAttribute("href", "/teach/students");
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/teach/messages");
    expect(screen.getByRole("link", { name: "Earnings" })).toHaveAttribute("href", "/account/payments");
    expect(screen.queryByRole("button", { name: "Products" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sales" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote" })).toBeInTheDocument();
    for (const gone of ["Marketing", "Tools", "Growth"]) {
      expect(screen.queryByRole("button", { name: gone })).toBeNull();
    }
  });

  it("uses category icons only in the collapsed rail", () => {
    const onRequestExpand = vi.fn();
    render(<PlatformNav collapsed onRequestExpand={onRequestExpand} />);

    const promote = screen.getByRole("button", {
      name: "Open Promote navigation",
    });

    expect(screen.queryByRole("link", { name: "Marketing overview" })).toBeNull();

    fireEvent.click(promote);
    expect(onRequestExpand).toHaveBeenCalledOnce();
  });

  it("keeps the bottom bar labels readable (11px, not 10px)", () => {
    render(<MobileSidebarDrawer open={false} onOpen={vi.fn()} onClose={vi.fn()} />);

    const bar = screen.getByRole("navigation", { name: "platform.mobile.navLabel" });
    const items = [...bar.querySelectorAll("a, button")];
    expect(items.length).toBeGreaterThan(2);
    for (const item of items) {
      expect(item.className).not.toMatch(/text-\[10px\]/);
      expect(item.className).toMatch(/text-\[11px\]/);
    }
  });

  it("keeps the mobile drawer above the sticky application chrome", () => {
    const onClose = vi.fn();
    render(<MobileSidebarDrawer open onOpen={vi.fn()} onClose={onClose} />);

    const drawer = screen.getByRole("dialog");
    expect(drawer.parentElement).toHaveClass("z-[100]");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps My products active inside a product management route", () => {
    mocks.pathname = "/teach/courses/course-1/manage";

    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "My products" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("uses the advisor as the only global support action", async () => {
    render(<AdvisorSidebar />);

    expect(screen.queryByRole("button", { name: "Open help menu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open studio advisor" }));
    expect(screen.getByRole("dialog", { name: "Studio advisor" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "advisor.suggestions.price" });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Studio advisor" })).not.toBeInTheDocument();
  });

  it("keeps the floating fallback when no header is mounted", () => {
    render(<AdvisorSidebar />);

    expect(screen.getByRole("button", { name: "Open studio advisor" }).parentElement).toHaveClass(
      "floating-action",
      "floating-action--advisor"
    );
  });

  // O CSS pinta a barra de rolagem em .platform-sidebar .platform-sidebar-nav
  // (ver sidebar-frame.test.tsx). Se a classe sair daqui, a regra fica orfa e
  // a barra volta a sumir no navy, sem ninguem reclamar.
  it("mantem a classe que o CSS usa para pintar a barra de rolagem do menu", () => {
    render(<PlatformNav />);

    expect(screen.getByRole("navigation", { name: "Workspace" })).toHaveClass(
      "platform-sidebar-nav"
    );
  });
});
