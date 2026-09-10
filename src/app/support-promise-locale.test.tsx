import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SupportPage from "@/app/support/page";
import PromiseChangelogPage, { generateMetadata } from "@/app/promise/changelog/page";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({ locale: "en" as "en" | "es" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.locale }) }) }));
vi.mock("@/components/auth/protected-surface", () => ({
  ProtectedSurface: ({ children, permissions }: { children: ReactNode; permissions: string[] }) =>
    <div data-testid="protected" data-permissions={permissions.join(",")}>{children}</div>,
}));
vi.mock("@/components/platform/platform-shell", () => ({
  PlatformShell: ({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) =>
    <main><p>{eyebrow}</p><h1>{title}</h1><p>{description}</p>{children}</main>,
}));
vi.mock("@/components/support/support-ticket-center", () => ({ SupportTicketCenter: () => <div data-testid="support-center" /> }));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));

afterEach(cleanup);

describe("support and Promise server pages use the cookie and real dictionaries", () => {
  it.each(["en", "es"] as const)("localizes the changelog metadata in %s", async locale => {
    mocks.locale = locale;
    const title = locale === "es" ? "Cada cambio en la Promesa debe ser p\u00fablico." : "Every Promise change belongs in public.";
    const description = translate(getDictionary(locale), "promiseChangelog.description");
    expect(await generateMetadata()).toMatchObject({
      title: `${title} | SkillsetMind`, description,
      alternates: { canonical: "https://www.skillsetmind.com/promise/changelog" },
      openGraph: { title: `${title} | SkillsetMind`, description },
      twitter: { title: `${title} | SkillsetMind`, description },
    });
  });

  it("requires every changelog translation in the shipped dictionaries, without English fallback", () => {
    for (const key of ["eyebrow", "title", "description", "publishedOn", "publication", "changeTitle", "whatChanged", "why", "effectiveNew", "effectiveExisting", "futureFormat", "futureTitle", "futureChange", "futureWhy", "futureNew", "futureExisting"]) {
      const path = `promiseChangelog.${key}`;
      const english = translate(getDictionary("en"), path);
      const spanish = translate(getDictionary("es"), path);
      expect(english).not.toBe(path);
      expect(spanish).not.toBe(path);
      expect(spanish).not.toBe(english);
    }
  });

  it.each(["en", "es"] as const)("renders the complete support header in %s with the same access gate", async locale => {
    mocks.locale = locale;
    render(<I18nProvider initialLocale={locale}>{await SupportPage()}</I18nProvider>);
    expect(screen.getByRole("heading", { name: locale === "es" ? "Obt\u00e9n ayuda sin salir de la plataforma." : "Get help without leaving the platform." })).toBeInTheDocument();
    expect(screen.getByText(locale === "es" ? "Soporte" : "Support")).toBeInTheDocument();
    expect(screen.getByText(translate(getDictionary(locale), "supportCenter.pageDescription"))).toBeInTheDocument();
    expect(screen.getByTestId("protected")).toHaveAttribute("data-permissions", "auth.signOut");
    expect(screen.getByTestId("support-center")).toBeInTheDocument();
  });

  it.each(["en", "es"] as const)("localizes the entire changelog in %s while preserving policy dates and notice periods", async locale => {
    mocks.locale = locale;
    render(<I18nProvider initialLocale={locale}>{await PromiseChangelogPage()}</I18nProvider>);
    const t = (key: string) => translate(getDictionary(locale), `promiseChangelog.${key}`);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(locale === "es"
      ? "Cada cambio en la Promesa debe ser p\u00fablico."
      : "Every Promise change belongs in public.");
    const format = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    const published = format.format(new Date("2026-05-11T00:00:00Z"));
    const effective = format.format(new Date("2026-07-24T00:00:00Z"));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t("publishedOn").replace("{date}", published));
    expect(screen.getByText(t("publication").replace("{date}", published))).toHaveTextContent("90");
    expect(screen.getByText(t("effectiveNew").replace("{date}", effective))).toBeInTheDocument();
    expect(screen.getByText(t("effectiveExisting").replace("{date}", effective))).toHaveTextContent("90");
    for (const key of ["eyebrow", "description", "whatChanged", "why", "futureFormat", "futureChange", "futureWhy", "futureNew", "futureExisting"]) {
      expect(t(key)).not.toBe(`promiseChangelog.${key}`);
      expect(screen.getByText(t(key))).toBeInTheDocument();
    }
    expect(screen.getByText((_text, element) => element?.tagName === "P" && element.textContent?.startsWith("2026-07-24") === true)).toHaveTextContent(t("changeTitle"));
    expect(screen.getByText((_text, element) => element?.tagName === "STRONG" && element.textContent?.startsWith("YYYY-MM-DD") === true)).toHaveTextContent(t("futureTitle"));
    const body = screen.getByRole("main").textContent ?? "";
    expect(body).not.toMatch(/promiseChangelog\.|\{date\}/);
    expect(body).toContain("30");
    expect(body).toContain("Stripe");
    expect(body).toContain("SkillsetMind");
    if (locale === "es") {
      expect(body).toContain("ning\u00fan creador vend\u00eda bajo la promesa anterior");
      expect(body).toContain("comerciante responsable de la venta");
      expect(body).not.toMatch(/What changed:|Why:|Effective from:|Effective for existing creators:|Future entry format/);
    }
  });
});
