import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

// A pagina de relatorios mostrava menos relatorio que a home: 3 tiles de
// todo-o-sempre, sem periodo, sem grafico e sem visao por produto. Aqui o
// periodo padrao (30d) recorta os pedidos, os 4 KPIs saem desse recorte, o
// grafico e o MESMO da home e a tabela vem ordenada pela receita.

// Referencia estavel por render: um array novo a cada chamada do mock
// realimenta o efeito e trava o act() em laco.
const mocks = vi.hoisted(() => ({
  orders: [] as unknown[],
  ledgers: [] as unknown[],
  subscriptions: [] as unknown[],
  courses: [] as unknown[],
  ordersRead: "ready" as "ready" | "loading" | "error",
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-1" } }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (
    _uid: string,
    onData: (rows: unknown[]) => void,
    onError?: (error: Error) => void,
  ) => {
    if (mocks.ordersRead === "error") onError?.(new Error("boom"));
    else if (mocks.ordersRead === "ready") onData(mocks.orders);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (
    _uid: string,
    onData: (rows: unknown[]) => void,
  ) => {
    onData(mocks.ledgers);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-subscriptions", () => ({
  subscribeToTeacherCourseSubscriptions: (
    _uid: string,
    onData: (rows: unknown[]) => void,
  ) => {
    onData(mocks.subscriptions);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (_uid: string, onData: (rows: unknown[]) => void) => {
    onData(mocks.courses);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (row: unknown) => void) => {
    onData({
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    });
    return () => undefined;
  },
}));

import { CreatorOpsHub } from "@/components/teacher/creator-ops-hub";
import { TeacherStudioInsights } from "@/components/teacher/teacher-studio-insights";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";

// Na home os dados chegam por props (a Home le uma vez e repassa).
function HomeInsights() {
  return (
    <TeacherStudioInsights
      courses={mocks.courses as TeacherCourse[]}
      orders={mocks.orders as Order[]}
    />
  );
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function order(fields: Record<string, unknown>) {
  return {
    currency: "USD",
    platformFeeBps: 1000,
    provider: "stripe",
    userId: "learner-1",
    ...fields,
  };
}

beforeEach(() => {
  mocks.ordersRead = "ready";
  // Tres pagos + um reembolsado dentro dos 30 dias, e um pago velho fora deles.
  mocks.orders = [
    order({
      id: "o1",
      status: "paid",
      courseId: "c1",
      courseTitle: "Deep Hypnosis",
      amountMinor: 20_000,
      createdAt: daysAgo(2),
    }),
    order({
      id: "o2",
      status: "paid",
      courseId: "c1",
      courseTitle: "Deep Hypnosis",
      amountMinor: 20_000,
      createdAt: daysAgo(9),
    }),
    order({
      id: "o3",
      status: "paid",
      courseId: "c2",
      courseTitle: "Breathwork Basics",
      amountMinor: 5_000,
      createdAt: daysAgo(4),
    }),
    order({
      id: "o4",
      status: "refunded",
      courseId: "c2",
      courseTitle: "Breathwork Basics",
      amountMinor: 5_000,
      createdAt: daysAgo(5),
    }),
    order({
      id: "o5",
      status: "paid",
      courseId: "c3",
      courseTitle: "Old Product",
      amountMinor: 900_000,
      createdAt: daysAgo(200),
    }),
  ];
  mocks.ledgers = [
    {
      id: "l1",
      teacherId: "teacher-1",
      courseId: "c1",
      orderId: "o1",
      paymentId: "p1",
      status: "settled",
      grossAmountMinor: 45_000,
      skillsetFeeMinor: 4_500,
      stripeFeeMinor: 1_500,
      netAmountMinor: 39_000,
      currency: "USD",
      createdAt: daysAgo(2),
    },
    // Fora do periodo: nao pode entrar na receita liquida de 30 dias.
    {
      id: "l2",
      teacherId: "teacher-1",
      courseId: "c3",
      orderId: "o5",
      paymentId: "p5",
      status: "settled",
      grossAmountMinor: 900_000,
      skillsetFeeMinor: 90_000,
      stripeFeeMinor: 10_000,
      netAmountMinor: 800_000,
      currency: "USD",
      createdAt: daysAgo(200),
    },
  ];
  mocks.subscriptions = [
    {
      id: "s1",
      courseId: "c1",
      status: "active",
      interval: "month",
      priceAmountMinor: 3_000,
      currency: "USD",
    },
  ];
  mocks.courses = [
    { id: "c1", title: "Deep Hypnosis", status: "published", lessonCount: 8 },
  ];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Relatorios do professor", () => {
  it("os 4 KPIs contam so o periodo aberto, e o reembolso vira taxa", async () => {
    render(<CreatorOpsHub />);

    // 3 pagos em 30 dias; o pedido de 200 dias atras fica de fora.
    expect(await screen.findByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    // 1 reembolsado / (3 pagos + 1 reembolsado) = 25%.
    expect(screen.getByText("Refund rate")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();

    // Receita liquida do razao do periodo: 39.000 minor. Os 800.000 do
    // lancamento velho nao entram.
    expect(screen.getByText("Net revenue")).toBeInTheDocument();
    expect(screen.getByText("$390")).toBeInTheDocument();

    expect(screen.getByText("MRR")).toBeInTheDocument();
    expect(screen.getByText("$30")).toBeInTheDocument();
  });

  it("o grafico de receita esta nos relatorios e continua na home", async () => {
    const reports = render(<CreatorOpsHub />);
    expect(
      await screen.findByRole("img", { name: "Teacher revenue chart" }),
    ).toBeInTheDocument();
    reports.unmount();

    render(<HomeInsights />);
    expect(
      await screen.findByRole("img", { name: "Teacher revenue chart" }),
    ).toBeInTheDocument();
  });

  it("a tabela por produto vem ordenada pela receita, com os reembolsos do periodo", async () => {
    render(<CreatorOpsHub />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);

    expect(rows).toHaveLength(2);
    // produto / pedidos / receita / reembolsos
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["Deep Hypnosis", "2", "$400", "0"],
      // Breathwork rende menos e vem depois, com o reembolso contado a parte.
      ["Breathwork Basics", "1", "$50", "1"],
    ]);
  });

  // R$100 e $20 viravam um "$120" no grafico dos relatorios.
  it("duas moedas: o grafico desenha uma, diz as outras e a tabela separa as linhas", async () => {
    mocks.orders = [
      order({ id: "b1", status: "paid", courseId: "c1", courseTitle: "Deep Hypnosis", amountMinor: 10_000, currency: "BRL", createdAt: daysAgo(2) }),
      order({ id: "b2", status: "paid", courseId: "c1", courseTitle: "Deep Hypnosis", amountMinor: 10_000, currency: "BRL", createdAt: daysAgo(3) }),
      order({ id: "u1", status: "paid", courseId: "c1", courseTitle: "Deep Hypnosis", amountMinor: 2_000, currency: "USD", createdAt: daysAgo(2) }),
    ];

    render(<CreatorOpsHub />);

    // BRL tem mais pedidos no periodo: e a moeda do grafico.
    const chart = (await screen.findByRole("img", { name: "Teacher revenue chart" })).closest<HTMLElement>(".studio-chart-card")!;
    expect(within(chart).getByText("R$200", { selector: "strong" })).toBeInTheDocument();
    expect(within(chart).getByText("Other currencies are not in this chart: $20.")).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[2].textContent)).toEqual(["R$200", "$20"]);
    expect(document.body.textContent).not.toMatch(/\$220|R\$220|BRL 220|USD 220/);
    // As moedas lado a lado com " · ": o " + " de antes lia como soma.
    expect(document.body.textContent).not.toMatch(/\d \+ /);
  });

  it("reembolso parcial: $100 com $30 devolvidos conta $70 no grafico e na tabela", async () => {
    mocks.orders = [
      order({ id: "p1", status: "partially_refunded", courseId: "c1", courseTitle: "Deep Hypnosis", amountMinor: 10_000, refundedAmountMinor: 3_000, createdAt: daysAgo(2) }),
    ];

    render(<CreatorOpsHub />);

    const chart = (await screen.findByRole("img", { name: "Teacher revenue chart" })).closest<HTMLElement>(".studio-chart-card")!;
    expect(within(chart).getByText("$70", { selector: "strong" })).toBeInTheDocument();
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Deep Hypnosis", "1", "$70", "1"]);
  });

  // Carregando ou com erro, o grafico dizia "No revenue in this period".
  it.each([
    ["loading", "Loading..."],
    ["error", "Unavailable"],
  ] as const)("pedidos em '%s': o grafico nao afirma receita zero", async (read, label) => {
    mocks.ordersRead = read;

    render(<CreatorOpsHub />);

    const chart = (await screen.findByRole("img", { name: "Teacher revenue chart" })).closest<HTMLElement>(".studio-chart-card")!;
    expect(within(chart).getByRole("status")).toHaveTextContent(label);
    expect(within(chart).queryByText("No revenue in this period")).toBeNull();
  });

  it("sem nenhuma linha, o export nao fica clicavel", async () => {
    mocks.orders = [];
    mocks.ledgers = [];

    render(<CreatorOpsHub />);

    expect(await screen.findByRole("button", { name: /Export/ })).toBeDisabled();
    expect(screen.getByText("No charged orders in this period.")).toBeInTheDocument();
  });
});

function ChangeLanguage() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Cambiar a español</button>;
}

