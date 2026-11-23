import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { PageHeadingProvider, PageHeadingText } from "@/components/auth/page-heading";

// A leitura do perfil na entrada da ativacao/escolha de caminho: o que ela chama,
// quantas vezes, e que tela sai de cada perfil. Escrito ANTES do "Try again"
// para provar que a carga normal continua igual depois dele.

const mocks = vi.hoisted(() => ({
  // Identidades estaveis, como as do Next: um literal novo a cada render mudaria
  // as dependencias do efeito e reinscreveria a sessao.
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  listenToAuthState: vi.fn(),
  getUserProfile: vi.fn(),
  updateOnboardingAnswers: vi.fn(),
  completeUserOnboarding: vi.fn(),
  refreshUser: vi.fn(),
  sendSkillsetEmailVerification: vi.fn(),
  refreshCurrentUserEmailVerification: vi.fn(),
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

vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: mocks.listenToAuthState,
  refreshCurrentUserEmailVerification: mocks.refreshCurrentUserEmailVerification,
  sendSkillsetEmailVerification: mocks.sendSkillsetEmailVerification,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  completeUserOnboarding: mocks.completeUserOnboarding,
  updateOnboardingAnswers: mocks.updateOnboardingAnswers,
}));

const authedUser = { uid: "learner-1", displayName: "Patrick", emailVerified: true };
const plan = "/account/billing/upgrade?plan=starter&cycle=yearly";
const learnerProfile = {
  displayName: "Patrick Simon", username: "patrick", bio: "Coach", timezone: "America/Sao_Paulo",
  goals: ["career_growth"], roles: ["student"], onboardingCompleted: true,
  onboardingAnswers: { profileConfirmed: true },
};
const teacherProfile = {
  ...learnerProfile, roles: ["student", "teacher"], teacherTermsAcceptedAt: "2026-10-01",
  onboardingAnswers: { profileConfirmed: true, payoutCountry: "US" },
};

function emit(session: unknown) {
  for (const listener of mocks.listeners) listener(session);
}

function mountOnPage() {
  return render(
    <PageHeadingProvider>
      <h1><PageHeadingText part="title" fallback="page.title" /></h1>
      <OnboardingChoice />
    </PageHeadingProvider>,
  );
}

// Nenhuma gravacao, nenhuma navegacao: so a leitura (e a inscricao na sessao).
function expectOnlyTheRead(reads: number) {
  expect(mocks.listenToAuthState).toHaveBeenCalledTimes(1);
  expect(mocks.getUserProfile).toHaveBeenCalledTimes(reads);
  if (reads) expect(mocks.getUserProfile).toHaveBeenCalledWith("learner-1");
  expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  expect(mocks.completeUserOnboarding).not.toHaveBeenCalled();
  expect(mocks.refreshUser).not.toHaveBeenCalled();
  expect(mocks.sendSkillsetEmailVerification).not.toHaveBeenCalled();
  expect(mocks.refreshCurrentUserEmailVerification).not.toHaveBeenCalled();
  expect(mocks.router.replace).not.toHaveBeenCalled();
}

const pathButton = (key: string) => screen.getByRole("button", { name: new RegExp(`^${key}`) });
const selected = "border-[var(--color-primary)]";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listeners = [];
  mocks.searchParams = new URLSearchParams();
  mocks.listenToAuthState.mockImplementation((callback: (session: unknown) => void) => {
    mocks.listeners.push(callback);
    callback({ status: "loading", user: null });
    return () => {
      mocks.listeners = mocks.listeners.filter((entry) => entry !== callback);
    };
  });
});
afterEach(cleanup);

