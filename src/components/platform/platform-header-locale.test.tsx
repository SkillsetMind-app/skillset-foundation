import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformHeader } from "@/components/platform/platform-header";

// O seletor de idioma só existia no site público. Dentro da plataforma
// (/teach, /learn, /account, /ops) não havia nenhuma forma de trocar: a pessoa
// tinha que sair para o site, trocar lá, e voltar. As quatro superfícies passam
// por este mesmo cabeçalho, então é aqui que ele entra — e no extremo direito,
// onde o olho procura.
//
// I18nProvider é o de verdade, não um mock: o rótulo do botão vem do dicionário
// pelo mesmo caminho que a página inteira usa. Os vizinhos são mocks porque
// abrem assinatura de notificações e menu de conta, que não são o assunto.

const mocks = vi.hoisted(() => ({ pathname: "/teach" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "teacher-1",
      email: "teacher@example.com",
      displayName: "Teacher",
      emailVerified: true,
      photoURL: null,
      roles: ["teacher"],
    },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/platform/notification-bell", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));

vi.mock("@/components/site/account-menu", () => ({
  AccountMenu: () => <div data-testid="account" />,
}));

vi.mock("@/components/shared/theme-toggle", () => ({
  ThemeToggle: () => <div data-testid="theme" />,
}));

function renderHeader(pathname: string) {
  mocks.pathname = pathname;
  const { container } = render(
    <I18nProvider initialLocale="en">
      <PlatformHeader />
    </I18nProvider>,
  );
  const actions = container.querySelector(".platform-topbar__actions");
  if (!actions) throw new Error("cluster da direita não existe no cabeçalho");
  return { actions, trigger: screen.getByRole("button", { name: "Language: English" }) };
}

beforeEach(() => {
  mocks.pathname = "/teach";
});

afterEach(() => {
  cleanup();
  document.cookie = "skillset.locale.v1=; max-age=0; path=/";
  document.documentElement.lang = "";
});

describe("idioma na barra do topo da plataforma", () => {
  it.each(["/teach", "/learn", "/ops", "/account"])(
    "%s tem o seletor, e ele é o último item do cluster da direita",
    (pathname) => {
      const { actions, trigger } = renderHeader(pathname);
      expect(actions).toContainElement(trigger);
      // O componente embrulha o gatilho num <div class="relative"> (o menu é
      // absoluto). É esse embrulho que precisa ser o último filho.
      expect(actions.lastElementChild).toBe(trigger.parentElement);
      // Depois do menu da conta: mais para a direita que tudo.
      expect(screen.getByTestId("account").compareDocumentPosition(trigger))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    },
  );

  it("usa a variante discreta: alvo 44px sem moldura permanente ou seta", () => {
    const { trigger } = renderHeader("/teach");
    expect(trigger).toHaveClass("size-11", "locale-switcher-compact", "bg-transparent");
    expect(trigger).not.toHaveClass("border");
    expect(trigger).not.toHaveClass("rounded-full");
    expect(trigger).toHaveTextContent("EN");
    expect(trigger.querySelector("svg")).toBeNull();
  });

  it("troca o idioma sem sair da plataforma, e persiste", () => {
    const { trigger } = renderHeader("/teach");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Español" }));

    expect(screen.getByRole("button", { name: "Idioma: Español" })).toBeInTheDocument();
    expect(document.cookie).toContain("skillset.locale.v1=es");
    expect(document.documentElement.lang).toBe("es");
  });
});
