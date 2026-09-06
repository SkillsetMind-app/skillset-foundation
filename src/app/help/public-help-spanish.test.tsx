import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HelpPage, { generateMetadata as helpMetadata } from "./page";
import HowPage, { generateMetadata as howMetadata } from "@/app/how-it-works/page";
import TrustPage, { generateMetadata as trustMetadata } from "@/app/trust/page";
import FeesPage, { generateMetadata as feesMetadata } from "@/app/fees-and-payouts/page";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { HelpCenter } from "@/components/help/help-center";
import { AssistantPanel } from "@/components/help/assistant-panel";
import { helpFaqCategories } from "@/data/help-faq";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "es" }) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/lib/assistant/config", () => ({ isAssistantEnabled: true }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Switch() {
  const { setLocale } = useTranslation();
  return <><button onClick={() => setLocale("en")}>EN</button><button onClick={() => setLocale("es")}>ES</button></>;
}

it.each([
  [HelpPage, helpMetadata, "Centro de ayuda.", "Centro de ayuda"],
  [HowPage, howMetadata, "Aprendizaje centrado en cursos, con comunidad integrada.", "Cómo funciona"],
  [TrustPage, trustMetadata, "Un catálogo necesita reglas antes de crecer.", "Confianza y seguridad"],
  [FeesPage, feesMetadata, "Tus compradores te pagan. Directamente.", "Comisiones y transferencias"],
] as const)("renders the public page and its metadata in Spanish", async (Page, metadata, heading, title) => {
  const { container } = render(<I18nProvider initialLocale="es">{await Page()}</I18nProvider>);
  expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  expect((await metadata()).title).toContain(title);
  expect(container.textContent).not.toMatch(/publicPages\.|Your buyers pay you|Help center\.|A marketplace needs rules/);
});

it("keeps every translated FAQ grounded in the canonical English source", () => {
  const en = getDictionary("en");
  const es = getDictionary("es");
  render(<I18nProvider initialLocale="es"><HelpCenter categories={helpFaqCategories} /></I18nProvider>);
  for (const category of helpFaqCategories) {
    const base = `publicPages.helpFaq.${category.id}`;
    expect(translate(en, `${base}.label`)).toBe(category.label);
    expect(screen.getByRole("link", { name: translate(es, `${base}.label`) })).toHaveAttribute("href", `#${category.id}`);
    category.items.forEach((item, index) => {
      expect(translate(en, `${base}.items.${index}.q`)).toBe(item.q);
      expect(translate(en, `${base}.items.${index}.a`)).toBe(item.a);
      const heading = screen.getByRole("heading", { name: translate(es, `${base}.items.${index}.q`) });
      if (item.id) expect(heading.closest("article")).toHaveAttribute("id", item.id);
    });
  }
});

it("preserves a typed search across EN to ES and searches the displayed Spanish answers", () => {
  render(<I18nProvider initialLocale="en"><Switch /><HelpCenter categories={helpFaqCategories} /></I18nProvider>);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Stripe" } });
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByRole("searchbox", { name: "Buscar ayuda" })).toHaveValue("Stripe");
  expect(screen.getByRole("heading", { name: "¿Cuándo recibo mi primera transferencia?" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "reembolsos" } });
  expect(screen.getByRole("heading", { name: "¿Cómo se gestionan los reembolsos?" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "¿SkillsetMind admite clases en vivo?" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no-match-xyz" } });
  expect(screen.getByText("No hay artículos de ayuda que coincidan con «no-match-xyz».")).toBeInTheDocument();
});

it.each([
  ["en", "ES", "refunds", "How are refunds handled?", "¿Cómo se gestionan los reembolsos?"],
  ["es", "EN", "reembolsos", "¿Cómo se gestionan los reembolsos?", "How are refunds handled?"],
] as const)("retains %s search results when switching to %s", (locale, destination, query, before, after) => {
  render(<I18nProvider initialLocale={locale}><Switch /><HelpCenter categories={helpFaqCategories} /></I18nProvider>);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: query } });
  expect(screen.getByRole("heading", { name: before })).toBeInTheDocument();
  const articles = screen.getAllByRole("article");
  fireEvent.click(screen.getByText(destination));
  expect(screen.getByRole("searchbox")).toHaveValue(query);
  expect(screen.getByRole("heading", { name: after })).toBeInTheDocument();
  expect(screen.getAllByRole("article")).toEqual(articles);
});

it("translates an existing assistant notice while preserving the draft and request contract", async () => {
  const request = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
  vi.stubGlobal("fetch", request);
  render(<I18nProvider initialLocale="en"><Switch /><AssistantPanel /></I18nProvider>);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Original user question" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("You've sent a lot of messages. Please wait a moment and try again.");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsent draft" } });
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByText("Has enviado muchos mensajes. Espera un momento e inténtalo de nuevo.")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("Unsent draft");
  expect(screen.getByText("Original user question")).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ messages: [{ role: "user", content: "Original user question" }] });
});

it("preserves an authored assistant reply when language changes", async () => {
  const request = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ reply: "Original API answer." }) }));
  vi.stubGlobal("fetch", request);
  render(<I18nProvider initialLocale="en"><Switch /><AssistantPanel /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "How do refunds work?" }));
  await screen.findByText("Original API answer.");
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByText("Original API answer.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enviar mensaje" })).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(["toString", "__proto__"])("does not resolve inherited notice properties (%s)", async (notice) => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: notice }) })));
  render(<I18nProvider initialLocale="es"><AssistantPanel /></I18nProvider>);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Original question" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
  expect(await screen.findByText(notice)).toBeInTheDocument();
});

it("preserves the financial figures and limits on the Spanish fee page", async () => {
  const { container } = render(await FeesPage());
  expect(container).toHaveTextContent("Free 10% · Starter 5% · Pro 3% · Plus 2%");
  expect(container).toHaveTextContent("2.9% + $0.30");
  expect(container).toHaveTextContent("5.4% + $0.30");
  expect(container).toHaveTextContent("durante 7 días");
  expect(container).toHaveTextContent("1.5% de contracargos en un período móvil de 90 días");
  expect(screen.getByRole("link", { name: "página de precios" })).toHaveAttribute("href", "/pricing");
});
