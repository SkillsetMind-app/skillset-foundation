import { render, screen } from "@testing-library/react";
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

  it("sem tema guardado: espera neutra e abre no claro padrão", async () => {
    renderView();
    expect(screen.getByTestId("shell")).not.toHaveAttribute("data-members-theme");
    expect(await screen.findByRole("heading", { level: 1, name: "Eton Circle" })).toBeTruthy();
    expect(screen.getByTestId("shell").getAttribute("data-members-theme")).toBe("light");
    expect(screen.getByText("feed").closest(".member-classroom")).toHaveAttribute("data-members-theme", "light");
  });
});
