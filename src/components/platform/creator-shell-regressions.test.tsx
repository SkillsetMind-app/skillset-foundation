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
        "platform.nav.studio": "Home",
        "platform.nav.courseBuilder": "My products",
        "platform.nav.membersArea": "Members & communities",
        "platform.nav.marketingOverview": "Marketing overview",
        "platform.nav.storefrontPages": "Storefront & pages",
        "platform.nav.mediaLibrary": "Media library",
        "platform.nav.coupons": "Coupons",
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
  // mecanismo, e era o defeito: medido no /teach, com seis grupos, nunca havia
  // mais de 7 a 9 links visíveis, então o criador nunca via o mapa do produto e
  // /teach/media e /teach/sales não tinham caminho a partir do estado inicial.
  // Agora os grupos acumulam; trocar continua possível, sem custo de esconder.
  it("abre a categoria ativa e deixa vários grupos abertos ao mesmo tempo", () => {
    render(<PlatformNav />);

    const products = screen.getByRole("button", { name: "Products" });
    const sales = screen.getByRole("button", { name: "Sales" });

    expect(products).toHaveAttribute("aria-expanded", "true");
    expect(sales).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "My products" })).toBeInTheDocument();

    fireEvent.click(sales);

    // O ponto do conserto: abrir Sales não custa perder Products de vista.
    expect(products).toHaveAttribute("aria-expanded", "true");
    expect(sales).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "My products" })).toBeInTheDocument();
  });

  it("fecha um grupo ao clicar nele de novo", () => {
    render(<PlatformNav />);

    const products = screen.getByRole("button", { name: "Products" });
    expect(products).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(products);

    expect(products).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "My products" })).toBeNull();
  });

  it("keeps Home direct while grouping the producer workspace by workflow", () => {
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/teach");
    expect(screen.getByRole("button", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marketing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Growth" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tools" })).toBeInTheDocument();
  });

  it("uses category icons only in the collapsed rail", () => {
    const onRequestExpand = vi.fn();
    render(<PlatformNav collapsed onRequestExpand={onRequestExpand} />);

    const products = screen.getByRole("button", {
      name: "Open Products navigation",
    });

    expect(products).toHaveClass("platform-nav-active");
    expect(screen.queryByRole("link", { name: "My products" })).toBeNull();

    fireEvent.click(products);
    expect(onRequestExpand).toHaveBeenCalledOnce();
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
