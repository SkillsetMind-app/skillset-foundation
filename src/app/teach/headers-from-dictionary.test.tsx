import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({
  locale: "es" as "en" | "es",
  permissions: [] as string[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/server", () => ({
  getServerTranslation: async () => ({
    locale: mocks.locale,
    t: (key: string) => translate(getDictionary(mocks.locale), key),
  }),
}));
vi.mock("@/components/auth/protected-surface", () => ({
  ProtectedSurface: ({ children, permissions }: { children: ReactNode; permissions: string[] }) => {
    mocks.permissions = permissions;
    return children;
  },
}));
vi.mock("@/components/platform/platform-shell", () => ({
  // Mirrors the real shell: the `title` ONLY exists inside the header. With
  // `hideHeader` it goes nowhere — no invented aria-label,
  // otherwise the test starts proving something the product does not do.
  PlatformShell: ({ children, eyebrow, title, description, hideHeader }: {
    children: ReactNode; eyebrow?: string; title: string; description?: string; hideHeader?: boolean;
  }) => createElement("main", null,
    hideHeader ? null : createElement("header", null,
      createElement("p", null, eyebrow),
      createElement("h1", null, title),
      createElement("p", null, description),
    ), children),
}));
vi.mock("@/components/teacher/teacher-messages-inbox", () => ({ TeacherMessagesInbox: () => null }));
vi.mock("@/components/teacher/teacher-inbox-questions", () => ({ TeacherInboxQuestions: () => null }));
vi.mock("@/components/teacher/sale-detail", () => ({
  SaleDetail: ({ orderId }: { orderId: string }) => createElement("output", null, orderId),
}));
vi.mock("@/components/teacher/storefront-settings-panel", () => ({ StorefrontSettingsPanel: () => null }));
vi.mock("@/components/teacher/custom-domains-panel", () => ({ CustomDomainsPanel: () => null }));
vi.mock("@/components/teacher/creator-subscription-center", () => ({ CreatorSubscriptionCenter: () => null }));
vi.mock("@/components/teacher/stripe-connect-notice", () => ({ StripeConnectNotice: () => null }));
vi.mock("@/components/teacher/teacher-wallet-panel", () => ({
  // Mirrors what the real panel does after this change: it carries the <h1>
  // of the page. The mock needs this so that the proof of the single header is
  // about the real tree, and not about an invented marker.
  TeacherWalletPanel: () =>
    createElement("section", null, createElement("h1", null, "Tus ganancias, tu configuración de pagos")),
}));

import AccountPaymentsPage from "../account/payments/page";
import TeacherMessagesPage from "./messages/page";
import TeacherSaleDetailPage from "./sales/[orderId]/page";
import TeacherStorefrontPage from "./storefront/page";
import TeacherSubscriptionsPage from "./subscriptions/page";

// What the person suffered: with the interface in Spanish, Reports opened with
// "Teacher Studio / Reports." and the whole paragraph in English — the header was
// fixed text on the page, outside the dictionary (visual QA in production, Sep 8).
// Sales and Events had the same fixed header.

const pages = ["reports", "sales", "events"] as const;
const en = JSON.parse(readFileSync("src/data/i18n/en.json", "utf8"));
const es = JSON.parse(readFileSync("src/data/i18n/es.json", "utf8"));

afterEach(cleanup);

