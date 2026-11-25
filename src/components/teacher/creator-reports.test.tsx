import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";

// The reports page showed less than the home: 3 all-time tiles,
// with no period, no chart and no per-product view. Here the
// default period (30d) trims the orders, the 4 KPIs come from that slice, the
// chart is the SAME as the home's and the table comes sorted by revenue.

// Stable reference per render: a new array on every mock call
// feeds the effect again and locks act() in a loop.
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

// On the home the data arrives through props (Home reads once and passes it down).
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
  // Three paid + one refunded within the 30 days, and one old paid order outside them.
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
    // Outside the period: it must not enter the 30-day net revenue.
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

describe("Teacher reports", () => {
  it("the 4 KPIs count only the open period, and the refund becomes a rate", async () => {
    render(<CreatorOpsHub />);

    // 3 paid in 30 days; the order from 200 days ago stays out.
    expect(await screen.findByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    // 1 reembolsado / (3 pagos + 1 reembolsado) = 25%.
    expect(screen.getByText("Refund rate")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();

    // Net revenue from the period ledger: 39,000 minor. The 800,000 from the
    // old ledger entry do not count.
    expect(screen.getByText("Net revenue")).toBeInTheDocument();
    expect(screen.getByText("$390")).toBeInTheDocument();

    expect(screen.getByText("MRR")).toBeInTheDocument();
    expect(screen.getByText("$30")).toBeInTheDocument();
  });

  it("the revenue chart is in the reports and stays on the home", async () => {
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

  it("the per-product table comes sorted by revenue, with the period's refunds", async () => {
    render(<CreatorOpsHub />);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);

    expect(rows).toHaveLength(2);
    // product / orders / revenue / refunds
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["Deep Hypnosis", "2", "$400", "0"],
      // Breathwork earns less and comes after, with the refund counted separately.
      ["Breathwork Basics", "1", "$50", "1"],
    ]);
  });

  // R$100 and $20 turned into a "$120" on the reports chart.
  it("two currencies: the chart draws one, names the others and the table separates the rows", async () => {
    mocks.orders = [
      order({ id: "b1", status: "paid", courseId: "c1", courseTitle: "Deep Hypnosis", amountMinor: 10_000, currency: "BRL", createdAt: daysAgo(2) }),
      order({ id: "b2", status: "paid", courseId: "c1", courseTitle: "Deep Hypnosis", amountMinor: 10_000, currency: "BRL", createdAt: daysAgo(3) }),
      order({ id: "u1", status: "paid", courseId: "c1", courseTitle: "Deep Hypnosis", amountMinor: 2_000, currency: "USD", createdAt: daysAgo(2) }),
    ];

    render(<CreatorOpsHub />);

    // BRL has more orders in the period: it is the chart's currency.
    const chart = (await screen.findByRole("img", { name: "Teacher revenue chart" })).closest<HTMLElement>(".studio-chart-card")!;
    expect(within(chart).getByText("R$200", { selector: "strong" })).toBeInTheDocument();
    expect(within(chart).getByText("Other currencies are not in this chart: $20.")).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[2].textContent)).toEqual(["R$200", "$20"]);
    expect(document.body.textContent).not.toMatch(/\$220|R\$220|BRL 220|USD 220/);
    // The currencies side by side with " · ": the earlier " + " read as a sum.
    expect(document.body.textContent).not.toMatch(/\d \+ /);
  });

  it("partial refund: $100 with $30 returned counts as $70 on the chart and the table", async () => {
    mocks.orders = [
      order({ id: "p1", status: "partially_refunded", courseId: "c1", courseTitle: "Deep Hypnosis", amountMinor: 10_000, refundedAmountMinor: 3_000, createdAt: daysAgo(2) }),
    ];

    render(<CreatorOpsHub />);

    const chart = (await screen.findByRole("img", { name: "Teacher revenue chart" })).closest<HTMLElement>(".studio-chart-card")!;
    expect(within(chart).getByText("$70", { selector: "strong" })).toBeInTheDocument();
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Deep Hypnosis", "1", "$70", "1"]);
  });

  // While loading or on error, the chart said "No revenue in this period".
  it.each([
    ["loading", "Loading..."],
    ["error", "Unavailable"],
  ] as const)("for orders in '%s': the chart does not claim zero revenue", async (read, label) => {
    mocks.ordersRead = read;

    render(<CreatorOpsHub />);

    const chart = (await screen.findByRole("img", { name: "Teacher revenue chart" })).closest<HTMLElement>(".studio-chart-card")!;
    expect(within(chart).getByRole("status")).toHaveTextContent(label);
    expect(within(chart).queryByText("No revenue in this period")).toBeNull();
  });

  // F-11: only "Unavailable" in the boxes, with no notice and no way out other than reloading.
  it("a read that fails shows a notice and 'Try again' reads again", async () => {
    mocks.ordersRead = "error";
    render(<CreatorOpsHub />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load part of this report.");
    mocks.ordersRead = "ready";
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("with no rows, the export is not clickable", async () => {
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

describe("chart dates in the person's language", () => {
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

  it.each(charts)("$name already opens with dates in Spanish", ({ Component, period, spanishLabel, englishLabel }) => {
    render(<I18nProvider initialLocale="es"><Component /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: period }));

    // The axis labels live in HTML around the SVG (12px at any
    // width), inside the same frame as the chart.
    const chart = screen.getByRole("img").closest<HTMLElement>(".studio-chart-canvas")!;
    expect(within(chart).getByText(spanishLabel)).toBeInTheDocument();
    expect(within(chart).queryByText(englishLabel)).not.toBeInTheDocument();
    expect(within(chart.closest<HTMLElement>(".studio-chart-card")!).getByText("$200", { selector: "strong" })).toBeVisible();
  });

  it.each(charts)("$name follows EN→ES without changing period, data or total", ({ Component, period, spanishLabel, englishLabel }) => {
    render(<I18nProvider initialLocale="en"><ChangeLanguage /><Component /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: period }));

    const chart = screen.getByRole("img").closest<HTMLElement>(".studio-chart-canvas")!;
    expect(within(chart).getByText(englishLabel)).toBeInTheDocument();
    const geometry = [...chart.querySelectorAll("path")].map((path) => path.getAttribute("d"));
    // The points are HTML (in the stretched drawing a circle would become an ellipse).
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

  it("keeps the accents in the Spanish report guidance", () => {
    mocks.orders = [];
    render(<I18nProvider initialLocale="es"><CreatorOpsHub /></I18nProvider>);

    expect(screen.getByText("Últimos 30 días - todos los productos")).toBeInTheDocument();
    expect(screen.getByText("Después de las comisiones de la plataforma y de Stripe, registrado en tu propia cuenta de Stripe.")).toBeInTheDocument();
    expect(screen.getByText("Elige un periodo más largo o comprueba que tus pedidos pagados llegaron.")).toBeInTheDocument();
  });
});
