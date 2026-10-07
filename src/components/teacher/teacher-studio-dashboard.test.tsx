import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";

const { mockUser, state, data } = vi.hoisted(() => {
  const state = {
    courses: [] as unknown[],
    orders: [] as unknown[],
    profile: { creatorVerificationStatus: "none" } as Record<string, unknown>,
    requireVerification: false,
    // Quando definido, substitui a resposta do ajuste de verificacao (para
    // segurar a leitura e ver o estado "carregando").
    verificationFlag: null as Promise<boolean> | null,
    activationBlocked: false,
  };

  return {
    mockUser: {
      uid: "teacher-1",
      displayName: "Patrick Simon",
      roles: ["teacher"],
    },
    state,
    // Espioes, nao so stubs: a prova de que a Home le cada dado UMA vez conta
    // as chamadas a estas tres funcoes.
    data: {
      subscribeToTeacherCourses: vi.fn(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a assinatura real tem o 3o argumento (erro)
        (_uid: string, onData: (courses: unknown[]) => void, _onError?: (error: Error) => void) => {
          onData(state.courses);
          return () => undefined;
        },
      ),
      subscribeToTeacherOrders: vi.fn(
        (_uid: string, onData: (orders: unknown[]) => void) => {
          onData(state.orders);
          return () => undefined;
        },
      ),
      subscribeToUserProfile: vi.fn(
        (_uid: string, onData: (profile: unknown) => void) => {
          onData(state.profile);
          return () => undefined;
        },
      ),
      fetchCreatorActivationBlocked: vi.fn(() => Promise.resolve(state.activationBlocked)),
    },
  };
});

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

// Sem mock do i18n: fora do I18nProvider, useTranslation cai no dicionario
// ingles real. O mock antigo devolvia a CHAVE crua para tudo que nao estava
// no mapa, e a Home agora le todos os rotulos do dicionario.

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: data.subscribeToTeacherCourses,
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: data.subscribeToTeacherOrders,
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () =>
    state.verificationFlag ?? Promise.resolve(state.requireVerification),
  fetchCreatorActivationBlocked: data.fetchCreatorActivationBlocked,
}));

