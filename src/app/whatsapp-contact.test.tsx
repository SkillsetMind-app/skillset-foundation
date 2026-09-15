import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ContactPage from "@/app/contact/page";
import SupportPage from "@/app/support/page";
import { I18nProvider } from "@/components/i18n/i18n-provider";

const mocks = vi.hoisted(() => ({ locale: "en" as "en" | "es" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/contact" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));
// Signed-in view of /support: the guard lets the page through.
vi.mock("@/components/auth/protected-surface", () => ({
  ProtectedSurface: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/platform/platform-shell", () => ({
  PlatformShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/support/support-ticket-center", () => ({ SupportTicketCenter: () => null }));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));

// 555-01xx is the reserved fictional range: never a real person's phone.
const NUMBER = "+1 (555) 010-0199";
const pages = [["/contact", ContactPage], ["/support", SupportPage]] as const;

async function renderPage(Page: (typeof pages)[number][1], locale: "en" | "es") {
  mocks.locale = locale;
  return render(<I18nProvider initialLocale={locale}>{await Page()}</I18nProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("WhatsApp contact, off until the number exists", () => {
  it.each(pages)("%s renders nothing WhatsApp while the number is empty", async (_path, Page) => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", "");

    const { container } = await renderPage(Page, "en");

    expect(container.innerHTML).not.toMatch(/wa\.me|whatsapp/i);
  });

  it("renders nothing for a value that is not a phone number", async () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", "call us");

    const { container } = await renderPage(ContactPage, "en");

    expect(container.innerHTML).not.toMatch(/wa\.me|whatsapp/i);
  });

  it.each(pages.flatMap(([path, Page]) => (["en", "es"] as const).map((locale) => [path, locale, Page] as const)))(
    "%s in %s: click-to-chat with a prefilled message and the 2-business-day promise",
    async (_path, locale, Page) => {
      vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", NUMBER);

      await renderPage(Page, locale);

      const link = screen.getByRole("link", { name: locale === "es" ? /Escríbenos por WhatsApp/ : /Message us on WhatsApp/ });
      const url = new URL(link.getAttribute("href")!);
      expect(`${url.origin}${url.pathname}`).toBe("https://wa.me/15550100199");
      expect(url.searchParams.get("text")).toBe(
        locale === "es" ? "Hola, equipo de SkillsetMind. Necesito ayuda con:" : "Hi SkillsetMind team, I need help with:",
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      const text = document.body.textContent ?? "";
      expect(text).toContain(locale === "es" ? "2 días hábiles (lun–vie)" : "2 business days (Mon–Fri)");
      expect(text).not.toMatch(/instant|immediate|inmediat/i);
    },
  );
});
