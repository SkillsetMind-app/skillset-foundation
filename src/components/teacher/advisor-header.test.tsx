import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TeachLayout from "@/app/teach/layout";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { MemberAreaShell } from "@/components/learn/member-area-shell";
import { PlatformHeader } from "@/components/platform/platform-header";
import type { Locale } from "@/lib/i18n/config";
import type { Role } from "@/lib/permissions";

const viewer = vi.hoisted(() => ({
  uid: "teacher-1" as string | null,
  roles: ["teacher"] as Role[],
  enabled: true,
  pathname: "/teach",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => viewer.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: viewer.uid ? "authenticated" : "unauthenticated",
    user: viewer.uid ? { uid: viewer.uid, roles: viewer.roles } : null,
    signOut: vi.fn(),
  }),
}));
vi.mock("@/lib/advisor/config", () => ({ get isAdvisorEnabled() { return viewer.enabled; } }));
vi.mock("@/components/teacher/activation-gate", () => ({ ActivationGate: () => null }));
vi.mock("@/components/platform/platform-search", () => ({ PlatformSearch: () => null }));
vi.mock("@/components/platform/notification-bell", () => ({ NotificationBell: () => <button>Notifications</button> }));
vi.mock("@/components/site/account-menu", () => ({ AccountMenu: () => <button>Account</button> }));
vi.mock("@/components/shared/theme-toggle", () => ({ ThemeToggle: () => <button>Theme</button> }));
vi.mock("@/components/shared/logo-wordmark", () => ({ LogoWordmark: () => <span>SkillsetMind</span> }));
vi.mock("@/components/i18n/locale-switcher", () => ({ LocaleSwitcher: () => <button>Language</button> }));

let width = 1440;
const media = new Map<string, EventTarget & { readonly matches: boolean }>();
const fetchMock = vi.fn();

function resize(nextWidth: number) {
  act(() => {
    width = nextWidth;
    for (const query of media.values()) query.dispatchEvent(new Event("change"));
  });
}

function ChangeLanguage() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Switch to Spanish</button>;
}

function tree(children: ReactNode = <PlatformHeader />, locale: Locale = "en") {
  return <I18nProvider initialLocale={locale}>
    <ChangeLanguage />
    <TeachLayout>{children}<p>Course content remains available</p></TeachLayout>
  </I18nProvider>;
}

async function openAdvisor() {
  fireEvent.click(screen.getByRole("button", { name: "Open studio advisor" }));
  await screen.findByText("Saved advice stays in English.");
}

