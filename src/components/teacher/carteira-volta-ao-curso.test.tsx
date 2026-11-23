import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";

// O professor saia do Publish para "Set up how you get paid" (antes "Finish payout onboarding"), passava pelas
// telas da Stripe e caia numa linha de status, sem caminho de volta para o
// curso. O construtor manda ?returnTo=; com pagamentos prontos, vira botao.

// Referencias ESTAVEIS: o painel assina perfil e ledger com `[user]`.
const mocks = vi.hoisted(() => ({
  user: { uid: "teacher-1" },
  profile: {} as Record<string, unknown>,
  ledger: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: Record<string, unknown>) => void) => {
    onData(mocks.profile);
    return () => undefined;
  },
}));
vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (_uid: string, onData: (entries: unknown[]) => void) => {
    onData(mocks.ledger);
    return () => undefined;
  },
}));
vi.mock("@/lib/data/creator-verification", () => ({
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));
vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  refreshTeacherStripeAccountStatus: () => Promise.resolve({ chargesEnabled: true, payoutsEnabled: true }),
}));
vi.mock("@/components/teacher/teacher-connect-onboarding", () => ({
  TeacherConnectOnboarding: () => <div data-testid="stripe-onboarding" />,
}));
vi.mock("@/components/teacher/stripe-dashboard-button", () => ({
  StripeDashboardButton: () => null,
}));

const builderPublish = "/teach/builder?courseId=course-1&tab=review";
const ready = { stripeConnectedAccountId: "acct_1", stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true };

function openAt(search: string) {
  window.history.replaceState(null, "", `/account/payments${search}`);
  return render(
    <I18nProvider initialLocale="en">
      <TeacherWalletPanel />
    </I18nProvider>,
  );
}

const back = () => screen.queryByRole("link", { name: "Back to your course to publish" });

describe("carteira: volta para o curso depois dos pagamentos", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    mocks.profile = {};
  });

  it("pagamentos prontos e returnTo do construtor: botao de volta para a aba Publish", () => {
    mocks.profile = ready;
    openAt(`?returnTo=${encodeURIComponent(builderPublish)}`);
    expect(back()).toHaveAttribute("href", builderPublish);
  });

  it("pagamentos ainda pendentes: sem botao, a pessoa termina o cadastro primeiro", () => {
    mocks.profile = { stripeConnectedAccountId: "acct_1" };
    openAt(`?returnTo=${encodeURIComponent(builderPublish)}`);
    expect(back()).toBeNull();
  });

  it.each([
    "https://evil.example/teach/builder?x=1",
    "//evil.example/teach/builder?x=1",
    "/\\evil.example",
    "/account/billing",
    "/teach/builderx?courseId=1",
  ])("destino que nao e o construtor (%s) nao vira botao", (target) => {
    mocks.profile = ready;
    openAt(`?returnTo=${encodeURIComponent(target)}`);
    expect(back()).toBeNull();
  });

  it("sem returnTo, nada muda", () => {
    mocks.profile = ready;
    openAt("");
    expect(back()).toBeNull();
  });
});