describe("OnboardingChoice: a carga normal (caracterizacao)", () => {
  it("espera a sessao, le o perfil uma vez e so entao mostra a tela", async () => {
    let resolve!: (profile: unknown) => void;
    mocks.getUserProfile.mockReturnValue(new Promise((done) => { resolve = done; }));
    mountOnPage();
    expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
    expect(mocks.getUserProfile).not.toHaveBeenCalled();

    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expectOnlyTheRead(1);

    await act(async () => resolve(null));
    expect(screen.queryByText("authFlow.loading.title")).toBeNull();
    expect(screen.getByRole("button", { name: "onboarding.continue" })).toBeInTheDocument();
    // A carga normal nao mexe no titulo da pagina nem no foco.
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveAttribute("tabindex");
    expect(document.body).toHaveFocus();

    // Eventos seguintes da sessao (renovacao do token, foco na aba) nao releem.
    await act(async () => {
      emit({ status: "authenticated", user: authedUser });
      emit({ status: "authenticated", user: { ...authedUser, displayName: "Outro" } });
    });
    expectOnlyTheRead(1);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("sem sessao: vai para /login e nao le perfil", async () => {
    mountOnPage();
    await act(async () => emit({ status: "unauthenticated", user: null }));
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/login");
    expectOnlyTheRead(0);
  });

  it("aluno novo: cadastro de 3 passos com o caminho de aluno marcado", async () => {
    mocks.getUserProfile.mockResolvedValue(null);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(pathButton("onboarding.pathLearnTitle")).toHaveClass(selected);
    expect(pathButton("onboarding.pathTeachTitle")).not.toHaveClass(selected);
    expect(screen.queryByLabelText("connectOnboarding.countryLabel")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Patrick");
    expect(screen.getByPlaceholderText("onboarding.usernamePlaceholder")).toHaveValue("");
    expect(screen.getByLabelText("onboarding.timezone")).toHaveValue(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("professor novo (?path=teacher): cadastro de 3 passos com ensino marcado, pais e termos em aberto", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(null);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(pathButton("onboarding.pathTeachTitle")).toHaveClass(selected);
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText("onboarding.verified")).toBeInTheDocument();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("quem terminou como aluno e volta para ensinar: ativacao curta", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(learnerProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("onboarding.streamlinedTitle");
    expect(screen.getByRole("button", { name: "onboarding.activateTeaching" })).toBeDisabled();
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("professor que ja ensina: cadastro com ensino marcado e termos ja aceitos", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(teacherProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(pathButton("onboarding.pathTeachTitle")).toHaveClass(selected);
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("US");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("com plano escolhido (returnTo): a mesma ativacao curta, sem navegar na carga", async () => {
    mocks.searchParams = new URLSearchParams({ path: "teacher", returnTo: plan });
    mocks.getUserProfile.mockResolvedValue(learnerProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("onboarding.streamlinedTitle");
    expect(mocks.router.push).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    });
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith(plan);
  });

  // Cadastro novo de ponta a ponta. A leitura que volta vazia (sem linha, ou a
  // linha recem-criada pelo gatilho do cadastro) conclui como sempre: mesmas
  // chamadas, mesmo conteudo, mesmo destino.
  const freshRow = {
    uid: "learner-1", email: "patrick@example.com", displayName: null, username: null, bio: null,
    timezone: null, roles: ["student"], onboardingCompleted: false,
  };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function fillWizardAndFinish(goalKey: string) {
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.change(screen.getByPlaceholderText("onboarding.usernamePlaceholder"), { target: { value: "patrick" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByText(goalKey));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    });
  }

  it.each([
    ["sem linha", null],
    ["linha recem-criada", freshRow],
  ])("aluno novo (%s) conclui o cadastro e vai para /learn", async (_caso, profile) => {
    mocks.getUserProfile.mockResolvedValue(profile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    await fillWizardAndFinish("onboarding.goalCareerLabel");

    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", roles: ["student"], acceptTeacherTerms: false,
      identity: { displayName: "Patrick", username: "patrick", bio: "", timezone, goals: ["career_growth"] },
    });
    expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/learn");
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sem linha", null],
    ["linha recem-criada", freshRow],
  ])("professor novo (%s) conclui o cadastro e vai para /teach", async (_caso, profile) => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValue(profile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await fillWizardAndFinish("onboarding.goalTeachLabel");

    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", answers: { payoutCountry: "US" },
    });
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", roles: ["teacher"], acceptTeacherTerms: true,
      identity: { displayName: "Patrick", username: "patrick", bio: "", timezone, goals: ["teach_online"] },
    });
    expect(mocks.updateOnboardingAnswers.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.completeUserOnboarding.mock.invocationCallOrder[0]);
    expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teach");
  });

  // Mudanca deliberada, so do estado de leitura falhada: antes o "Continue"
  // tirava o aviso e abria os passos 1 e 2 sem o perfil lido.
  it("leitura que falha: o aviso com \"Try again\", e o Continue nao sai do passo 0", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockRejectedValue(new Error("offline"));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    expectOnlyTheRead(1);
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(screen.getByRole("button", { name: "onboarding.continue" })).toBeEnabled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
    expect(pathButton("onboarding.pathTeachTitle")).toBeInTheDocument();
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
  });
});

describe("OnboardingChoice: \"Try again\" da leitura do perfil", () => {
  const activation = new URLSearchParams("path=teacher");

  // A tela que uma carga limpa deixa, para comparar com a que sai do "Try again".
  async function cleanLoad(profile: unknown) {
    mocks.getUserProfile.mockResolvedValueOnce(profile);
    const { container } = mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    const html = container.children[1].outerHTML;
    const heading = screen.getByRole("heading", { level: 1 }).textContent;
    cleanup();
    vi.clearAllMocks();
    mocks.listeners = [];
    return { html, heading };
  }

  async function failFirstRead() {
    let resolve!: (profile: unknown) => void;
    let reject!: (reason: unknown) => void;
    mocks.getUserProfile
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const view = mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    return { ...view, resolve, reject };
  }

  it("relê só o perfil, uma vez, sem gravar nem reinscrever, e chega à tela de uma carga limpa", async () => {
    mocks.searchParams = activation;
    const clean = await cleanLoad(learnerProfile);

    const { container, resolve } = await failFirstRead();
    const heading = screen.getByRole("heading", { level: 1 });
    const retry = screen.getByRole("button", { name: "appErrors.retry" });
    // Os dois cliques antes de a tela redesenhar (o botao ainda esta la): quem
    // segura o segundo e a trava do proprio LoadErrorAlert, nao o botao sumir.
    act(() => {
      retry.click();
      retry.click();
    });

    // A espera da entrada: nada para ativar, e o foco no titulo, que fica.
    expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(heading).toHaveFocus();
    expectOnlyTheRead(2);

    await act(async () => resolve(learnerProfile));
    expect(container.children[1].outerHTML).toBe(clean.html);
    expect(heading).toHaveTextContent(clean.heading ?? "");
    expect(heading).toHaveFocus();
    expectOnlyTheRead(2);
    expect(mocks.router.push).not.toHaveBeenCalled();

    // A trava de "semear uma vez" segue valendo depois do "Try again".
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expectOnlyTheRead(2);
  });

  it("no cadastro de 3 passos tambem: a mesma tela de uma carga limpa", async () => {
    mocks.searchParams = activation;
    const clean = await cleanLoad(null);
    const { container, resolve } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    await act(async () => resolve(null));
    expect(container.children[1].outerHTML).toBe(clean.html);
    expectOnlyTheRead(2);
  });

  it("depois de um \"Try again\" que da certo, o cadastro conclui e grava uma vez", async () => {
    mocks.searchParams = activation;
    const { resolve } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    await act(async () => resolve(null));

    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.change(screen.getByPlaceholderText("onboarding.usernamePlaceholder"), { target: { value: "patrick" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByText("onboarding.goalTeachLabel"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    });

    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-1", answers: { payoutCountry: "US" },
    });
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      uid: "learner-1", roles: ["teacher"], acceptTeacherTerms: true,
    }));
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teach");
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
  });

  it("na troca de conta o \"Try again\" nao le o id da conta anterior", async () => {
    mocks.searchParams = activation;
    const { reject } = await failFirstRead();
    // A sessao troca de conta: primeiro "loading", depois a outra pessoa.
    await act(async () => emit({ status: "loading", user: null }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    });
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");

    // A conta nova e lida pela propria troca, com o id dela. Se essa leitura
    // falha, o "Try again" rele a conta nova.
    await act(async () => emit({ status: "authenticated", user: { ...authedUser, uid: "learner-2" } }));
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
    await act(async () => reject(new Error("offline")));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    });
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(3);
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
  });

  it("releitura que falha de novo: o aviso volta, com o botao", async () => {
    mocks.searchParams = activation;
    const { reject } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
    expectOnlyTheRead(2);
  });

  it("resposta atrasada do \"Try again\" nao passa por cima de uma leitura mais nova", async () => {
    mocks.searchParams = activation;
    const { resolve, rerender } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));

    // Enquanto o "Try again" espera, o endereco muda de caminho: a sessao e
    // reinscrita (como hoje) e le de novo. Essa leitura e a mais nova.
    mocks.getUserProfile.mockResolvedValueOnce(null);
    mocks.searchParams = new URLSearchParams("path=student");
    rerender(
      <PageHeadingProvider>
        <h1><PageHeadingText part="title" fallback="page.title" /></h1>
        <OnboardingChoice />
      </PageHeadingProvider>,
    );
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(pathButton("onboarding.pathLearnTitle")).toHaveClass(selected);

    await act(async () => resolve(learnerProfile));
    expect(pathButton("onboarding.pathLearnTitle")).toHaveClass(selected);
    expect(screen.queryByRole("button", { name: "onboarding.activateTeaching" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
  });

  it("uma leitura seguinte que da certo tira o aviso de leitura que ficou", async () => {
    mocks.searchParams = activation;
    const { rerender } = await failFirstRead();
    mocks.getUserProfile.mockReset();
    mocks.getUserProfile.mockResolvedValueOnce(null);
    mocks.searchParams = new URLSearchParams("path=student");
    rerender(
      <PageHeadingProvider>
        <h1><PageHeadingText part="title" fallback="page.title" /></h1>
        <OnboardingChoice />
      </PageHeadingProvider>,
    );
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "appErrors.retry" })).toBeNull();
  });

  it("\"Try again\" que falha de novo: o Continue nao avanca e nada e gravado", async () => {
    mocks.searchParams = activation;
    const { reject } = await failFirstRead();
    fireEvent.click(screen.getByRole("button", { name: "appErrors.retry" }));
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");

    fireEvent.click(pathButton("onboarding.pathTeachTitle"));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));

    // Continua no passo 0: sem os campos do passo 1 e sem o "Finish" do 2.
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    expect(screen.queryByRole("button", { name: "onboarding.finishSetup" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
    expectOnlyTheRead(2);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("erro que nao e de leitura nao ganha \"Try again\": o que toma o lugar do aviso", async () => {
    mocks.searchParams = activation;
    mocks.getUserProfile.mockRejectedValueOnce(new Error("offline"));
    mocks.sendSkillsetEmailVerification.mockRejectedValueOnce(new Error("offline"));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: { ...authedUser, emailVerified: false } }));
    fireEvent.click(pathButton("onboarding.pathTeachTitle"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.sendVerification" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.verificationSendError");
    expect(screen.queryByRole("button", { name: "appErrors.retry" })).toBeNull();

    // Sem o perfil lido, o Continue traz de volta o aviso de leitura, com o botao.
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
  });

  it("erro que nao e de leitura nao ganha \"Try again\": ativar que falha", async () => {
    mocks.searchParams = activation;
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile);
    mocks.updateOnboardingAnswers.mockRejectedValueOnce(new Error("offline"));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.activateTeaching" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorFinish");
    expect(screen.queryByRole("button", { name: "appErrors.retry" })).toBeNull();
  });
});