vi.mock("@/lib/data/enrollments", () => ({
  getMyCourseStudents: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/course-reviews", () => ({
  getRecentCourseReviews: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/community-posts", () => ({
  getRecentCommunityQuestions: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (_uid: string, onData: (entries: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/user-profiles", () => ({
  claimWelcomeTour: vi.fn(async () => false),
  subscribeToUserProfile: data.subscribeToUserProfile,
}));

function course(fields: Record<string, unknown>) {
  return {
    id: "c1",
    title: "Breathwork Basics",
    summary: "",
    category: "",
    status: "draft",
    modules: [],
    lessonCount: 1,
    coverImageUrl: null,
    paymentType: "one_time",
    priceAmountMinor: 4900,
    ...fields,
  };
}

async function stepLabels() {
  const list = await screen.findByRole("list", { name: "Creator next steps" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector("strong")?.textContent);
}

function recommended() {
  return screen.getByText("Recommended now").closest("aside") as HTMLElement;
}

beforeEach(() => {
  state.courses = [];
  state.orders = [];
  state.profile = { creatorVerificationStatus: "none" };
  state.requireVerification = false;
  state.verificationFlag = null;
  state.activationBlocked = false;
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("TeacherStudioDashboard", () => {
  // Os mesmos quatro tipos da tela de criacao. Gratis, assinatura e programa
  // guiado deixaram de ser tipo.
  it("routes each of the four product types to the creation screen", async () => {
    render(<TeacherStudioDashboard />);

    const formats = (
      await screen.findByRole("heading", { name: "Choose a product format" })
    ).closest("section") as HTMLElement;
    const links = within(formats).getAllByRole("link");
    expect(links.map((link) => link.querySelector("h3")?.textContent)).toEqual([
      "Course",
      "Community",
      "Live event",
      "E-book",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/teach/builder?newCourse=1&format=course",
      "/teach/builder?newCourse=1&format=community",
      "/teach/builder?newCourse=1&format=live_event",
      "/teach/builder?newCourse=1&format=ebook",
    ]);
    expect(within(formats).queryByText(/Guided program|Subscription|Free program/)).toBeNull();
  });

  // O painel com 0 produtos era uma faixa tracejada com "No products in this
  // view yet.". Agora e a cena do primeiro produto e o unico botao latao.
  it("sem produto: a cena do primeiro produto e o botao latao de criar", async () => {
    render(<TeacherStudioDashboard />);

    const heading = await screen.findByRole("heading", { name: "Your first product starts here." });
    const box = heading.closest(".border-dashed") as HTMLElement;
    expect(box.querySelector('svg[data-scene="firstProduct"]')).toHaveAttribute("aria-hidden", "true");
    const create = within(box).getByRole("link", { name: "Create my first product" });
    expect(create).toHaveClass("button-accent");
    expect(create).toHaveAttribute("href", "/teach/builder?newCourse=1&format=course");
    expect(screen.queryByText("No products in this view yet.")).toBeNull();
  });
});

// O que a pessoa sofria: o passo 2 so fechava com verificacao APROVADA e
// mandava para /teach/verification, que ninguem exige; nao havia passo de
// publicar; o progresso parava em 67% e o "Recomendado agora" era a
// verificacao. Os passos agora sao as travas reais do publish.
describe("Inicio do professor: os passos sao as travas reais do publish", () => {
  it("professor novo: criar e publicar, sem Stripe nem verificacao", async () => {
    render(<TeacherStudioDashboard />);

    expect(await stepLabels()).toEqual(["Create a product", "Publish your product"]);
    expect(screen.getByText("0 of 2 complete")).toBeInTheDocument();
    expect(
      within(recommended()).getByRole("heading", { name: "Create a product" }),
    ).toBeInTheDocument();
  });

  it("curso pago em rascunho: Stripe entra antes do publish e vira o recomendado", async () => {
    state.courses = [course({})];

    render(<TeacherStudioDashboard />);

    expect(await stepLabels()).toEqual([
      "Create a product",
      "Connect Stripe",
      "Publish your product",
    ]);
    const steps = screen.getByRole("list", { name: "Creator next steps" });
    // A frase que MOROU na faixa amarela permanente do topo do /teach.
    expect(within(steps).getByText(/buyers are charged on it directly/i)).toBeInTheDocument();
    expect(screen.getByText("1 of 3 complete")).toBeInTheDocument();
    expect(
      within(recommended()).getByRole("heading", { name: "Connect Stripe" }),
    ).toBeInTheDocument();
    expect(within(recommended()).getByRole("link", { name: /Connect Stripe/ })).toHaveAttribute(
      "href",
      "/account/payments#stripe-connect",
    );
  });

  it("Stripe pronto: o recomendado e publicar, no painel de publicacao do curso", async () => {
    state.courses = [course({})];
    state.profile = {
      creatorVerificationStatus: "none",
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    };

    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getByText("2 of 3 complete")).toBeInTheDocument();
    });
    expect(
      within(recommended()).getByRole("heading", { name: "Publish your product" }),
    ).toBeInTheDocument();
    expect(within(recommended()).getByRole("link", { name: /Review and publish/ })).toHaveAttribute(
      "href",
      "/teach/builder?courseId=c1&tab=review",
    );
  });

  it("curso gratis nao pede Stripe", async () => {
    state.courses = [course({ paymentType: "free", priceAmountMinor: 0 })];

    render(<TeacherStudioDashboard />);

    expect(await stepLabels()).toEqual(["Create a product", "Publish your product"]);
  });

  it("verificacao so entra quando a plataforma exige", async () => {
    state.requireVerification = true;

    render(<TeacherStudioDashboard />);

    await waitFor(async () => {
      expect(await stepLabels()).toEqual([
        "Create a product",
        "Professional verification",
        "Publish your product",
      ]);
    });
    const steps = screen.getByRole("list", { name: "Creator next steps" });
    expect(
      within(steps).getByRole("link", { name: /Professional verification/ }),
    ).toHaveAttribute("href", "/teach/verification");
  });

  it("publicado: o passo de publicar esta feito", async () => {
    state.courses = [course({ status: "published" })];
    state.profile = {
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    };

    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getByText("3 of 3 complete")).toBeInTheDocument();
    });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  // Com a taxa exigida e nao paga, a Home mandava "Review and publish" e o
  // servidor recusava com "Pay the one-time activation fee...".
  it("taxa de ativacao pendente: o publish avisa a taxa unica e diz 'Activate and publish'", async () => {
    state.courses = [course({})];
    state.profile = { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true };
    state.activationBlocked = true;

    render(<TeacherStudioDashboard />);

    expect(
      await within(recommended()).findByRole("link", { name: /Activate and publish/ }),
    ).toHaveAttribute("href", "/teach/builder?courseId=c1&tab=review");
    expect(within(recommended()).getByText(/one-time US\$25 activation fee/)).toBeInTheDocument();
  });

  it("taxa paga ou nao exigida: publish sem aviso de taxa", async () => {
    state.courses = [course({})];
    state.profile = { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true };

    render(<TeacherStudioDashboard />);

    expect(
      await within(recommended()).findByRole("link", { name: /Review and publish/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/activation fee/)).toBeNull();
  });

  it("curso pago arquivado nao pede Stripe nem vira alerta urgente", async () => {
    // Arquivar e status "inactive": o curso saiu da venda.
    state.courses = [course({ status: "inactive" })];

    render(<TeacherStudioDashboard />);

    expect(await stepLabels()).toEqual(["Create a product", "Publish your product"]);
    expect(
      await screen.findByRole("heading", { name: "What needs your attention today." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Finish your Stripe setup")).toBeNull();
  });

  it("enquanto as travas carregam, contagem e porcentagem ficam neutras", async () => {
    let resolveFlag: (value: boolean) => void = () => undefined;
    state.verificationFlag = new Promise<boolean>((resolve) => {
      resolveFlag = resolve;
    });
    state.courses = [course({ paymentType: "free", priceAmountMinor: 0 })];

    render(<TeacherStudioDashboard />);

    const section = (await screen.findByRole("list", { name: "Creator next steps" })).closest(
      "section",
    ) as HTMLElement;
    // Sem o ajuste de verificacao, "1 of 2" e "50%" mudariam para "1 of 3".
    expect(within(section).queryByText(/of \d complete/)).toBeNull();
    expect(within(section).queryByText(/%$/)).toBeNull();

    resolveFlag(true);

    expect(await within(section).findByText("1 of 3 complete")).toBeInTheDocument();
    expect(within(section).getByText("33%")).toBeInTheDocument();
  });

  it.each([
    ["none", "Start verification"],
    ["pending", "In review"],
    ["needs_changes", "Edit application"],
    ["rejected", "Edit application"],
  ])("verificacao '%s': o botao diz '%s'", async (status, action) => {
    state.requireVerification = true;
    state.courses = [course({ paymentType: "free", priceAmountMinor: 0 })];
    state.profile = { creatorVerificationStatus: status };

    render(<TeacherStudioDashboard />);

    expect(
      await within(recommended()).findByRole("link", { name: new RegExp(action) }),
    ).toHaveAttribute("href", "/teach/verification");
  });
});

// Tres listas de "proximo passo" disputavam a mesma tela: os passos, os marcos
// e a lista de atencao (que marcava o Stripe como URGENTE antes de existir
// qualquer curso).
describe("Inicio do professor: antes do 1o publish so a lista de passos guia", () => {
  it("rascunho: sem marcos e sem a lista de atencao", async () => {
    state.courses = [course({})];

    render(<TeacherStudioDashboard />);

    await screen.findByRole("list", { name: "Creator next steps" });
    expect(screen.queryByRole("heading", { name: "Creator milestones" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "What needs your attention today." }),
    ).toBeNull();
    expect(screen.queryByText("Finish your Stripe setup")).toBeNull();
    // Os produtos e os formatos continuam.
    expect(
      screen.getByRole("heading", { name: "Products in your workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose a product format" })).toBeInTheDocument();
  });

  it("depois do 1o publish os marcos e a lista de atencao voltam", async () => {
    state.courses = [course({ status: "published", paymentType: "free", priceAmountMinor: 0 })];

    render(<TeacherStudioDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Creator milestones" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What needs your attention today." }),
    ).toBeInTheDocument();
    // So produto gratis: nada de Stripe "urgente".
    expect(screen.queryByText("Finish your Stripe setup")).toBeNull();
  });

  it("produto pago no ar sem Stripe: a lista de atencao cobra o Stripe", async () => {
    state.courses = [course({ status: "published" })];

    render(<TeacherStudioDashboard />);

    expect(await screen.findByText("Finish your Stripe setup")).toBeInTheDocument();
  });
});

describe("Inicio do professor: cada dado e lido uma vez", () => {
  it("cursos, pedidos e perfil: uma leitura cada, com todos os blocos montados", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [
      {
        id: "o1",
        courseId: "c1",
        courseTitle: "Breathwork Basics",
        status: "paid",
        amountMinor: 4900,
        currency: "usd",
        createdAt: new Date(),
      },
    ];

    render(<TeacherStudioDashboard />);

    // Metricas, grafico (insights) e atividade recente na tela.
    expect(await screen.findByText("Revenue, 30d")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Revenue" })).toBeInTheDocument();
    expect(await screen.findByText("New sale in Breathwork Basics")).toBeInTheDocument();

    expect(data.subscribeToTeacherCourses).toHaveBeenCalledTimes(1);
    expect(data.subscribeToTeacherOrders).toHaveBeenCalledTimes(1);
    expect(data.subscribeToUserProfile).toHaveBeenCalledTimes(1);
    // A taxa de ativacao vem das travas do publish, nao de uma leitura extra.
    expect(data.fetchCreatorActivationBlocked).toHaveBeenCalledTimes(1);
  });
});

// --- Onda 6: casca do professor -------------------------------------------

describe("Home do professor: uma manchete, o que aconteceu e a vitrine", () => {
  it("tem UMA manchete de nivel 1 (o olho 'Producer home' saiu)", async () => {
    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome, Patrick",
    );
    expect(screen.queryByText("Producer home")).toBeNull();
  });

  it("mostra 'Recent activity' com estado vazio honesto para professor novo", async () => {
    render(<TeacherStudioDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Recent activity" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
  });

  it("mostra 'Your storefront' com o endereco publico e os dois caminhos", async () => {
    render(<TeacherStudioDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Your storefront" }),
    ).toBeInTheDocument();
    expect(screen.getByText("/instructors/teacher-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open storefront/ })).toHaveAttribute(
      "href",
      "/instructors/teacher-1",
    );
    expect(screen.getByRole("link", { name: "Edit storefront" })).toHaveAttribute(
      "href",
      "/teach/storefront",
    );
    // Nada publicado ainda: nao dizemos que a vitrine esta no ar.
    expect(
      screen.getByText("The page exists, but nothing is published on it yet."),
    ).toBeInTheDocument();
  });

  it("um nome com $& na manchete aparece literal, sem virar '{name}'", async () => {
    // Num replace sem callback, "$&" vira o trecho casado ("{name}") e "$'" o
    // resto da frase. O nome vem do cadastro: e texto da pessoa, nao nosso.
    mockUser.displayName = "Mc$&Donald Simon";
    try {
      render(<TeacherStudioDashboard />);

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "Welcome, Mc$&Donald.",
      );
    } finally {
      mockUser.displayName = "Patrick Simon";
    }
  });
});

// --- Primeira visita: nada de "Welcome back" nem quadros de $0 ---------------

describe("Home do professor: primeira visita", () => {
  it("sem produto diz 'Welcome', nunca 'Welcome back'", async () => {
    render(<TeacherStudioDashboard />);

    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Welcome, Patrick.");
    expect(heading).not.toHaveTextContent("Welcome back");
  });

  it("com um produto volta a dizer 'Welcome back'", async () => {
    state.courses = [course({})];

    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Welcome back, Patrick.",
      );
    });
  });

  it("antes da 1a venda esconde os quadros de receita, alunos e nota", async () => {
    state.courses = [course({ status: "published" })];
    // Pedido que nao virou venda (nao pago) nao conta.
    state.orders = [
      {
        id: "o1",
        courseId: "c1",
        courseTitle: "Breathwork Basics",
        status: "pending",
        amountMinor: 4900,
        currency: "usd",
        createdAt: new Date(),
      },
    ];

    render(<TeacherStudioDashboard />);

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Revenue, 30d")).toBeNull();
    expect(screen.queryByText("New students")).toBeNull();
    expect(screen.queryByText("$0")).toBeNull();
  });

  it("com a 1a venda paga os quadros aparecem", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [
      {
        id: "o1",
        courseId: "c1",
        courseTitle: "Breathwork Basics",
        status: "paid",
        amountMinor: 4900,
        currency: "usd",
        createdAt: new Date(),
      },
    ];

    render(<TeacherStudioDashboard />);

    expect(await screen.findByText("Revenue, 30d")).toBeInTheDocument();
    expect(screen.getByText("New students")).toBeInTheDocument();
  });

  it("so com matricula gratis (sem pedido pago) os quadros aparecem", async () => {
    state.courses = [course({ status: "published", paymentType: "free", enrollmentCount: 3 })];
    state.orders = [];

    render(<TeacherStudioDashboard />);

    expect(await screen.findByText("Revenue, 30d")).toBeInTheDocument();
  });

  it("com produto mas zero matriculas e zero pedidos pagos continua sem quadros", async () => {
    state.courses = [course({ status: "published", enrollmentCount: 0 })];
    state.orders = [];

    render(<TeacherStudioDashboard />);

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Revenue, 30d")).toBeNull();
  });

  it("enquanto a lista de cursos carrega diz 'Hello', nunca 'Welcome' nem 'Welcome back'", async () => {
    data.subscribeToTeacherCourses.mockImplementationOnce(() => () => undefined);

    render(<TeacherStudioDashboard />);

    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Hello, Patrick.");
    expect(heading).not.toHaveTextContent("Welcome");
  });

  it("se a assinatura de cursos falhar, mantem 'Welcome back'", async () => {
    data.subscribeToTeacherCourses.mockImplementationOnce(
      (_uid: string, _onData: (courses: unknown[]) => void, onError?: (error: Error) => void) => {
        onError?.(new Error("boom"));
        return () => undefined;
      },
    );

    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Welcome back, Patrick.",
      );
    });
  });
});

