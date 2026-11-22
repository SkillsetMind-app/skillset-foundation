import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingWizard } from "@/components/auth/onboarding-wizard";
import type { SkillsetUser } from "@/domain/auth";

/**
 * O primeiro passo depois de confirmar o e-mail e se apresentar: nome
 * (pre-preenchido do cadastro) e telefone — que nunca era pedido em lugar
 * nenhum. So depois vem "como voce vai usar a SkillsetMind".
 */

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  // Objeto estavel: um novo por render reinscreve efeitos e entra em laco.
  auth: {
    status: "authenticated",
    user: { uid: "u-1", email: "patrick@example.com", displayName: "Patrick Simon", roles: ["student"] } as
      Pick<SkillsetUser, "uid" | "email" | "displayName" | "roles"> | null,
  },
  profile: {
    displayName: "Patrick Simon",
    phoneNumber: null as string | null,
    onboardingAnswers: {} as Record<string, unknown>,
  },
  getUserProfile: vi.fn(),
  updateOnboardingAnswers: vi.fn(),
  updateUserIdentity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  updateOnboardingAnswers: mocks.updateOnboardingAnswers,
  updateUserIdentity: mocks.updateUserIdentity,
}));

beforeEach(() => {
  mocks.auth = {
    status: "authenticated",
    user: { uid: "u-1", email: "patrick@example.com", displayName: "Patrick Simon", roles: ["student"] },
  };
});

describe("boas-vindas: o passo de perfil vem primeiro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
    mocks.profile = { displayName: "Patrick Simon", phoneNumber: null, onboardingAnswers: {} };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("professor: abre pedindo nome (ja preenchido) e telefone; sem telefone nao passa", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    render(<OnboardingWizard />);

    expect(await screen.findByText("First, tell us who you are.")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveValue("Patrick Simon");
    expect(screen.getByLabelText("Phone")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Enter a phone number/)).toBeInTheDocument();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(screen.queryByText("How will you use SkillsetMind first?")).toBeNull();
  });

  it("aluno: o telefone e opcional — vazio passa, e nada e inventado no perfil", async () => {
    mocks.searchParams = new URLSearchParams("path=student");
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    expect(screen.getByLabelText("Phone (optional)")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(mocks.updateUserIdentity).toHaveBeenCalledWith("u-1", {
        displayName: "Patrick Simon",
        phoneNumber: null,
      }),
    );
    // O papel ja veio do cadastro (?path=): nao pergunta de novo.
    expect(await screen.findByText("What do you want to learn first?")).toBeInTheDocument();
    expect(screen.queryByText("How will you use SkillsetMind first?")).toBeNull();
  });

  it("aluno que digita um telefone torto nao passa com ele", async () => {
    mocks.searchParams = new URLSearchParams("path=student");
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    fireEvent.change(screen.getByLabelText("Phone (optional)"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Enter a phone number/)).toBeInTheDocument();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
  });

  it("com nome e telefone: grava no perfil, marca o passo e segue para o proximo", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+55 (16) 99999-1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(mocks.updateUserIdentity).toHaveBeenCalledWith("u-1", {
        displayName: "Patrick Simon",
        phoneNumber: "+55 (16) 99999-1234",
      }),
    );
    await waitFor(() =>
      expect(mocks.updateOnboardingAnswers).toHaveBeenCalledWith(
        expect.objectContaining({ uid: "u-1", answers: expect.objectContaining({ profileConfirmed: true }) }),
      ),
    );
    expect(await screen.findByText("What best describes your work?")).toBeInTheDocument();
    expect(screen.queryByText("How will you use SkillsetMind first?")).toBeNull();
  });

  it("quem chegou com o papel errado no link volta um passo e troca", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.profile = {
      displayName: "Patrick Simon",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: { profileConfirmed: true, path: "teacher" },
    };
    render(<OnboardingWizard />);
    await screen.findByText("What best describes your work?");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("How will you use SkillsetMind first?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /I want to learn/ }));

    await waitFor(() =>
      expect(mocks.updateOnboardingAnswers).toHaveBeenCalledWith(
        expect.objectContaining({ path: "student" }),
      ),
    );
    expect(await screen.findByText("What do you want to learn first?")).toBeInTheDocument();
  });

  it("sem papel definido (nem no link, nem salvo), ainda pergunta o caminho", async () => {
    render(<OnboardingWizard />);
    await screen.findByText("First, tell us who you are.");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("How will you use SkillsetMind first?")).toBeInTheDocument();
  });

  it("quem ja se apresentou nao ve o passo de novo ao voltar", async () => {
    mocks.profile = {
      displayName: "Patrick Simon",
      phoneNumber: "+55 16 99999-1234",
      onboardingAnswers: { profileConfirmed: true },
    };
    render(<OnboardingWizard />);

    expect(await screen.findByText("How will you use SkillsetMind first?")).toBeInTheDocument();
    expect(screen.queryByText("First, tell us who you are.")).toBeNull();
  });
});

