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
  PlatformShell: ({ children, eyebrow, title, description, hideHeader }: {
    children: ReactNode; eyebrow?: string; title: string; description?: string; hideHeader?: boolean;
  }) => createElement("main", { "aria-label": title },
    hideHeader ? null : createElement("header", null,
      createElement("p", null, eyebrow),
      createElement("h1", null, title),
      createElement("p", null, description),
    ), children),
}));
vi.mock("@/components/teacher/teacher-messages-inbox", () => ({ TeacherMessagesInbox: () => null }));
vi.mock("@/components/teacher/sale-detail", () => ({
  SaleDetail: ({ orderId }: { orderId: string }) => createElement("output", null, orderId),
}));
vi.mock("@/components/teacher/storefront-settings-panel", () => ({ StorefrontSettingsPanel: () => null }));
vi.mock("@/components/teacher/custom-domains-panel", () => ({ CustomDomainsPanel: () => null }));
vi.mock("@/components/teacher/creator-subscription-center", () => ({ CreatorSubscriptionCenter: () => null }));
vi.mock("@/components/teacher/stripe-connect-notice", () => ({ StripeConnectNotice: () => null }));

import TeacherIntegrationsPage from "./integrations/page";
import TeacherMessagesPage from "./messages/page";
import TeacherSaleDetailPage from "./sales/[orderId]/page";
import TeacherStorefrontPage from "./storefront/page";
import TeacherSubscriptionsPage from "./subscriptions/page";
import TeacherTeamPage from "./team/page";

// O que a pessoa sofria: com a interface em espanhol, Relatorios abria com
// "Teacher Studio / Reports." e o paragrafo inteiro em ingles — o cabecalho era
// texto fixo na pagina, fora do dicionario (QA visual em producao, 08/09).
// Vendas e Eventos tinham o mesmo cabecalho fixo.

const pages = ["reports", "sales", "events"] as const;
const en = JSON.parse(readFileSync("src/data/i18n/en.json", "utf8"));
const es = JSON.parse(readFileSync("src/data/i18n/es.json", "utf8"));

afterEach(cleanup);

describe("cabecalhos das paginas do estudio", () => {
  it.each(pages)("a pagina %s nao carrega texto fixo no cabecalho", (page) => {
    const source = readFileSync(`src/app/teach/${page}/page.tsx`, "utf8");

    expect(source).not.toMatch(/\b(eyebrow|title|description)="/);
    expect(source).toContain("getServerTranslation");
  });

  it.each(pages)("o cabecalho de %s existe nos dois idiomas e muda de idioma", (page) => {
    const key = `${page}Page`;

    for (const field of ["eyebrow", "title", "description"]) {
      expect(en.teach[key][field], `en teach.${key}.${field}`).toBeTruthy();
      expect(es.teach[key][field], `es teach.${key}.${field}`).toBeTruthy();
    }
    expect(es.teach[key].title).not.toBe(en.teach[key].title);
    expect(es.teach[key].description).not.toBe(en.teach[key].description);
  });
});

describe("as demais entradas do criador usam o idioma da sessão", () => {
  const routes = [
    { name: "integrations", page: TeacherIntegrationsPage, key: "integrationsPage", title: "Las integraciones están previstas." },
    { name: "messages", page: TeacherMessagesPage, key: "messagesPage", title: "Responde a tus alumnos." },
    { name: "sales/[orderId]", page: () => TeacherSaleDetailPage({ params: Promise.resolve({ orderId: "sale-fixture" }) }), key: "saleDetailPage", title: "Detalle de la venta." },
    { name: "storefront", page: TeacherStorefrontPage, key: "storefrontPage", title: "Tu tienda." },
    { name: "subscriptions", page: TeacherSubscriptionsPage, key: "subscriptionsPage", title: "Suscripciones" },
    { name: "team", page: TeacherTeamPage, key: "teamPage", title: "Los equipos y roles están previstos." },
  ];

  it.each(routes)("$name renderiza espanhol sem mudar a permissão nem o destino", async ({ name, page, key, title }) => {
    mocks.locale = "es";
    render(<I18nProvider initialLocale="es">{await page()}</I18nProvider>);

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(name === "messages" ? "Mensajes de alumnos" : "Estudio del Profesor")).toBeInTheDocument();
    expect(screen.getByText(translate(getDictionary("es"), `teach.${key}.description`))).toBeInTheDocument();
    expect(screen.queryByText(translate(getDictionary("en"), `teach.${key}.description`))).not.toBeInTheDocument();
    expect(mocks.permissions).toEqual([name === "storefront" ? "teacherStudio.manageStorefront" : "teacherStudio.access"]);
    if (name === "sales/[orderId]") expect(screen.getByText("sale-fixture")).toBeInTheDocument();
  });

  it.each(routes)("$name continua renderizando inglês", async ({ name, page, key }) => {
    mocks.locale = "en";
    render(<I18nProvider initialLocale="en">{await page()}</I18nProvider>);

    const title = name === "subscriptions" ? /^Subscriptions\.?$/ : translate(getDictionary("en"), `teach.${key}.title`);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(translate(getDictionary("en"), `teach.${key}.description`))).toBeInTheDocument();
  });

  it.each([
    { page: TeacherIntegrationsPage, feature: "Integraciones", primaryLabel: "Pagos e impuestos", primaryHref: "/account/payments" },
    { page: TeacherTeamPage, feature: "Colaboradores", primaryLabel: "Volver al estudio del creador", primaryHref: "/teach" },
  ])("traduz também as ações do painel planejado de $feature", async ({ page, feature, primaryLabel, primaryHref }) => {
    mocks.locale = "es";
    render(<I18nProvider initialLocale="es">{await page()}</I18nProvider>);

    expect(screen.getByText("Planificado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: primaryLabel })).toHaveAttribute("href", primaryHref);
    expect(screen.getByRole("link", { name: "Abre el constructor de cursos" })).toHaveAttribute("href", "/teach/builder");
    const notify = screen.getByRole("link", { name: "Avísame cuando esté listo" });
    expect(decodeURIComponent(notify.getAttribute("href") ?? "")).toBe(`mailto:support@skillsetmind.com?subject=Avísame: ${feature}`);
  });
});