// --- Status dos cartoes: cada um com a sua cor, nenhum em latao ---------------

describe("Home do professor: o selo do cartao e o tipo gravado", () => {
  it("mostra o tipo do produto, e gratis ou assinatura nao viram tipo", async () => {
    state.courses = [
      course({ id: "c1", title: "Grupo", productFormat: "community", paymentType: "subscription_monthly" }),
      course({ id: "c2", title: "Apostila", productFormat: "ebook", paymentType: "free", priceAmountMinor: 0 }),
      course({ id: "c3", title: "Antigo", paymentType: "free", priceAmountMinor: 0 }),
    ];

    render(<TeacherStudioDashboard />);

    const produtos = await screen.findByRole("region", { name: "Products in your workspace" });
    const typeOf = (title: string) =>
      within(produtos).getByRole("link", { name: new RegExp(title) }).querySelector("span.uppercase")?.textContent;
    expect([typeOf("Grupo"), typeOf("Apostila"), typeOf("Antigo")]).toEqual(["Community", "E-book", "Course"]);
    expect(produtos.textContent).not.toContain("creatorPanel.home.formats");
  });
});

describe("Home do professor: status dos cartoes de produto", () => {
  it("Published, Draft e Needs changes saem em StatusChip diferentes", async () => {
    state.courses = [
      course({ id: "c1", title: "No ar", status: "published" }),
      course({ id: "c2", title: "Rascunho", status: "draft" }),
      course({ id: "c3", title: "Com ajuste", status: "needs_changes" }),
    ];

    render(<TeacherStudioDashboard />);

    const produtos = await screen.findByRole("region", {
      name: "Products in your workspace",
    });
    const cardOf = (title: string) =>
      within(produtos).getByRole("link", { name: new RegExp(title) });
    const chipOf = (title: string) => cardOf(title).querySelector(".status-chip");

    expect(chipOf("No ar")).toHaveClass("status-chip--success");
    expect(chipOf("No ar")).toHaveTextContent("Published");
    expect(chipOf("Rascunho")).toHaveClass("status-chip--draft");
    expect(chipOf("Rascunho")).toHaveTextContent("Draft");
    expect(chipOf("Com ajuste")).toHaveClass("status-chip--danger");
    expect(chipOf("Com ajuste")).toHaveTextContent("Needs changes");
    // O texto dourado de antes nao volta em nenhum cartao.
    for (const title of ["No ar", "Rascunho", "Com ajuste"]) {
      expect(cardOf(title).innerHTML).not.toContain("--color-accent-fg");
    }
  });
});