beforeEach(() => {
  viewer.uid = "teacher-1";
  viewer.roles = ["teacher"];
  viewer.enabled = true;
  viewer.pathname = "/teach";
  width = 1440;
  media.clear();
  vi.stubGlobal("matchMedia", (query: string) => {
    if (!media.has(query)) {
      const target = new EventTarget() as EventTarget & { readonly matches: boolean };
      Object.defineProperty(target, "matches", { get: () => query === "(min-width: 768px)" && width >= 768 });
      media.set(query, target);
    }
    return media.get(query);
  });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({
    conversationId: "local-conversation",
    messages: [{ role: "assistant", content: "Saved advice stays in English." }],
  }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = "";
  document.cookie = "skillset.locale.v1=; max-age=0; path=/";
});

describe("Advisor no cabecalho sem cobrir o conteudo", () => {
  it.each([768, 1024, 1440])("coloca o unico gatilho no cabecalho antes do sino em %i px", currentWidth => {
    width = currentWidth;
    render(tree());
    const header = screen.getByRole("banner");
    const trigger = within(header).getByRole("button", { name: "Open studio advisor" });
    expect(screen.getAllByRole("button", { name: "Open studio advisor" })).toHaveLength(1);
    expect(trigger.closest(".floating-action")).toBeNull();
    expect(trigger.compareDocumentPosition(screen.getByRole("button", { name: "Notifications" })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([320, 390, 767])("preserva o unico gatilho flutuante no celular em %i px", currentWidth => {
    width = currentWidth;
    render(tree());
    const trigger = screen.getByRole("button", { name: "Open studio advisor" });
    expect(trigger.closest(".floating-action--advisor")).not.toBeNull();
    expect(screen.getByRole("banner")).not.toContainElement(trigger);
  });

  it.each([false, true])("mantem o acesso no cabecalho da previa, inclusive whitelabel=%s", branded => {
    viewer.pathname = "/teach/builder/course-1/preview";
    render(tree(<MemberAreaShell brand={branded ? { name: "Local brand" } : null}><p>Preview</p></MemberAreaShell>));
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("button", { name: "Open studio advisor" })).toBeInTheDocument();
    if (!branded) {
      const trigger = within(header).getByRole("button", { name: "Open studio advisor" });
      expect(trigger.compareDocumentPosition(screen.getByRole("button", { name: "Notifications" })))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("nao injeta Advisor na sala do aluno, mesmo se o usuario tambem for professor", () => {
    viewer.pathname = "/learn/courses/course-1";
    render(<MemberAreaShell><p>Student classroom</p></MemberAreaShell>);
    expect(screen.queryByRole("button", { name: /advisor/i })).toBeNull();
    expect(screen.getByText("Student classroom")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["signed-out", "student", "disabled"])("preserva a pagina e bloqueia o Advisor: %s", condition => {
    if (condition === "signed-out") viewer.uid = null;
    if (condition === "student") viewer.roles = ["student"];
    if (condition === "disabled") viewer.enabled = false;
    render(tree());
    expect(screen.getByText("Course content remains available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /advisor/i })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("troca o cabecalho da pagina e preserva painel, rascunho e uma unica leitura do historico", async () => {
    const view = render(tree(<PlatformHeader key="home" />));
    await openAdvisor();
    const composer = screen.getByRole("textbox", { name: "Message to studio advisor" });
    fireEvent.change(composer, { target: { value: "Unsent draft" } });
    viewer.pathname = "/teach/events";
    view.rerender(tree(<PlatformHeader key="events" />));
    expect(screen.getByRole("textbox", { name: "Message to studio advisor" })).toBe(composer);
    expect(composer).toHaveValue("Unsent draft");
    fireEvent.keyDown(composer, { key: "Escape" });
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Open studio advisor" })).toHaveFocus();
    await openAdvisor();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([[390, 768], [1440, 390]])("resize %i→%i conserva o compositor e Escape devolve foco ao gatilho visivel", async (from, to) => {
    width = from;
    render(tree());
    await openAdvisor();
    const composer = screen.getByRole("textbox", { name: "Message to studio advisor" });
    resize(to);
    expect(composer).toHaveFocus();
    fireEvent.keyDown(composer, { key: "Escape" });
    const trigger = screen.getByRole("button", { name: "Open studio advisor" });
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("banner").contains(trigger)).toBe(to >= 768);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserva foco do gatilho fechado quando ele muda entre cabecalho e celular", () => {
    render(tree());
    act(() => screen.getByRole("button", { name: "Open studio advisor" }).focus());
    resize(390);
    expect(screen.getByRole("button", { name: "Open studio advisor" })).toHaveFocus();
    resize(768);
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Open studio advisor" })).toHaveFocus();
  });

  it("traduz controles e saudacao em ES sem traduzir o historico ou perder o rascunho", async () => {
    render(tree());
    await openAdvisor();
    fireEvent.change(screen.getByRole("textbox", { name: "Message to studio advisor" }), { target: { value: "My own words" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch to Spanish" }));
    expect(screen.getByRole("dialog", { name: "Asesor del estudio" })).toBeInTheDocument();
    expect(screen.getByText(/^Hola, soy tu asesor del estudio\./)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Mensaje al asesor del estudio" })).toHaveValue("My own words");
    expect(screen.getByRole("textbox", { name: "Mensaje al asesor del estudio" })).toHaveAttribute("placeholder", "Pregunta sobre videos, precios, estructura…");
    expect(screen.getByRole("button", { name: "Enviar mensaje" })).toBeInTheDocument();
    expect(screen.getByText("Saved advice stays in English.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Mensaje al asesor del estudio" }), { key: "Escape" });
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Abrir el asesor del estudio" })).toHaveFocus();
  });

  it("traduz as sugestoes iniciais, preservando o texto escolhido como mensagem autoral", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ conversationId: null, messages: [] }) });
    render(tree(<PlatformHeader />, "es"));
    fireEvent.click(screen.getByRole("button", { name: "Abrir el asesor del estudio" }));
    const suggestion = await screen.findByRole("button", { name: "¿Cómo debería fijar el precio de mi primer curso?" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ conversationId: "local-conversation", reply: "Server reply stays literal." }) });
    fireEvent.click(suggestion);
    await screen.findByText("Server reply stays literal.");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.messages).toEqual([{ role: "user", content: "¿Cómo debería fijar el precio de mi primer curso?" }]);
  });

  it("atualiza o aviso local ao trocar idioma e conserva explicacoes recebidas do servidor", async () => {
    render(tree());
    await openAdvisor();
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    fireEvent.change(screen.getByRole("textbox", { name: "Message to studio advisor" }), { target: { value: "Question" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message to studio advisor" }), { key: "Enter" });
    await screen.findByText("You've sent a lot of messages. Please wait a moment and try again.");
    fireEvent.click(screen.getByRole("button", { name: "Switch to Spanish" }));
    expect(screen.getByText("Has enviado muchos mensajes. Espera un momento y vuelve a intentarlo.")).toBeInTheDocument();

    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ reply: "Server explanation stays literal." }) });
    fireEvent.change(screen.getByRole("textbox", { name: "Mensaje al asesor del estudio" }), { target: { value: "Otra pregunta" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Mensaje al asesor del estudio" }), { key: "Enter" });
    await screen.findByText("Server explanation stays literal.");
  });
});
