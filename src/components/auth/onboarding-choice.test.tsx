import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { PageHeadingProvider, PageHeadingText } from "@/components/auth/page-heading";

const mocks = vi.hoisted(() => ({
  // Stable identities: Next's real useRouter/useSearchParams keep the same
  // object across renders. Fresh literals here would change the effect deps on
  // every state update and re-subscribe, hiding the very bug under test.
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  getUserProfile: vi.fn(),
  updateOnboardingAnswers: vi.fn(),
  completeUserOnboarding: vi.fn(),
  refreshUser: vi.fn(),
  listeners: [] as Array<(session: unknown) => void>,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ refreshUser: mocks.refreshUser }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ locale: "en", t: (key: string) => key }),
}));

// Stands in for the real Supabase subscription so a test can fire the auth
// callback as often as GoTrue would.
vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: (callback: (session: unknown) => void) => {
    mocks.listeners.push(callback);
    return () => {
      mocks.listeners = mocks.listeners.filter((entry) => entry !== callback);
    };
  },
  refreshCurrentUserEmailVerification: vi.fn(),
  sendSkillsetEmailVerification: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  completeUserOnboarding: mocks.completeUserOnboarding,
  updateOnboardingAnswers: mocks.updateOnboardingAnswers,
}));

function emitAuthenticated() {
  for (const listener of mocks.listeners) {
    listener({
      status: "authenticated",
      user: { uid: "learner-1", displayName: "Patrick", emailVerified: true },
    });
  }
}

afterEach(cleanup);

describe("OnboardingChoice bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners = [];
    mocks.searchParams = new URLSearchParams();
    mocks.getUserProfile.mockResolvedValue(null);
  });

  // Supabase re-fires onAuthStateChange on TOKEN_REFRESHED / USER_UPDATED —
  // the hourly refresh, a tab regaining focus, the email-verification round
  // trip this screen itself triggers. The old code re-read the profile on
  // every one of those and pushed the stored values back into displayName,
  // username, bio, timezone and goals, silently wiping a half-filled form
  // under someone who was still typing in it.
  it("seeds the profile once, not on every later auth event", async () => {
    render(<OnboardingChoice />);

    await act(async () => {
      emitAuthenticated();
    });

    // Control: the first event must still seed, or the screen never loads.
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitAuthenticated();
      emitAuthenticated();
    });

    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });
});