// A outra metade do bug do "voltar para o curso": mesmo carregando o endereco
// ate aqui, o fim do onboarding sempre despejava a pessoa em /learn. O curso
// que ela ia comprar sumia no ultimo passo.
describe("boas-vindas: o fim leva de volta para onde a pessoa estava", () => {
  const respostasDeAluno = {
    profileConfirmed: true,
    path: "student",
    primaryGoal: ["Business"],
    sourceOfDiscovery: "Instagram",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
    mocks.profile = {
      displayName: "Patrick Simon",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: respostasDeAluno,
    };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  // O ultimo passo do aluno; daqui o "Continue" encerra o onboarding.
  async function terminar() {
    render(<OnboardingWizard />);
    expect(
      await screen.findByText("Where did you hear about SkillsetMind?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  }

  it("volta para o curso quando a pessoa veio de um", async () => {
    mocks.searchParams = new URLSearchParams("returnTo=/courses/focus");

    await terminar();

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/courses/focus"),
      { timeout: 4000 },
    );
  });

  it("sem destino, termina onde sempre terminou", async () => {
    await terminar();

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn"),
      { timeout: 4000 },
    );
  });

  it("um nome com $& no 'You're all set' aparece literal, sem virar '{name}'", async () => {
    // Num replace sem callback, "$&" vira o trecho casado ("{name}") e "$'" o
    // resto da frase. O nome vem do cadastro: e texto da pessoa, nao nosso.
    mocks.auth = {
      status: "authenticated",
      user: { uid: "u-1", email: "patrick@example.com", displayName: "Mc$&Donald Simon", roles: ["student"] },
    };

    await terminar();

    expect(
      await screen.findByRole("heading", { level: 1, name: /all set/ }),
    ).toHaveTextContent("You're all set, Mc$&Donald.");
    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn"),
      { timeout: 4000 },
    );
  });

  // O-18/F-10: o "You're all set" segurava a pessoa 1,8s sem nenhum botao.
  // Agora o "Continue" chega focado e vai na hora para o MESMO destino, e a
  // pausa automatica (1500ms) nao navega uma segunda vez depois do clique.
  it("'Continue' no fim chega focado e vai na hora para o mesmo destino, uma vez so", async () => {
    mocks.searchParams = new URLSearchParams("returnTo=/courses/focus");

    await terminar();

    await screen.findByRole("heading", { level: 1, name: /all set/ });
    const continuar = screen.getByRole("button", { name: "Continue" });
    expect(continuar).toHaveFocus();
    // O leitor de tela ouve o titulo e a frase junto com o botao focado.
    expect(continuar).toHaveAccessibleDescription(/You're all set, Patrick\..*Taking you there now\./);
    expect(mocks.router.replace).not.toHaveBeenCalled();
    fireEvent.click(continuar);
    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/courses/focus");

    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
  });

  it("sem clique, segue sozinho depois de 1500ms, nao antes", async () => {
    await terminar();

    await screen.findByRole("heading", { level: 1, name: /all set/ });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(mocks.router.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/learn"), { timeout: 2000 });
  });

  // Voltar do navegador durante a pausa desmonta a tela: a pausa que ainda
  // corre nao pode puxar a pessoa de volta para frente.
  it("desmontada antes do fim da pausa, nao navega", async () => {
    await terminar();
    await screen.findByRole("heading", { level: 1, name: /all set/ });

    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("descarta destino de outro dominio", async () => {
    mocks.searchParams = new URLSearchParams("returnTo=https://outro.com/pego");

    await terminar();

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn"),
      { timeout: 4000 },
    );
  });

  // O professor e a excecao de proposito: /onboarding?path=teacher e um passo
  // obrigatorio da conta, nao um destino que da para trocar por um link.
  it("professor ainda vai para o cadastro de professor, com destino ou sem", async () => {
    mocks.searchParams = new URLSearchParams("path=teacher&returnTo=/courses/focus");
    mocks.profile = {
      displayName: "Patrick Simon",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: {
        profileConfirmed: true,
        path: "teacher",
        profession: "Coach",
        primaryGoal: ["Business"],
        alreadySold: "no",
        payoutCountry: "US",
        audienceSize: "100,000+ followers",
        instagramHandle: "patrick",
      },
    };

    render(<OnboardingWizard />);
    expect(await screen.findByText(/Instagram handle/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(
      () =>
        expect(mocks.router.replace).toHaveBeenCalledWith("/onboarding?path=teacher"),
      { timeout: 4000 },
    );
  });

  // A unica coisa que segue com o professor para /onboarding e o plano que ele
  // escolheu em /pricing: la, o ultimo botao abre o cartao desse plano.
  const cartao = "/account/billing/upgrade?plan=pro&cycle=monthly";

  it("professor que escolheu um plano em /pricing leva o plano para o cadastro de professor", async () => {
    mocks.searchParams = new URLSearchParams({ path: "teacher", returnTo: cartao });
    mocks.profile = {
      displayName: "Patrick Simon",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: {
        profileConfirmed: true,
        path: "teacher",
        profession: "Coach",
        primaryGoal: ["Business"],
        alreadySold: "no",
        payoutCountry: "US",
        audienceSize: "100,000+ followers",
        instagramHandle: "patrick",
      },
    };

    render(<OnboardingWizard />);
    expect(await screen.findByText(/Instagram handle/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(
      () =>
        expect(mocks.router.replace).toHaveBeenCalledWith(
          "/onboarding?path=teacher&returnTo=%2Faccount%2Fbilling%2Fupgrade%3Fplan%3Dpro%26cycle%3Dmonthly",
        ),
      { timeout: 4000 },
    );
  });

  // Plano e de quem ensina: quem terminou como aluno nao cai na tela de cartao.
  it("aluno com um plano no endereco termina em /learn, nao no cartao", async () => {
    mocks.searchParams = new URLSearchParams({ returnTo: cartao });

    await terminar();

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn"),
      { timeout: 4000 },
    );
  });
});

// So o caminho do aluno perguntava "onde conheceu a SkillsetMind"; do professor
// — quem mais importa saber — nunca. Mesma pergunta, opcional, mesmo lugar.
describe("boas-vindas: o professor tambem diz onde nos conheceu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.profile = {
      displayName: "Patrick Simon",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: {
        profileConfirmed: true,
        path: "teacher",
        profession: "Coach",
        primaryGoal: ["Business"],
        alreadySold: "no",
        payoutCountry: "US",
      },
    };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("asks it as an optional step and saves it with the other answers", async () => {
    render(<OnboardingWizard />);
    await screen.findByText(/Instagram handle/);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByText("Where did you hear about SkillsetMind?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Podcast" }));

    await waitFor(() =>
      expect(mocks.updateOnboardingAnswers).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: "u-1",
          path: "teacher",
          answers: expect.objectContaining({ path: "teacher", sourceOfDiscovery: "Podcast" }),
        }),
      ),
    );
  });
});