describe("datas dos gráficos no idioma da pessoa", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8, 12));
    mocks.orders = [order({
      id: "paid-september", status: "paid", courseId: "c1", courseTitle: "Deep Hypnosis",
      amountMinor: 20_000, createdAt: new Date(2026, 8, 6, 12).toISOString(),
    })];
    mocks.ledgers = [];
    mocks.subscriptions = [];
  });

  const charts = [
    { name: "relatório diário", Component: CreatorOpsHub, period: "30d", englishLabel: "Aug 10", spanishLabel: "10 ago" },
    { name: "relatório mensal", Component: CreatorOpsHub, period: "12m", englishLabel: "Oct", spanishLabel: "oct" },
    { name: "home mensal", Component: HomeInsights, period: "12m", englishLabel: "Oct", spanishLabel: "oct" },
  ];

  it.each(charts)("$name já abre com datas em espanhol", ({ Component, period, spanishLabel, englishLabel }) => {
    render(<I18nProvider initialLocale="es"><Component /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: period }));

    // Os rotulos do eixo moram em HTML em volta do SVG (12px em qualquer
    // largura), dentro do mesmo quadro do grafico.
    const chart = screen.getByRole("img").closest<HTMLElement>(".studio-chart-canvas")!;
    expect(within(chart).getByText(spanishLabel)).toBeInTheDocument();
    expect(within(chart).queryByText(englishLabel)).not.toBeInTheDocument();
    expect(within(chart.closest<HTMLElement>(".studio-chart-card")!).getByText("$200", { selector: "strong" })).toBeVisible();
  });

  it.each(charts)("$name acompanha EN→ES sem trocar período, dados ou total", ({ Component, period, spanishLabel, englishLabel }) => {
    render(<I18nProvider initialLocale="en"><ChangeLanguage /><Component /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: period }));

    const chart = screen.getByRole("img").closest<HTMLElement>(".studio-chart-canvas")!;
    expect(within(chart).getByText(englishLabel)).toBeInTheDocument();
    const geometry = [...chart.querySelectorAll("path")].map((path) => path.getAttribute("d"));
    // Os pontos sao HTML (no desenho esticado um circulo viraria elipse).
    const points = chart.querySelectorAll("span.rounded-full").length;
    expect(points).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));

    expect(within(chart).getByText(spanishLabel)).toBeInTheDocument();
    expect(within(chart).queryByText(englishLabel)).not.toBeInTheDocument();
    expect(within(chart.closest<HTMLElement>(".studio-chart-card")!).getByText("$200", { selector: "strong" })).toBeVisible();
    expect(screen.getByRole("button", { name: period })).toHaveAttribute("aria-pressed", "true");
    expect([...chart.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual(geometry);
    expect(chart.querySelectorAll("span.rounded-full")).toHaveLength(points);
    expect(screen.getAllByText("Deep Hypnosis").length).toBeGreaterThan(0);
  });

  it("mantém os acentos nas orientações do relatório em espanhol", () => {
    mocks.orders = [];
    render(<I18nProvider initialLocale="es"><CreatorOpsHub /></I18nProvider>);

    expect(screen.getByText("Últimos 30 días - todos los productos")).toBeInTheDocument();
    expect(screen.getByText("Después de las comisiones de la plataforma y de Stripe, registrado en tu propia cuenta de Stripe.")).toBeInTheDocument();
    expect(screen.getByText("Elige un periodo más largo o comprueba que tus pedidos pagados llegaron.")).toBeInTheDocument();
  });
});