describe("H3: pais na ativacao do professor", () => {
  const previousAnswers = { profileConfirmed: true, primaryGoal: ["Business"], sourceOfDiscovery: "Podcast" };
  const profile = {
    displayName: "Patrick", username: "patrick", bio: "", timezone: "America/Sao_Paulo",
    goals: ["teach_online"], roles: ["student"], teacherTermsAcceptedAt: "2026-10-01",
    onboardingCompleted: true, onboardingPath: "teacher", onboardingAnswers: previousAnswers,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners = [];
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(profile);
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.completeUserOnboarding.mockResolvedValue(undefined);
  });

  async function mount() {
    render(<OnboardingChoice />);
    await act(async () => emitAuthenticated());
  }

  it.each(["teacher", "student"])("quem terminou como %s ativa ensino sem repetir o questionario", async (path) => {
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingPath: path });
    await mount();
    expect(screen.getByRole("button", { name: "onboarding.activateTeaching" })).toBeInTheDocument();
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    // E-mail ja verificado: o cartao de verificacao nao aparece de novo, e o
    // texto da caixa nao pede para verificar o que ja esta verificado.
    expect(screen.queryByText("onboarding.emailVerificationTitle")).toBeNull();
    expect(screen.getByText("onboarding.streamlinedDescVerified")).toBeInTheDocument();
    expect(screen.queryByText("onboarding.streamlinedDesc")).toBeNull();
    const finish = screen.getByRole("button", { name: "onboarding.activateTeaching" });
    expect(finish).toBeDisabled();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    fireEvent.click(finish);
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", answers: { ...previousAnswers, payoutCountry: "CA" },
    });
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", roles: ["teacher"], acceptTeacherTerms: true,
      identity: { displayName: "Patrick", username: "patrick", bio: "", timezone: "America/Sao_Paulo", goals: ["teach_online"] },
    });
    expect(mocks.updateOnboardingAnswers.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.completeUserOnboarding.mock.invocationCallOrder[0]);
  });

  // A-20 / O-06: o titulo segue a tela que o perfil decide, nao o endereco.
  // Com ?path=teacher tambem abre o cadastro de 3 passos (quem nao terminou o
  // cadastro, convite novo, perfil que nao carregou), e ali o titulo da pagina
  // continua o padrao.
  function mountOnPage() {
    render(
      <PageHeadingProvider>
        <h1><PageHeadingText part="title" fallback="page.title" /></h1>
        <p><PageHeadingText part="description" fallback="page.description" /></p>
        <OnboardingChoice />
      </PageHeadingProvider>,
    );
    return act(async () => emitAuthenticated());
  }

  it("a ativacao curta troca o titulo e a descricao da pagina", async () => {
    await mountOnPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("onboarding.streamlinedTitle");
    expect(screen.getAllByText("onboarding.streamlinedDescVerified")).toHaveLength(1);
    expect(screen.queryByText("page.description")).toBeNull();
  });

  it.each([
    ["quem nao terminou o cadastro", () => mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingCompleted: false })],
    ["perfil que nao carregou", () => mocks.getUserProfile.mockRejectedValueOnce(new Error("offline"))],
  ])("%s ve o cadastro de 3 passos sob o titulo padrao", async (_caso, arrange) => {
    arrange();
    await mountOnPage();

    expect(screen.getByRole("button", { name: "onboarding.continue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(screen.getByText("page.description")).toBeInTheDocument();
    expect(screen.queryByText("onboarding.streamlinedTitle")).toBeNull();
  });

  // A-20: "Activate teaching" ficava cinza sem dizer o que faltava. A trava e
  // a mesma; o motivo agora aparece e descreve o botao.
  it("diz por que 'Activate teaching' esta apagado, sem mudar a trava", async () => {
    await mount();
    const finish = screen.getByRole("button", { name: "onboarding.activateTeaching" });
    expect(finish).toBeDisabled();
    const reason = screen.getByText("onboarding.payoutCountryRequired");
    expect(finish).toHaveAttribute("aria-describedby", reason.id);

    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    expect(finish).toBeEnabled();
    expect(finish).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("onboarding.payoutCountryRequired")).toBeNull();
  });

  // O plano escolhido em /pricing chega aqui como returnTo. Antes o fim era
  // sempre /teach e o professor tinha de achar os planos e escolher de novo.
  async function ativar(query: string) {
    mocks.searchParams = new URLSearchParams(query);
    await mount();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledTimes(1));
    expect(mocks.completeUserOnboarding).toHaveBeenCalledTimes(1);
    return mocks.router.push.mock.calls[0][0];
  }
  const cartao = "/account/billing/upgrade?plan=starter&cycle=yearly";

  it("com plano escolhido em /pricing, o fim abre a tela de cartao desse plano", async () => {
    expect(await ativar(new URLSearchParams({ path: "teacher", returnTo: cartao }).toString())).toBe(cartao);
  });

  it("sem plano escolhido, o fim continua em /teach", async () => {
    expect(await ativar("path=teacher")).toBe("/teach");
  });

  // A ativacao curta so pergunta o que falta: o pais ja respondido na
  // entrevista nao volta, e segue gravado igual na ativacao.
  it("pais ja respondido nao aparece de novo e continua gravado", async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile, onboardingAnswers: { ...previousAnswers, payoutCountry: "US" },
    });
    await mount();
    expect(screen.queryByLabelText("connectOnboarding.countryLabel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", answers: { ...previousAnswers, payoutCountry: "US" },
    });
  });

  it("o campo do pais nao some no meio da escolha", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("CA");
  });

  it.each([
    "/account/billing/upgrade?plan=plus&cycle=monthly",
    "/account/billing/upgrade?plan=starter&cycle=weekly",
    "/account/billing/upgrade?plan=starter",
    "/courses/focus",
    "https://evil.example/account/billing/upgrade?plan=pro&cycle=yearly",
  ])("destino que nao e um plano publico e ignorado: %s", async (returnTo) => {
    expect(await ativar(new URLSearchParams({ path: "teacher", returnTo }).toString())).toBe("/teach");
  });

  it("quem pula a ativacao nao abre o cartao", async () => {
    mocks.searchParams = new URLSearchParams({ path: "teacher", returnTo: cartao });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.skipForNow" }));
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/learn");
    expect(mocks.completeUserOnboarding).not.toHaveBeenCalled();
  });

  it("retoma outro pais com aviso, sem alterar a resposta num evento de autenticacao", async () => {
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingAnswers: { ...previousAnswers, payoutCountry: "other" } });
    await mount();
    const country = screen.getByLabelText("connectOnboarding.countryLabel");
    expect(country).toHaveValue("other");
    expect(screen.getByRole("status")).toHaveTextContent("onboarding.payoutCountryUnavailable");
    fireEvent.change(country, { target: { value: "GB" } });
    await act(async () => emitAuthenticated());
    expect(country).toHaveValue("GB");
    fireEvent.change(country, { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await waitFor(() => expect(mocks.updateOnboardingAnswers).toHaveBeenCalledWith({
      uid: "learner-1", answers: { ...previousAnswers, payoutCountry: "other" },
    }));
  });

  it("nao ativa nem navega quando salvar o pais falha", async () => {
    mocks.updateOnboardingAnswers.mockRejectedValueOnce(new Error("offline"));
    await mount();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await screen.findByText("onboarding.errorFinish");
    expect(mocks.completeUserOnboarding).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
  });

  it("leitura do perfil falhou: conclui a ativacao sem gravar o pais por cima das respostas", async () => {
    mocks.getUserProfile.mockRejectedValueOnce(new Error("offline"));
    await mount();
    expect(screen.getByText("onboarding.errorProfileLoad")).toBeInTheDocument();
    fireEvent.click(screen.getByText("onboarding.pathTeachTitle"));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.change(screen.getByPlaceholderText("onboarding.usernamePlaceholder"), { target: { value: "patrick" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByText("onboarding.goalTeachLabel"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach"));
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      uid: "learner-1", roles: ["teacher"], acceptTeacherTerms: true,
    }));
  });

  it.each(["teacher", "student"])("fluxo direto %s mostra e grava pais somente para professor", async (path) => {
    mocks.searchParams = new URLSearchParams(`path=${path}`);
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingCompleted: false });
    await mount();
    if (path === "teacher") {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
      expect(screen.getByText("onboarding.payoutCountryRequired")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "other" } });
    } else {
      expect(screen.queryByLabelText("connectOnboarding.countryLabel")).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.timezone")).toHaveValue("America/Sao_Paulo");
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    await waitFor(() => expect(mocks.completeUserOnboarding).toHaveBeenCalledTimes(1));
    if (path === "teacher") {
      expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
        uid: "learner-1", answers: { ...previousAnswers, payoutCountry: "other" },
      });
    } else {
      expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
    }
  });

  // O cadastro completo (3 passos) termina no mesmo lugar que a ativacao curta;
  // o aluno nao abre cartao de plano mesmo que o endereco traga um.
  it.each([
    ["teacher", cartao],
    ["student", "/learn"],
  ])("fluxo direto %s com plano escolhido termina em %s", async (path, destino) => {
    mocks.searchParams = new URLSearchParams({ path, returnTo: cartao });
    mocks.getUserProfile.mockResolvedValue({ ...profile, onboardingCompleted: false });
    await mount();
    if (path === "teacher") {
      fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith(destino));
  });
});
