import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHelpChoices, HelpMenu } from "@/components/platform/help-menu";
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