describe("studio page headers", () => {
  it.each(pages)("the %s page carries no fixed text in the header", (page) => {
    const source = readFileSync(`src/app/teach/${page}/page.tsx`, "utf8");

    expect(source).not.toMatch(/\b(eyebrow|title|description)="/);
    expect(source).toContain("getServerTranslation");
  });

  it.each(pages)("the %s header exists in both languages and changes language", (page) => {
    const key = `${page}Page`;

    for (const field of ["title", "description"]) {
      expect(en.teach[key][field], `en teach.${key}.${field}`).toBeTruthy();
      expect(es.teach[key][field], `es teach.${key}.${field}`).toBeTruthy();
    }
    // The generic label "Teacher Studio" left the header (it did not name the
    // screen or a group); the unused key left together with it from both dictionaries.
    if (page !== "events") {
      expect(en.teach[key].eyebrow).toBeUndefined();
      expect(es.teach[key].eyebrow).toBeUndefined();
    }
    expect(es.teach[key].title).not.toBe(en.teach[key].title);
    expect(es.teach[key].description).not.toBe(en.teach[key].description);
  });
});

describe("payments does not repeat the panel header", () => {
  // What the person suffered: /account/payments showed "Payouts & tax" (fixed in
  // English, even in Spanish) and right below it the panel repeated "PAYOUTS & TAX" +
  // "Your earnings, your payout setup." — the same thing three times.
  it("carries no fixed text in the header", () => {
    const source = readFileSync("src/app/account/payments/page.tsx", "utf8");

    expect(source).not.toMatch(/\b(eyebrow|title|description)="/);
    expect(source).toContain("getServerTranslation");
  });

  it.each(["es", "en"] as const)("in %s the page has ONE header, the panel's", async (locale) => {
    mocks.locale = locale;
    render(
      <I18nProvider initialLocale={locale}>{await AccountPaymentsPage()}</I18nProvider>,
    );

    // One h1 only — the panel's. The shell does not add its own (it was the third
    // title of the same screen), and the page does not end up without a level-1 heading.
    const titulos = screen.getAllByRole("heading", { level: 1 });
    expect(titulos).toHaveLength(1);
    expect(titulos[0]).toHaveTextContent("Tus ganancias, tu configuración de pagos");
    // Neither the fixed English title, nor the old name of the page.
    expect(screen.queryByText("Payouts & tax")).toBeNull();
    expect(screen.queryByText("Pagos e impuestos")).toBeNull();
    expect(mocks.permissions).toEqual(["teacherStudio.access"]);
  });
});

describe("the other creator entries use the session language", () => {
  const routes = [
    { name: "sales/[orderId]", page: () => TeacherSaleDetailPage({ params: Promise.resolve({ orderId: "sale-fixture" }) }), key: "saleDetailPage", title: "Detalle de la venta" },
    { name: "storefront", page: TeacherStorefrontPage, key: "storefrontPage", title: "Tu tienda" },
    { name: "subscriptions", page: TeacherSubscriptionsPage, key: "subscriptionsPage", title: "Suscripciones" },
  ];

  it.each(routes)("$name renders Spanish without changing the permission or the destination", async ({ name, page, key, title }) => {
    mocks.locale = "es";
    render(<I18nProvider initialLocale="es">{await page()}</I18nProvider>);

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    // The generic label "Estudio del Profesor" left the header: it did not
    // name the screen or a group, it only repeated which side the person is on.
    expect(screen.queryByText("Estudio del Profesor")).toBeNull();
    expect(screen.getByText(translate(getDictionary("es"), `teach.${key}.description`))).toBeInTheDocument();
    expect(screen.queryByText(translate(getDictionary("en"), `teach.${key}.description`))).not.toBeInTheDocument();
    expect(mocks.permissions).toEqual([name === "storefront" ? "teacherStudio.manageStorefront" : "teacherStudio.access"]);
    if (name === "sales/[orderId]") expect(screen.getByText("sale-fixture")).toBeInTheDocument();
  });

  it.each(routes)("$name still renders English", async ({ name, page, key }) => {
    mocks.locale = "en";
    render(<I18nProvider initialLocale="en">{await page()}</I18nProvider>);

    const title = name === "subscriptions" ? /^Subscriptions\.?$/ : translate(getDictionary("en"), `teach.${key}.title`);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(translate(getDictionary("en"), `teach.${key}.description`))).toBeInTheDocument();
  });

  // "Messages", hidden inside Marketing, became the Inbox:
  // community questions + conversations, on one screen.
  it.each(["es", "en"] as const)("the Inbox opens with the bar name in %s", async (locale) => {
    mocks.locale = locale;
    render(<I18nProvider initialLocale={locale}>{await TeacherMessagesPage()}</I18nProvider>);

    const dict = getDictionary(locale);
    expect(screen.getByRole("heading", { level: 1, name: translate(dict, "platform.nav.inbox") })).toBeInTheDocument();
    expect(screen.getByText(translate(dict, "teach.inboxPage.description"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: translate(dict, "teach.inboxPage.messagesTitle") })).toBeInTheDocument();
    expect(mocks.permissions).toEqual(["teacherStudio.access"]);
  });
});