// Onda D na Home: os cartoes chegam em escada e sobem no hover; quem abre a
// Home com tudo pronto ve o check e o selo parados (festa so na mudanca).
describe("Home do professor: movimento", () => {
  it("cartoes em escada (--i por cartao) e com o hover que sobe", async () => {
    state.courses = [
      course({ id: "c1", title: "Primeiro" }),
      course({ id: "c2", title: "Segundo" }),
    ];

    render(<TeacherStudioDashboard />);

    const produtos = await screen.findByRole("region", { name: "Products in your workspace" });
    const list = produtos.querySelector("ul.motion-stagger")!;
    expect(list).not.toBeNull();
    const items = [...list.children] as HTMLElement[];
    expect(items.map((item) => item.style.getPropertyValue("--i"))).toEqual(["0", "1"]);
    expect(within(produtos).getByRole("link", { name: /Primeiro/ })).toHaveClass("motion-hover-lift");
  });

  it("abrir a Home com os passos prontos: check e selo de 100% parados", async () => {
    state.courses = [course({ status: "published" })];
    state.profile = {
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    };

    const { container } = render(<TeacherStudioDashboard />);

    await waitFor(() => expect(screen.getByText("3 of 3 complete")).toBeInTheDocument());
    expect(container.querySelectorAll("[data-drawn-check]").length).toBeGreaterThan(0);
    expect(container.querySelector(".drawn-check")).toBeNull();
    expect(container.querySelector("[data-milestone-seal]")).not.toHaveClass("milestone-seal");
  });
});
