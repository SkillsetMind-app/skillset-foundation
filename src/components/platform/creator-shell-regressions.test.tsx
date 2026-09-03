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
        "platform.navSection.marketing": "Marketing",
        "platform.navSection.sales": "Sales",
        "platform.navSection.earnings": "Earnings",
        "platform.navSection.reports": "Reports",
        "platform.navSection.tools": "Tools",
        "platform.navSection.myLearning": "My Learning",
        "platform.navSection.discover": "Discover",
        "platform.nav.studio": "Home",
        "platform.nav.courseBuilder": "My products",
        "platform.nav.membersArea": "Members & communities",
        "platform.nav.marketingOverview": "Marketing overview",
        "platform.nav.storefrontPages": "Storefront & pages",
        "platform.nav.mediaLibrary": "Media library",
        "platform.nav.coupons": "Coupons",
        "platform.nav.sales": "Sales orders",
        "platform.nav.subscriptions": "Subscriptions",
        "platform.nav.reports": "Reports",
        "platform.nav.team": "Team",
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

  // Este teste afirmava que abrir um grupo FECHAVA o anterior. O objetivo
  // declarado no nome era "lets the user switch groups" — fechar o outro era o
  // mecanismo, e era o defeito. Agora os grupos acumulam; trocar continua
  // possível, sem custo de esconder. Products e Sales viraram linhas diretas,
  // então os dois grupos que sobraram (Marketing e Tools) fazem o teste.
  it("abre a categoria ativa e deixa vários grupos abertos ao mesmo tempo", () => {
    render(<PlatformNav />);

    const marketing = screen.getByRole("button", { name: "Marketing" });
    const tools = screen.getByRole("button", { name: "Tools" });

    expect(marketing).toHaveAttribute("aria-expanded", "true");
    expect(tools).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Marketing overview" })).toBeInTheDocument();

    fireEvent.click(tools);

    // O ponto do conserto: abrir Tools não custa perder Marketing de vista.
    expect(marketing).toHaveAttribute("aria-expanded", "true");
    expect(tools).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Marketing overview" })).toBeInTheDocument();
  });

  it("fecha um grupo ao clicar nele de novo", () => {
    render(<PlatformNav />);

    const marketing = screen.getByRole("button", { name: "Marketing" });
    expect(marketing).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(marketing);

    expect(marketing).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Marketing overview" })).toBeNull();
  });

  it("keeps the day-to-day work flat and only the long tails grouped", () => {
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/teach");
    expect(screen.getByRole("link", { name: "My products" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sales orders" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Subscriptions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Products" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sales" })).toBeNull();
    expect(screen.getByRole("button", { name: "Marketing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tools" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Growth" })).toBeNull();
  });

  it("uses category icons only in the collapsed rail", () => {
    const onRequestExpand = vi.fn();
    render(<PlatformNav collapsed onRequestExpand={onRequestExpand} />);

    const marketing = screen.getByRole("button", {
      name: "Open Marketing navigation",
    });

    expect(screen.queryByRole("link", { name: "Marketing overview" })).toBeNull();

    fireEvent.click(marketing);
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

    expect(screen.getByRole("button", { name: "Open studio advisor" }).parentElement).toHaveClass(
      "floating-action",
      "floating-action--advisor"
    );
  });
});
