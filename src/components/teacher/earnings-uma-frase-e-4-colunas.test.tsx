import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformNav } from "@/components/platform/platform-nav";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";

// A pagina de ganhos pedia tres paragrafos antes do primeiro numero, punha o
// quarto tile sozinho numa linha e — para quem tambem e admin — abria com a
// barra do /ops, que nao tem o item Earnings: a barra escondia a propria tela
// em que a pessoa estava. (O idioma do widget da Stripe tem arquivo proprio:
// earnings-stripe-locale.test.tsx.)

// Referencias ESTAVEIS de proposito: o painel assina perfil e ledger com
// `[user]` na dependencia e guarda o resultado em estado. Devolver objeto novo
// a cada render refaz o efeito, que troca o estado, que renderiza de novo — um
// laco sincrono dentro do act() do React que nem o testTimeout interrompe.
const mocks = vi.hoisted(() => ({
  pathname: "/account/payments",
  user: {
    uid: "teacher-1",
    email: "teacher@example.com",
    displayName: "Teacher",
    emailVerified: true,
    photoURL: null,
    roles: ["admin"] as string[],
  },
  profile: {} as Record<string, unknown>,
  ledger: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (
    _uid: string,
    onData: (profile: Record<string, unknown>) => void,
  ) => {
    onData(mocks.profile);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (
    _uid: string,
    onData: (entries: unknown[]) => void,
  ) => {
    onData(mocks.ledger);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  refreshTeacherStripeAccountStatus: () =>
    Promise.resolve({ chargesEnabled: false, payoutsEnabled: false }),
}));

// O onboarding embutido da Stripe tem inicializacao assincrona propria e nao
// diz respeito nem a frase, nem aos tiles, nem a barra.
vi.mock("@/components/teacher/teacher-connect-onboarding", () => ({
  TeacherConnectOnboarding: () => <div data-testid="stripe-onboarding" />,
}));

afterEach(() => {
  cleanup();
  mocks.pathname = "/account/payments";
  mocks.user.roles = ["admin"];
});

// O layout raiz monta o I18nProvider; e dele que sai o idioma da interface.
function renderInApp(ui: React.ReactNode) {
  return render(<I18nProvider initialLocale="en">{ui}</I18nProvider>);
}

describe("ganhos: uma frase, quatro colunas e a barra certa", () => {
  it("mostra UMA frase e mantem o texto longo escondido ate abrir 'Learn more'", () => {
    renderInApp(<TeacherWalletPanel />);

    // A frase que responde "de quem e esse dinheiro" fica visivel.
    expect(screen.getByText(en.teach.earnings.intro)).toBeVisible();

    // O paragrafo longo existe, mas so para quem pedir por ele.
    const longText = screen.getByText(en.teach.earnings.details);
    expect(longText).not.toBeVisible();

    const disclosure = longText.closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure!.querySelector("summary")?.textContent).toBe(
      en.teach.earnings.learnMore,
    );

    disclosure!.open = true;
    expect(longText).toBeVisible();
  });

  it("poe os quatro tiles numa grade de quatro colunas, sem orfao", () => {
    renderInApp(<TeacherWalletPanel />);

    const labels = [
      "Paid sales",
      "Gross sales",
      "Platform fee est.",
      "Stripe fee est.",
    ];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeVisible();
    }

    const grid = screen.getByText("Paid sales").closest("div.grid");
    expect(grid).not.toBeNull();
    // Quatro tiles em tres colunas deixavam o ultimo sozinho na segunda linha.
    expect(grid!.className).not.toContain("md:grid-cols-3");
    expect(grid!.className).toContain("xl:grid-cols-4");
    expect(grid!.querySelectorAll("article")).toHaveLength(4);
  });

  it("mantem a barra do Teach em /account/payments para quem tambem e admin", () => {
    renderInApp(<PlatformNav />);

    // O proprio item da pagina em que a pessoa esta.
    expect(
      screen.getByRole("link", { name: en.platform.nav.earnings }),
    ).toHaveAttribute("href", "/account/payments");
  });

  it("o dicionario espanhol tem as mesmas chaves novas", () => {
    for (const key of Object.keys(en.teach.earnings)) {
      const value = (es.teach.earnings as Record<string, string>)[key];
      expect(value, `es.teach.earnings.${key}`).toBeTruthy();
      expect(value).not.toBe((en.teach.earnings as Record<string, string>)[key]);
    }
  });
});