// O-07/O-08/O-21: o total da entrevista aparece e e anunciado; cada pergunta
// remonta (a entrada animada roda em todas); Enter num botao e do botao e Esc
// nao volta uma pergunta.
describe("boas-vindas: progresso, troca de pergunta e teclado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.profile = {
      displayName: "Patrick Simon",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: { profileConfirmed: true, path: "teacher" },
    };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("mostra 'Question 2 of 8' e expoe a barra de progresso", async () => {
    render(<OnboardingWizard />);
    await screen.findByText("What best describes your work?");

    expect(screen.getByText("Question 2 of 8")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Question 2 of 8" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
  });

  it("cada pergunta nova e um elemento novo (a entrada roda de novo)", async () => {
    const view = render(<OnboardingWizard />);
    await screen.findByText("What best describes your work?");
    const first = view.container.querySelector(".welcome-question");

    fireEvent.click(screen.getByRole("button", { name: "Coach" }));
    await screen.findByText("What kind of program will you publish?");

    expect(view.container.querySelector(".welcome-question")).not.toBe(first);
    expect(screen.getByText("Question 3 of 8")).toBeInTheDocument();
  });

  it("Enter numa opcao nao tenta seguir e Esc nao volta", async () => {
    render(<OnboardingWizard />);
    const coach = await screen.findByRole("button", { name: "Coach" });

    fireEvent.keyDown(coach, { key: "Enter" });
    expect(screen.queryByText("Answer this question before continuing.")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("What best describes your work?")).toBeInTheDocument();
    expect(screen.queryByText("How will you use SkillsetMind first?")).toBeNull();
  });

  it("Enter num campo de texto continua seguindo em frente", async () => {
    mocks.profile = { displayName: "Patrick Simon", phoneNumber: null, onboardingAnswers: {} };
    render(<OnboardingWizard />);
    const phone = await screen.findByLabelText("Phone");

    fireEvent.keyDown(phone, { key: "Enter" });
    expect(await screen.findByText(/Enter a phone number/)).toBeInTheDocument();
  });

  // No celular a barra do Continue fica presa embaixo: o aviso tem de vir
  // para o meio da tela, senao nasce atras dela e o toque parece nao fazer nada.
  it("leva o aviso de erro para a vista quando ele aparece", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      mocks.profile = { displayName: "Patrick Simon", phoneNumber: null, onboardingAnswers: {} };
      render(<OnboardingWizard />);
      await screen.findByLabelText("Phone");

      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/Enter a phone number/);
      expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
      expect(scrollIntoView.mock.contexts).toContain(alert);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  // Dois toques rapidos na mesma opcao (ou Enter duas vezes) avancavam duas
  // perguntas e pulavam a de temas, que e obrigatoria.
  it("dois toques rapidos numa opcao avancam uma pergunta so", async () => {
    render(<OnboardingWizard />);
    const coach = await screen.findByRole("button", { name: "Coach" });

    fireEvent.click(coach);
    fireEvent.click(screen.getByRole("button", { name: "Coach" }));

    expect(await screen.findByText("What kind of program will you publish?")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByText("What kind of program will you publish?")).toBeInTheDocument();
    expect(screen.queryByText("Are you already selling online?")).toBeNull();
    expect(screen.getByText("Question 3 of 8")).toBeInTheDocument();
  });

  it("o foco vai para o titulo da pergunta nova, mas nao na chegada", async () => {
    render(<OnboardingWizard />);
    const title = await screen.findByRole("heading", { level: 1, name: "What best describes your work?" });
    expect(title).not.toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Coach" }));

    const next = await screen.findByRole("heading", { level: 1, name: "What kind of program will you publish?" });
    await waitFor(() => expect(next).toHaveFocus());
    expect(next).toHaveAttribute("tabindex", "-1");
  });

  it("a resposta marcada fica marcada para o leitor de tela", async () => {
    mocks.profile.onboardingAnswers = { profileConfirmed: true, path: "teacher", profession: "Coach" };
    render(<OnboardingWizard />);
    await screen.findByText("What kind of program will you publish?");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("button", { name: "Coach" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Facilitator" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("boas-vindas: retoma o checkout depois de perder a sessão", () => {
  const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams({ path: "student", returnTo: checkout });
    mocks.profile = { displayName: "Patrick Simon", phoneNumber: null, onboardingAnswers: {} };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
    mocks.updateUserIdentity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it.each([
    [checkout, checkout],
    ["//outside.example/checkout", null],
  ])("preserves only a safe destination when entering without a session: %s", async (returnTo, expected) => {
    mocks.auth = { status: "unauthenticated", user: null };
    mocks.searchParams = new URLSearchParams({ path: "teacher", returnTo: returnTo! });
    render(<OnboardingWizard />);

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledTimes(1));
    const destination = new URL(mocks.router.replace.mock.calls[0][0], "https://skillsetmind.example");
    expect(destination.pathname).toBe("/auth");
    expect(destination.searchParams.get("mode")).toBe("signin");
    expect(destination.searchParams.get("path")).toBe("teacher");
    expect(destination.searchParams.get("returnTo")).toBe(expected);
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });

  it.each(["profile", "completion"])("preserves checkout when the session disappears before %s", async (step) => {
    if (step === "completion") {
      mocks.profile.onboardingAnswers = {
        profileConfirmed: true,
        path: "student",
        primaryGoal: ["Business"],
        sourceOfDiscovery: "Instagram",
      };
    }
    const view = render(<OnboardingWizard />);
    await screen.findByText(step === "profile"
      ? "First, tell us who you are."
      : "Where did you hear about SkillsetMind?");

    mocks.auth = { status: "unauthenticated", user: null };
    view.rerender(<OnboardingWizard />);
    // The auth effect already redirected. Clear only that observation so the
    // submit guard must preserve the destination independently, before any write.
    mocks.router.replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
    const destination = new URL(mocks.router.replace.mock.calls[0][0], "https://skillsetmind.example");
    expect(destination.searchParams.get("mode")).toBe("signin");
    expect(destination.searchParams.get("path")).toBe("student");
    expect(destination.searchParams.get("returnTo")).toBe(checkout);
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });
});

describe("H3: pais declarado do professor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("path=teacher");
    mocks.profile = {
      displayName: "Patrick Simon",
      phoneNumber: "+1 555 123 4567",
      onboardingAnswers: {
        profileConfirmed: true, path: "teacher", profession: "Coach",
        primaryGoal: ["Business"], alreadySold: "no",
      },
    };
    mocks.getUserProfile.mockImplementation(() => Promise.resolve(mocks.profile));
    mocks.updateOnboardingAnswers.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("exige uma escolha sem inferir pais do idioma ou do telefone", async () => {
    render(<OnboardingWizard />);
    expect(await screen.findByLabelText("Country of your bank account")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Answer this question before continuing.")).toBeInTheDocument();
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });

  it.each(["CA", "other"])("persiste %s apenas nas respostas, conserva as anteriores e retoma sem perder o pais", async (country) => {
    const view = render(<OnboardingWizard />);
    fireEvent.change(await screen.findByLabelText("Country of your bank account"), { target: { value: country } });
    if (country === "other") {
      expect(screen.getByRole("status")).toHaveTextContent(/cannot sell or receive payments/);
    }
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Do you already have an audience?");
    expect(mocks.updateOnboardingAnswers).toHaveBeenLastCalledWith({
      uid: "u-1", path: "teacher", completed: false,
      answers: { ...mocks.profile.onboardingAnswers, payoutCountry: country },
    });
    expect(mocks.updateUserIdentity).not.toHaveBeenCalled();
    mocks.profile.onboardingAnswers = mocks.updateOnboardingAnswers.mock.calls.at(-1)![0].answers;
    view.unmount();
    render(<OnboardingWizard />);
    await screen.findByText(/Instagram handle/);
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    }
    expect(screen.getByLabelText("Country of your bank account")).toHaveValue(country);
  });

  it("nao avanca quando a persistencia falha e permite tentar de novo", async () => {
    mocks.updateOnboardingAnswers.mockRejectedValueOnce(new Error("offline"));
    render(<OnboardingWizard />);
    fireEvent.change(await screen.findByLabelText("Country of your bank account"), { target: { value: "GB" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Could not save this answer/)).toBeInTheDocument();
    expect(screen.getByLabelText("Country of your bank account")).toHaveValue("GB");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Do you already have an audience?");
  });

  it("aluno nao recebe a pergunta mesmo com declaracao antiga", async () => {
    mocks.profile.onboardingAnswers = { profileConfirmed: true, path: "student", payoutCountry: "other" };
    render(<OnboardingWizard />);
    await screen.findByText("What do you want to learn first?");
    expect(screen.queryByLabelText("Country of your bank account")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Personal Development" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Where did you hear about SkillsetMind?");
    expect(screen.queryByLabelText("Country of your bank account")).toBeNull();
  });

  it("troca de aluno para professor passa a exigir a pergunta", async () => {
    mocks.searchParams = new URLSearchParams();
    mocks.profile.onboardingAnswers = { profileConfirmed: true, primaryGoal: ["Business"], profession: "Coach", alreadySold: "no" };
    render(<OnboardingWizard />);
    fireEvent.click(await screen.findByRole("button", { name: /I want to teach/ }));
    await screen.findByText("What best describes your work?");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText("Country of your bank account")).toHaveValue("");
  });

  it("Enter no seletor nao salva nem avanca antes de confirmar a escolha", async () => {
    render(<OnboardingWizard />);
    const select = await screen.findByLabelText("Country of your bank account");
    fireEvent.change(select, { target: { value: "CA" } });
    fireEvent.keyDown(select, { key: "Enter" });
    expect(screen.getByLabelText("Country of your bank account")).toHaveValue("CA");
    expect(mocks.updateOnboardingAnswers).not.toHaveBeenCalled();
  });
});
