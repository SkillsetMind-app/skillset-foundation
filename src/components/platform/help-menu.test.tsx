import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHelpChoices, HelpMenu } from "@/components/platform/help-menu";
import { MobileSidebarDrawer } from "@/components/platform/mobile-sidebar-drawer";
import { PlatformNav } from "@/components/platform/platform-nav";
import { AdvisorSidebar } from "@/components/teacher/advisor-sidebar";

// O botao Ajuda: o mesmo em todo lugar, tres escolhas por lado.

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "t@example.com", displayName: "T", emailVerified: true, photoURL: null, roles: ["teacher"] },
  }),
}));
vi.mock("@/lib/advisor/config", () => ({ isAdvisorEnabled: true }));
vi.mock("@/lib/data/creator-verification", () => ({ fetchCreatorActivationBlocked: vi.fn().mockResolvedValue(false) }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ conversationId: null, messages: [] }) }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("as escolhas por lado", () => {
  it("aluno fora de um curso: comunidades, mensagens e a central de ajuda antes de uma pessoa", () => {
    expect(getHelpChoices("student", null, false)).toEqual([
      expect.objectContaining({ id: "lesson", href: "/learn/community" }),
      expect.objectContaining({ id: "private", href: "/learn/messages" }),
      expect.objectContaining({ id: "account", href: "/help", personHref: "/support" }),
    ]);
  });

  it("aluno dentro de um curso: a duvida vai para a comunidade dele, ou para o professor se ela estiver desligada", () => {
    const course = { href: "/learn/courses/c-1", communityEnabled: true };
    expect(getHelpChoices("student", course, false)[0]).toMatchObject({
      href: "/learn/courses/c-1/community",
      hintKey: "helpMenu.student.lessonCommunity",
    });
    expect(getHelpChoices("student", { ...course, communityEnabled: false }, false)[0]).toMatchObject({
      href: "/learn/courses/c-1/messages",
      hintKey: "helpMenu.student.lessonMessage",
    });
    expect(getHelpChoices("student", course, false)[1].href).toBe("/learn/courses/c-1/messages");
  });

  it("professor: Advisor (ou a central, sem Advisor), Caixa de entrada e suporte", () => {
    expect(getHelpChoices("teacher", null, true)).toEqual([
      expect.objectContaining({ id: "howTo", opensAdvisor: true }),
      expect.objectContaining({ id: "students", href: "/teach/messages" }),
      expect.objectContaining({ id: "account", href: "/support" }),
    ]);
    const withoutAdvisor = getHelpChoices("teacher", null, false)[0];
    expect(withoutAdvisor.href).toBe("/help");
    expect(withoutAdvisor.opensAdvisor).toBeFalsy();
  });
});

describe("teclado e leitor de tela", () => {
  it("abre um dialogo com titulo, foca a primeira escolha e fecha no Escape devolvendo o foco", () => {
    render(<HelpMenu variant="bar" side="student" />);

    const trigger = screen.getByRole("button", { name: "Help" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    const first = within(dialog).getByRole("link", { name: /Question about a lesson/ });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("o topo fecha com clique fora; escolher fecha e avisa quem abriu", () => {
    const onNavigate = vi.fn();
    render(<HelpMenu variant="bar" side="student" onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("link", { name: "Talk to a person" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("setas andam entre as escolhas, dando a volta; do botao, a seta leva para dentro", () => {
    render(<HelpMenu variant="bar" side="student" />);
    const trigger = screen.getByRole("button", { name: "Help" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    const lesson = within(dialog).getByRole("link", { name: /Question about a lesson/ });
    const privateMatter = within(dialog).getByRole("link", { name: /Private matter with the teacher/ });
    const person = within(dialog).getByRole("link", { name: "Talk to a person" });
    expect(lesson).toHaveFocus();

    fireEvent.keyDown(lesson, { key: "ArrowDown" });
    expect(privateMatter).toHaveFocus();
    fireEvent.keyDown(privateMatter, { key: "ArrowUp" });
    expect(lesson).toHaveFocus();
    fireEvent.keyDown(lesson, { key: "ArrowUp" });
    expect(person).toHaveFocus();
    fireEvent.keyDown(person, { key: "ArrowDown" });
    expect(lesson).toHaveFocus();

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(lesson).toHaveFocus();
  });

  it("sair do painel do topo com Tab fecha; o foco segue para onde a pessoa foi", () => {
    render(
      <>
        <HelpMenu variant="bar" side="student" />
        <a href="/next">Next thing</a>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const person = screen.getByRole("link", { name: "Talk to a person" });
    const next = screen.getByRole("link", { name: "Next thing" });

    // Dentro do painel, nao fecha.
    fireEvent.blur(person, { relatedTarget: screen.getByRole("link", { name: /Question about a lesson/ }) });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.blur(person, { relatedTarget: next });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Help" })).toHaveAttribute("aria-expanded", "false");
  });

  // No tablet a barra e um trilho de icones: Ajuda abre a gaveta ja na Ajuda.
  // A gaveta se foca ao abrir; o foco tem de terminar DENTRO das escolhas.
  it("aberta pelo trilho recolhido, na gaveta, o foco vai para a primeira escolha", async () => {
    render(<MobileSidebarDrawer open initialSection="help" onOpen={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    const first = within(dialog).getAllByRole("link")[0];
    await waitFor(() => expect(first).toHaveFocus());
  });

  it("na barra lateral recolhida que se abre ao clicar, o foco vai para a primeira escolha", () => {
    function Sidebar() {
      const [collapsed, setCollapsed] = useState(true);
      return <PlatformNav collapsed={collapsed} onRequestExpand={() => setCollapsed(false)} />;
    }
    render(<Sidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    expect(within(dialog).getAllByRole("link")[0]).toHaveFocus();
  });

  it("o aluno ve 'falar com uma pessoa' depois do assistente", () => {
    render(<HelpMenu variant="bar" side="student" />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    const dialog = screen.getByRole("dialog");
    const assistant = within(dialog).getByRole("link", { name: /Login, payment, refund or something broken/ });
    const person = within(dialog).getByRole("link", { name: "Talk to a person" });
    expect(assistant).toHaveAttribute("href", "/help");
    expect(person).toHaveAttribute("href", "/support");
    expect(assistant.compareDocumentPosition(person)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("dentro do estudio, 'Como faco X' abre o Advisor", () => {
  it("sem sair da pagina", async () => {
    render(
      <AdvisorSidebar>
        <HelpMenu variant="bar" side="teacher" />
      </AdvisorSidebar>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("button", { name: /How do I do something on the platform/ }));

    expect(await screen.findByRole("dialog", { name: "Studio advisor" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "What do you need help with?" })).toBeNull();
  });

  it("fora do estudio, sem Advisor, a mesma escolha leva para a central de ajuda", () => {
    render(<HelpMenu variant="bar" side="teacher" />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    expect(screen.getByRole("link", { name: /How do I do something on the platform/ })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("link", { name: /My students/ })).toHaveAttribute("href", "/teach/messages");
    expect(screen.getByRole("link", { name: /Account, payment or error/ })).toHaveAttribute("href", "/support");
  });
});