describe("OnboardingChoice: conta trocada em outra aba", () => {
  // Saiu e entrou com outra conta em outra aba, com esta tela aberta: a mesma
  // inscricao recebe "loading" e depois a outra pessoa.
  const otherUser = { uid: "learner-2", displayName: "Bea", emailVerified: true };
  const otherProfile = {
    ...learnerProfile, displayName: "Bea Lima", username: "bea", bio: "Designer",
    timezone: "Europe/London", goals: ["build_community"],
  };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function switchAccount() {
    await act(async () => emit({ status: "loading", user: null }));
    await act(async () => emit({ status: "authenticated", user: otherUser }));
  }

  // So leituras: nenhuma gravacao, nenhuma navegacao, nenhuma inscricao nova.
  function expectNoWrites() {
    expect(mocks.listenToAuthState).toHaveBeenCalledTimes(1);
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
    expect(mocks.completeUserOnboarding).not.toHaveBeenCalled();
    expect(mocks.refreshUser).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
  }

  it("rele o perfil da conta nova uma vez e volta ao passo 0 com os valores dela", async () => {
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile).mockResolvedValueOnce(otherProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.change(screen.getByPlaceholderText("onboarding.bioPlaceholder"), {
      target: { value: "Bio digitada na conta anterior" },
    });

    await switchAccount();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
    expect(screen.getByText("onboarding.stepPath")).toBeInTheDocument();
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    expect(pathButton("onboarding.pathLearnTitle")).toHaveClass(selected);

    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Bea Lima");
    expect(screen.getByPlaceholderText("onboarding.usernamePlaceholder")).toHaveValue("bea");
    expect(screen.getByPlaceholderText("onboarding.bioPlaceholder")).toHaveValue("Designer");
    expect(screen.getByLabelText("onboarding.timezone")).toHaveValue("Europe/London");
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(pathButton("onboarding.goalCommunityLabel")).toHaveClass(selected);
    expect(pathButton("onboarding.goalCareerLabel")).not.toHaveClass(selected);
    expectNoWrites();
  });

  it("da ativacao curta de uma conta para uma conta nova sem perfil: o cadastro limpo", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile).mockResolvedValueOnce(null);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("onboarding.streamlinedTitle");
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));

    await switchAccount();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
    // A tela de um professor novo numa carga limpa: o cadastro de 3 passos.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("page.title");
    expect(screen.queryByRole("button", { name: "onboarding.activateTeaching" })).toBeNull();
    expect(pathButton("onboarding.pathTeachTitle")).toHaveClass(selected);
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Bea");
    expect(screen.getByPlaceholderText("onboarding.usernamePlaceholder")).toHaveValue("");
    expect(screen.getByPlaceholderText("onboarding.bioPlaceholder")).toHaveValue("");
    expect(screen.getByLabelText("onboarding.timezone")).toHaveValue(timezone);
    expectNoWrites();
  });

  it("depois da troca, concluir grava na conta nova so com os valores dela", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.getUserProfile.mockResolvedValueOnce(teacherProfile).mockResolvedValueOnce(null);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    // A conta anterior tinha pais, termos aceitos e respostas salvas.
    expect(screen.getByLabelText("connectOnboarding.countryLabel")).toHaveValue("US");

    await switchAccount();
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "CA" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.change(screen.getByPlaceholderText("onboarding.usernamePlaceholder"), { target: { value: "bea" } });
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    fireEvent.click(screen.getByText("onboarding.goalTeachLabel"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "onboarding.finishSetup" }));
    });

    expect(mocks.updateOnboardingAnswers).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-2", answers: { payoutCountry: "CA" },
    });
    expect(mocks.completeUserOnboarding).toHaveBeenCalledExactlyOnceWith({
      uid: "learner-2", roles: ["teacher"], acceptTeacherTerms: true,
      identity: { displayName: "Bea", username: "bea", bio: "", timezone, goals: ["teach_online"] },
    });
    expect(mocks.refreshUser).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teach");
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
  });

  // Sem a volta do answersLoaded a false na troca, o "perfil lido" da conta
  // anterior deixaria o Continue e o Finish passarem e gravarem por cima das
  // respostas salvas da conta nova.
  it("leitura da conta nova que falha: o Continue nao sai do passo 0 nem grava", async () => {
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile).mockRejectedValueOnce(new Error("offline"));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));

    await switchAccount();
    expect(mocks.getUserProfile).toHaveBeenLastCalledWith("learner-2");
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");

    fireEvent.click(pathButton("onboarding.pathTeachTitle"));
    fireEvent.change(screen.getByLabelText("connectOnboarding.countryLabel"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));

    // Continua no passo 0: sem os campos do passo 1 e sem o "Finish" do 2.
    expect(screen.queryByLabelText("onboarding.publicName")).toBeNull();
    expect(screen.queryByRole("button", { name: "onboarding.finishSetup" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("onboarding.errorProfileLoadRetry");
    expect(screen.getByRole("button", { name: "appErrors.retry" })).toBeEnabled();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expectNoWrites();
  });

  it("a mesma conta de novo, com \"loading\" no meio: nao rele nem apaga o que foi digitado", async () => {
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    const bio = screen.getByPlaceholderText("onboarding.bioPlaceholder");
    fireEvent.change(bio, { target: { value: "Bio digitada agora" } });

    await act(async () => emit({ status: "loading", user: null }));
    await act(async () => {
      emit({ status: "authenticated", user: authedUser });
      emit({ status: "authenticated", user: { ...authedUser, displayName: "Outro" } });
    });
    expectOnlyTheRead(1);
    expect(screen.getByPlaceholderText("onboarding.bioPlaceholder")).toBe(bio);
    expect(bio).toHaveValue("Bio digitada agora");
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Patrick Simon");
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("saida sem entrar com outra conta: vai para /login como hoje; a mesma conta depois nao rele", async () => {
    mocks.getUserProfile.mockResolvedValueOnce(learnerProfile);
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    await act(async () => emit({ status: "unauthenticated", user: null }));
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/login");
    expectOnlyTheRead(1);

    await act(async () => emit({ status: "authenticated", user: authedUser }));
    expectOnlyTheRead(1);
    expect(mocks.router.push).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["antes", true],
    ["depois", false],
  ])("troca com a leitura da conta anterior no ar: a resposta dela, chegando %s da nova, e ignorada", async (_quando, previousFirst) => {
    let resolvePrevious!: (profile: unknown) => void;
    let resolveNext!: (profile: unknown) => void;
    mocks.getUserProfile
      .mockReturnValueOnce(new Promise((done) => { resolvePrevious = done; }))
      .mockReturnValueOnce(new Promise((done) => { resolveNext = done; }));
    mountOnPage();
    await act(async () => emit({ status: "authenticated", user: authedUser }));
    await switchAccount();
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(2);
    expect(mocks.getUserProfile).toHaveBeenNthCalledWith(1, "learner-1");
    expect(mocks.getUserProfile).toHaveBeenNthCalledWith(2, "learner-2");

    if (previousFirst) {
      // A resposta da anterior nao tira a tela da espera.
      await act(async () => resolvePrevious(learnerProfile));
      expect(screen.getByRole("status")).toHaveTextContent("authFlow.loading.title");
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    }
    await act(async () => resolveNext(otherProfile));
    if (!previousFirst) await act(async () => resolvePrevious(learnerProfile));

    fireEvent.click(screen.getByRole("button", { name: "onboarding.continue" }));
    expect(screen.getByLabelText("onboarding.publicName")).toHaveValue("Bea Lima");
    expect(screen.getByPlaceholderText("onboarding.usernamePlaceholder")).toHaveValue("bea");
    expect(screen.getByPlaceholderText("onboarding.bioPlaceholder")).toHaveValue("Designer");
    expectNoWrites();
  });
});
