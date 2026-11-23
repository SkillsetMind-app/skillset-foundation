import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MemberAreaCommunityView } from "@/components/learn/member-area-community";
import { rememberMemberAreaTheme } from "@/lib/data/member-areas";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return { getMemberAreaCommunity: vi.fn(), router: { replace, refresh: () => undefined } };
});

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/learn/member-area-shell", () => ({
  MemberAreaShell: ({ theme = "light", children }: { theme?: string | null; children: ReactNode }) => (
    <div data-testid="shell" data-members-theme={theme ?? undefined}>{children}</div>
  ),
}));
// O feed tem testes próprios; aqui só importa a superfície em volta dele.
vi.mock("@/components/learn/community-feed", () => ({
  CommunityFeed: () => <p>feed</p>,
}));
vi.mock("@/lib/data/member-areas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/member-areas")>()),
  getMemberAreaCommunity: mocks.getMemberAreaCommunity,
}));

function renderView() {
  return render(
    <I18nProvider initialLocale="en">
      <MemberAreaCommunityView areaRef="@eton" />
    </I18nProvider>,
  );
}

// Antes a comunidade da área nunca recebia o tema: a mesma área era escura na
// capa e clara aqui, e o feed ficava nos tons da plataforma.
describe("MemberAreaCommunityView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.getMemberAreaCommunity.mockReset().mockResolvedValue({ courseId: "c-1", title: "Eton Circle", isOwner: false });
  });

  it("abre no tema que a área mostrou, com o feed na superfície temática da sala", async () => {
    rememberMemberAreaTheme("@eton", null, "dark");
    renderView();
    // Já carregando, no tema certo.
    expect(screen.getByRole("status")).toHaveTextContent("Loading the members area...");
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("dark");

    expect(await screen.findByRole("heading", { level: 1, name: "Eton Circle" })).toBeTruthy();
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("dark");
    const surface = screen.getByText("feed").closest(".member-classroom");
    expect(surface).toHaveAttribute("data-members-theme", "dark");
  });

  // O erro era um beco (só a frase): "Try again" chama a mesma leitura, trava
  // enquanto ela corre e o aviso só sai quando a comunidade chega.
  it("a falha oferece Try again, que lê de novo e abre a comunidade com o foco na moldura", async () => {
    mocks.getMemberAreaCommunity.mockRejectedValueOnce(new Error("offline"));
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load this members area. Please try again.");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const busy = screen.getByRole("button", { name: "Trying again..." });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { level: 1, name: "Eton Circle" })).toBeTruthy();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.getMemberAreaCommunity).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }).parentElement);
  });

  it("dois cliques antes de redesenhar abrem uma releitura só", async () => {
    mocks.getMemberAreaCommunity.mockRejectedValueOnce(new Error("offline"));
    renderView();
    const button = await screen.findByRole("button", { name: "Try again" });
    act(() => {
      button.click();
      button.click();
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Eton Circle" })).toBeTruthy();
    expect(mocks.getMemberAreaCommunity).toHaveBeenCalledTimes(2);
  });

  // Com a regra de link do globals.css sem cor fora de camada, a cor pedida
  // chega à tela: o --ma-accent (fundo de botão) dava 2,9:1 num curso escuro.
  it("o link de volta pede o texto de destaque do curso, não o fundo de botão", async () => {
    renderView();
    const back = await screen.findByRole("link", { name: /Back to the area/ });
    expect(back).toHaveClass("text-[var(--ma-accent-ink)]");
    expect(back).not.toHaveClass("text-[var(--ma-accent)]");
  });

  it("sem tema guardado: espera neutra e abre no claro padrão", async () => {
    renderView();
    expect(screen.getByTestId("shell")).not.toHaveAttribute("data-members-theme");
    expect(await screen.findByRole("heading", { level: 1, name: "Eton Circle" })).toBeTruthy();
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("light");
    expect(screen.getByText("feed").closest(".member-classroom")).toHaveAttribute("data-members-theme", "light");
  });
});
