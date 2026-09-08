import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-1" } }),
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (_uid: string, onData: (rows: unknown[]) => void) => {
    onData(mocks.orders);
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

afterEach(cleanup);

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
    expect(screen.getByText("USD 390")).toBeInTheDocument();

    expect(screen.getByText("MRR")).toBeInTheDocument();
    expect(screen.getByText("USD 30")).toBeInTheDocument();
  });

  it("o grafico de receita esta nos relatorios e continua na home", async () => {
    const reports = render(<CreatorOpsHub />);
    expect(
      await screen.findByRole("img", { name: "Teacher revenue chart" }),
    ).toBeInTheDocument();
    reports.unmount();

    render(<TeacherStudioInsights />);
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
      ["Deep Hypnosis", "2", "USD 400", "0"],
      // Breathwork rende menos e vem depois, com o reembolso contado a parte.
      ["Breathwork Basics", "1", "USD 50", "1"],
    ]);
  });

  it("sem nenhuma linha, o export nao fica clicavel", async () => {
    mocks.orders = [];
    mocks.ledgers = [];

    render(<CreatorOpsHub />);

    expect(await screen.findByRole("button", { name: /Export/ })).toBeDisabled();
    expect(screen.getByText("No charged orders in this period.")).toBeInTheDocument();
  });
});
