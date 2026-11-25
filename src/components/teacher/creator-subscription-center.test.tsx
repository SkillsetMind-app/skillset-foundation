import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CreatorSubscriptionCenter, CreatorSubscriptionCenterView } from "@/components/teacher/creator-subscription-center";
import type { CourseSubscription } from "@/domain/course-subscription";
import type { CreatorCourseSubscription } from "@/domain/creator-subscriptions";
import type { Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { SubscriberProfile } from "@/lib/data/user-profiles";
import type { TeacherCourse } from "@/domain/teacher-course";

// The amount as the house formatter writes it (the amount's own currency, in the language).
// The Spanish non-breaking space ("99,00 BRL") becomes a regular space, as getByText
// normalizes the text on the screen.
const money = (locale: string, value: number, currency: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(value).replace(/\s/g, " ");

// Stable references: changing language is not the same as changing user/data.
const reads = vi.hoisted(() => ({
  user: { uid: "teacher-1" },
  subscriptions: vi.fn(), courses: vi.fn(), orders: vi.fn(), ledgers: vi.fn(), profiles: vi.fn(),
  closeSubscriptions: vi.fn(), closeCourses: vi.fn(), closeOrders: vi.fn(), closeLedgers: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: reads.user }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: reads.refresh }) }));
vi.mock("@/lib/data/course-subscriptions", () => ({ subscribeToTeacherCourseSubscriptions: reads.subscriptions }));
vi.mock("@/lib/data/teacher-courses", () => ({ subscribeToTeacherCourses: reads.courses }));
vi.mock("@/lib/data/orders", () => ({ subscribeToTeacherOrders: reads.orders }));
vi.mock("@/lib/data/payout-ledger", () => ({ subscribeToTeacherPayoutLedger: reads.ledgers }));
vi.mock("@/lib/data/user-profiles", () => ({ getMySubscriberProfiles: reads.profiles }));

const course = {
  id: "course-1",
  ownerId: "teacher-1",
  title: "Clinical Focus",
  summary: "",
  category: "Psychology",
  status: "published",
  modules: [],
  lessonCount: 0,
  paymentType: "subscription_monthly",
  priceAmountMinor: 19900,
  currency: "BRL",
} as TeacherCourse;

const subscription = {
  id: "sub-1",
  userId: "learner-1",
  courseId: "course-1",
  stripeSubscriptionId: "sub-1",
  status: "active",
  interval: "month",
  currentPeriodEnd: "2026-08-15T10:00:00.000Z",
  cancelAtPeriodEnd: false,
  pastDue: false,
  updatedAt: "2026-07-15T10:00:00.000Z",
} as CourseSubscription;

const order = {
  id: "in-1",
  userId: "learner-1",
  teacherId: "teacher-1",
  courseId: "course-1",
  courseSlug: "course-1",
  courseTitle: "Clinical Focus",
  amountMinor: 9900,
  currency: "BRL",
  platformFeeBps: 800,
  status: "paid",
  provider: "stripe",
  checkoutSessionId: null,
  paymentIntentId: "pi-1",
  createdAt: "2026-07-15T10:00:00.000Z",
} as Order;

const ledger = {
  id: "in-1",
  teacherId: "teacher-1",
  courseId: "course-1",
  orderId: "in-1",
  paymentId: "pi-1",
  subscriptionId: "sub-1",
  kind: "course_subscription",
  grossAmountMinor: 9900,
  skillsetFeeMinor: 792,
  netAmountMinor: 8808,
  currency: "BRL",
  status: "in_release",
  createdAt: "2026-07-15T10:00:00.000Z",
} as PayoutLedgerEntry;

const profile = {
  uid: "learner-1",
  displayName: "Maria Silva",
  photoUrl: "",
} as SubscriberProfile;

const viewProps: ComponentProps<typeof CreatorSubscriptionCenterView> = {
  subscriptions: [subscription], courses: [course], orders: [order], ledgers: [ledger], profiles: [profile],
};

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>
    {locale === "en" ? "Cambiar a español" : "Switch to English"}
  </button>;
}

function mountView(overrides: Partial<typeof viewProps> = {}, locale: "en" | "es" = "es") {
  return render(<I18nProvider initialLocale={locale}>
    <ChangeLanguage /><CreatorSubscriptionCenterView {...viewProps} {...overrides} />
  </I18nProvider>);
}

async function mountCenter() {
  await act(async () => {
    render(<I18nProvider initialLocale="en"><ChangeLanguage /><CreatorSubscriptionCenter /></I18nProvider>);
  });
}

function readCounts() {
  return [reads.subscriptions, reads.courses, reads.orders, reads.ledgers, reads.profiles,
    reads.closeSubscriptions, reads.closeCourses, reads.closeOrders, reads.closeLedgers]
    .map((read) => read.mock.calls.length);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T15:00:00.000Z"));
  reads.subscriptions.mockImplementation((_uid, next) => { next(viewProps.subscriptions); return reads.closeSubscriptions; });
  reads.courses.mockImplementation((_uid, next) => { next(viewProps.courses); return reads.closeCourses; });
  reads.orders.mockImplementation((_uid, next) => { next(viewProps.orders); return reads.closeOrders; });
  reads.ledgers.mockImplementation((_uid, next) => { next(viewProps.ledgers); return reads.closeLedgers; });
  reads.profiles.mockResolvedValue(viewProps.profiles);
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("CreatorSubscriptionCenterView", () => {
  it("shows operational metrics and filters subscribers by name", () => {
    render(
      <CreatorSubscriptionCenterView
        subscriptions={[subscription]}
        courses={[course]}
        orders={[order]}
        ledgers={[ledger]}
        profiles={[profile]}
      />,
    );

    expect(screen.getAllByText("Maria Silva").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clinical Focus").length).toBeGreaterThan(0);
    expect(screen.getByText("1 active")).toBeInTheDocument();
    expect(screen.getByText(money("en", 99, "BRL"))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search subscribers"), {
      target: { value: "does-not-match" },
    });
    expect(screen.queryByText("Maria Silva")).not.toBeInTheDocument();
    expect(screen.getByText("No subscribers match these filters.")).toBeInTheDocument();
  });

  it("switches to reportable renewal history", () => {
    render(
      <CreatorSubscriptionCenterView
        subscriptions={[subscription]}
        courses={[course]}
        orders={[order]}
        ledgers={[ledger]}
        profiles={[profile]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Renewals" }));
    // By product and date; the id stays collapsed in "Details for support",
    // selectable, for Stripe and support.
    expect(screen.getByText("Clinical Focus renewal · Jul 15, 2026")).toBeInTheDocument();
    const renewalId = screen.getByText("Renewal ID: in-1");
    expect(renewalId).toHaveClass("select-all");
    expect(renewalId.closest("details")).not.toHaveAttribute("open");
    expect(renewalId.closest("details")).toHaveTextContent("Details for support");
    expect(screen.getByText(/Maria Silva/)).toBeInTheDocument();
    expect(screen.getByText(`Gross ${money("en", 99, "BRL")}`)).toBeInTheDocument();
  });

  it("marks financial metrics and renewals unavailable after a read failure", () => {
    render(
      <CreatorSubscriptionCenterView
        subscriptions={[subscription]}
        courses={[course]}
        orders={[]}
        ledgers={[]}
        profiles={[profile]}
        financialState="error"
      />,
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No MRR yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Renewals" }));
    expect(screen.getByText("Renewal history is unavailable.")).toBeInTheDocument();
  });
});

describe("subscriptions journey in the person's language", () => {
  it("switches EN↔ES keeping search, filter, tab, authors, dates and amounts", () => {
    const subscriptions: CreatorCourseSubscription[] = [
      { ...subscription, cancelAtPeriodEnd: true, priceAmountMinor: 9900, currency: "BRL" },
      { ...subscription, id: "annual", userId: "annual", interval: "year", status: "past_due", pastDue: true, priceAmountMinor: 120000, currency: "USD" },
      { ...subscription, id: "trial", userId: "trial", status: "trialing" },
      { ...subscription, id: "ended", userId: "ended", status: "canceled", updatedAt: "2026-09-07T15:00:00Z" },
    ];
    mountView({ subscriptions }, "en");
    fireEvent.change(screen.getByLabelText("Search subscribers"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Filter subscriber status"), { target: { value: "canceling" } });
    // One currency at a time, with no "+" (nothing sums currencies).
    expect(screen.getByText(`${money("en", 99, "BRL")} · ${money("en", 100, "USD")}`)).toBeVisible();
    expect(screen.getByText("2 active")).toBeVisible();
    expect(screen.getByText("25%")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expect(screen.getByLabelText("Buscar suscriptores")).toHaveValue("Maria");
    expect(screen.getByLabelText("Filtrar el estado de los suscriptores")).toHaveValue("canceling");
    expect(screen.getByRole("tab", { name: "Suscriptores" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(`${money("es", 99, "BRL")} · ${money("es", 100, "USD")}`)).toBeVisible();
    expect(screen.getByText("2 activos")).toBeVisible();
    expect(screen.getByText("1 cancelación programada")).toBeVisible();
    expect(screen.getByText("25%")).toBeVisible();
    expect(screen.getAllByText("Maria Silva")).toHaveLength(2);
    expect(screen.getAllByText("Clinical Focus")).toHaveLength(2);
    expect(screen.getAllByText("Se cancela 15 ago 2026")).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "Renovaciones" }));
    expect(screen.getByText("Renovación de Clinical Focus · 15 jul 2026")).toBeVisible();
    expect(screen.getByText("Maria Silva")).toBeVisible();
    expect(screen.getByText(`Bruto ${money("es", 99, "BRL")}`)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Switch to English" }));
    expect(screen.getByRole("tab", { name: "Renewals" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Clinical Focus renewal · Jul 15, 2026")).toBeVisible();
    expect(screen.getByText(`Gross ${money("en", 99, "BRL")}`)).toBeVisible();
    expect(screen.getByText("Maria Silva")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Subscribers" }));
    expect(screen.getByLabelText("Search subscribers")).toHaveValue("Maria");
    expect(screen.getByLabelText("Filter subscriber status")).toHaveValue("canceling");
    expect(screen.getByRole("link", { name: "All sales" })).toHaveAttribute("href", "/teach/sales");
  });

  const subscriptionStatuses = [
    ["active", "Activo"], ["trialing", "En periodo de prueba"], ["past_due", "Pago vencido"],
    ["unpaid", "Sin pagar"], ["canceled", "Cancelado"], ["incomplete", "Incompleta"],
    ["incomplete_expired", "Incompleta y vencida"], ["paused", "En pausa"],
  ] as const;
  it.each(subscriptionStatuses)("translates %s preserving the state and the variant", (status, label) => {
    const { container } = mountView({ subscriptions: [{ ...subscription, status }] }, "en");
    const before = [...container.querySelectorAll("[data-status]")].map((chip) => [chip.getAttribute("data-status"), chip.className]);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    const chips = [...container.querySelectorAll("[data-status]")];
    expect(chips).toHaveLength(2);
    chips.forEach((chip) => expect(chip).toHaveTextContent(label));
    expect(chips.map((chip) => [chip.getAttribute("data-status"), chip.className])).toEqual(before);
  });

  it.each([
    ["all", ["active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"]],
    ["active", ["active", "trialing"]], ["attention", ["past_due", "unpaid"]],
    ["canceling", ["active"]], ["ended", ["canceled", "incomplete_expired", "paused"]],
  ] as const)("keeps the grouping of the %s filter in Spanish", (filter, expected) => {
    const subscriptions = subscriptionStatuses.map(([status], index) => ({ ...subscription, id: `s-${index}`, status, cancelAtPeriodEnd: status === "active" }));
    const { container } = mountView({ subscriptions });
    fireEvent.change(screen.getByLabelText("Filtrar el estado de los suscriptores"), { target: { value: filter } });
    expect([...new Set([...container.querySelectorAll("[data-status]")].map((chip) => chip.getAttribute("data-status")))]).toEqual(expected);
  });

  it.each([
    ["settled", "Registrado"], ["in_release", "Registrado"], ["releasing", "Registrado"],
    ["released", "Registrado"], ["released_advance", "Registrado"], ["disputed", "En disputa"],
    ["refunded", "Reembolsado"], ["partially_refunded", "Reembolso parcial"],
  ] as const)("translates the %s renewal while keeping the value and the state", (status, label) => {
    const { container } = mountView({ ledgers: [{ ...ledger, status }] });
    fireEvent.click(screen.getByRole("tab", { name: "Renovaciones" }));
    expect(screen.getByText(label)).toBeVisible();
    expect(container.querySelector("[data-status]")).toHaveAttribute("data-status", status);
    expect(screen.getByText(`Bruto ${money("es", 99, "BRL")}`)).toBeVisible();
  });

  it("preserves a future state without showing a translation key", () => {
    const { container } = mountView({ subscriptions: [{ ...subscription, status: "future_mode" }] });
    const chips = [...container.querySelectorAll('[data-status="future_mode"]')];
    expect(chips).toHaveLength(2);
    chips.forEach((chip) => expect(chip).toHaveTextContent(/future mode/i));
  });

  it("translates annual frequency and the missing date without changing the normalized price", () => {
    mountView({ subscriptions: [{ ...subscription, interval: "year", currentPeriodEnd: null }] });
    expect(screen.getAllByText("Anual")).toHaveLength(2);
    expect(screen.getAllByText("Se renueva Fecha pendiente")).toHaveLength(2);
    expect(screen.getByText(money("es", 8.25, "BRL"))).toBeVisible();
    expect(screen.getByText("1 activo")).toBeVisible();
    expect(screen.getByText(/1 contrato anterior con precio basado en el historial de facturas/)).toBeVisible();
  });

  it("uses the localized mask and preserves the literal historical ID and title", () => {
    mountView({ profiles: [], orders: [], ledgers: [{ ...ledger, id: "in-$&-{id}", courseId: "course-$&-{date}", createdAt: null }] });
    // With no name, the mask appears once per cell (phone card and table),
    // not twice in the same cell.
    expect(screen.getAllByText("Estudiante ...rner-1")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Renovaciones" }));
    expect(screen.getByText("Renovación de course-$&-{date} · Fecha pendiente")).toBeVisible();
    expect(screen.getByText("ID de la renovación: in-$&-{id}")).toBeInTheDocument();
    expect(screen.getByText("Suscriptor histórico")).toBeVisible();
  });

  it("tells apart no products, no subscribers, no results and no renewals", () => {
    const noProducts = mountView({ subscriptions: [], courses: [] });
    expect(screen.getByText("Todavía no hay productos de suscripción.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Crear producto de suscripción" })).toHaveAttribute("href", "/teach/builder");
    noProducts.unmount();
    const noSubscribers = mountView({ subscriptions: [], orders: [], ledgers: [] });
    expect(screen.getByText("Todavía no hay suscriptores. La actividad de pagos recurrentes aparecerá aquí.")).toBeVisible();
    expect(screen.getByText("Todavía no hay ingresos recurrentes mensuales")).toBeVisible();
    expect(screen.getByText("0 activos")).toBeVisible();
    expect(screen.getByText("0 cancelaciones programadas")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Renovaciones" }));
    expect(screen.getByText("El historial de renovaciones aparece después del pago de la primera factura recurrente.")).toBeVisible();
    noSubscribers.unmount();
    mountView();
    fireEvent.change(screen.getByLabelText("Buscar suscriptores"), { target: { value: "missing" } });
    expect(screen.getByText("Ningún suscriptor coincide con estos filtros.")).toBeVisible();
    expect(screen.getByText(money("es", 99, "BRL"))).toBeVisible();
  });

  it.each(["loading", "error"] as const)("translates the financial state %s", (financialState) => {
    mountView({ financialState });
    expect(screen.getByText(financialState === "loading"
      ? "Cargando los precios registrados de los contratos"
      : "No se pudieron cargar los precios registrados de los contratos")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Renovaciones" }));
    expect(screen.getByText(financialState === "loading"
      ? "Cargando el historial de renovaciones..."
      : "El historial de renovaciones no está disponible.")).toBeVisible();
  });

  it("pluralizes counts and real notices for legacy and priceless contracts", () => {
    const subscriptions: CreatorCourseSubscription[] = [
      { ...subscription, cancelAtPeriodEnd: true },
      { ...subscription, id: "legacy-2", cancelAtPeriodEnd: true },
      { ...subscription, id: "missing-1" }, { ...subscription, id: "missing-2" },
    ];
    mountView({ subscriptions, ledgers: [ledger, { ...ledger, id: "in-2", subscriptionId: "legacy-2" }] });
    const metrics = screen.getByRole("region", { name: "Métricas de suscripción" });
    expect(within(metrics).getByText("4 activos")).toBeVisible();
    expect(within(metrics).getByText("2 cancelaciones programadas")).toBeVisible();
    expect(within(metrics).getByText(/2 contratos anteriores con precio basado en el historial de facturas/)).toBeVisible();
    expect(within(metrics).getByText(/2 contratos sin precio registrado/)).toBeVisible();
    expect(within(metrics).getByText(money("es", 198, "BRL"))).toBeVisible();
  });
});

describe("cycle date in CreatorSubscriptionCenterView", () => {
  function expectCycleInBothLayouts(text: string) {
    const articles = screen.getAllByRole("article")
      .filter((article) => within(article).queryByText("Maria Silva"));
    expect(articles).toHaveLength(1);
    expect(within(articles[0]).getByText(text)).toBeInTheDocument();
    const row = within(screen.getByRole("table")).getByRole("row", { name: /Maria Silva/ });
    expect(within(row).getByRole("cell", { name: text })).toBeInTheDocument();
  }

  const cycleCases = [
    { status: "active", cancelAtPeriodEnd: false, english: "Renews", spanish: "Se renueva" },
    { status: "active", cancelAtPeriodEnd: true, english: "Cancels", spanish: "Se cancela" },
    { status: "trialing", cancelAtPeriodEnd: false, english: "Renews", spanish: "Se renueva" },
    { status: "trialing", cancelAtPeriodEnd: true, english: "Cancels", spanish: "Se cancela" },
    ...["past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused", "future_mode"]
      .flatMap((status) => [false, true].map((cancelAtPeriodEnd) => ({
        status, cancelAtPeriodEnd, english: "Period end", spanish: "Fin del período",
      }))),
  ];

  it.each(cycleCases)("shows $status with cancelAtPeriodEnd=$cancelAtPeriodEnd in both layouts in EN→ES", ({ status, cancelAtPeriodEnd, english, spanish }) => {
    const { container } = mountView({ subscriptions: [{ ...subscription, status, cancelAtPeriodEnd }] }, "en");
    expectCycleInBothLayouts(`${english} Aug 15, 2026`);
    if (english === "Period end") {
      expect(screen.queryAllByText(/^(Renews|Cancels) /)).toHaveLength(0);
    }

    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expectCycleInBothLayouts(`${spanish} 15 ago 2026`);
    if (spanish === "Fin del período") {
      expect(screen.queryAllByText(/^(Se renueva|Se cancela) /)).toHaveLength(0);
    }
    expect(screen.getAllByText("Maria Silva")).toHaveLength(2);
    expect(screen.getAllByText("Clinical Focus")).toHaveLength(2);
    expect([...container.querySelectorAll("[data-status]")].map((chip) => chip.getAttribute("data-status")))
      .toEqual([status, status]);
  });

  it("uses a neutral header for the cycle date, including for ended contracts", () => {
    mountView({ subscriptions: [{ ...subscription, status: "canceled", cancelAtPeriodEnd: true }] }, "en");
    expect(screen.getByRole("columnheader", { name: "Cycle date" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Next event" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expect(screen.getByRole("columnheader", { name: "Fecha del ciclo" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Próximo evento" })).not.toBeInTheDocument();
  });

  it.each([null, "not-a-date"])("preserves the date fallback %s without inventing a renewal or end", (currentPeriodEnd) => {
    mountView({ subscriptions: [{ ...subscription, status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd }] }, "en");
    expectCycleInBothLayouts("Period end Date pending");
    expect(screen.queryAllByText(/^(Renews|Cancels) /)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expectCycleInBothLayouts("Fin del período Fecha pendiente");
    expect(screen.queryAllByText(/^(Se renueva|Se cancela) /)).toHaveLength(0);
    expect(screen.queryByText(/Aug 15, 2026|15 ago 2026/)).not.toBeInTheDocument();
  });

  it("keeps contracts, metrics, search and filter when translating the end date, with no new reads", async () => {
    const contracts: CreatorCourseSubscription[] = [
      { ...subscription, priceAmountMinor: 9900, currency: "BRL" },
      { ...subscription, id: "sub-ended-$&", status: "canceled", cancelAtPeriodEnd: true, updatedAt: "2026-09-07T15:00:00Z" },
    ];
    const originalContracts = contracts.map((contract) => ({ ...contract }));
    reads.subscriptions.mockImplementation((_uid, next) => { next(contracts); return reads.closeSubscriptions; });
    await mountCenter();
    await waitFor(() => expect(screen.getAllByText("Maria Silva")).toHaveLength(4));
    const counts = readCounts();

    fireEvent.change(screen.getByLabelText("Search subscribers"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Filter subscriber status"), { target: { value: "ended" } });
    expectCycleInBothLayouts("Period end Aug 15, 2026");
    expect(screen.getByText(money("en", 99, "BRL"))).toBeVisible();
    expect(screen.getByText("1 active")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expectCycleInBothLayouts("Fin del período 15 ago 2026");
    expect(screen.getByLabelText("Buscar suscriptores")).toHaveValue("Maria");
    expect(screen.getByLabelText("Filtrar el estado de los suscriptores")).toHaveValue("ended");
    expect(screen.getByRole("tab", { name: "Suscriptores" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(money("es", 99, "BRL"))).toBeVisible();
    expect(screen.getByText("1 activo")).toBeVisible();
    expect(screen.getAllByText("Cancelado")).toHaveLength(2);
    expect(readCounts()).toEqual(counts);

    fireEvent.click(screen.getByRole("button", { name: "Switch to English" }));
    expectCycleInBothLayouts("Period end Aug 15, 2026");
    expect(screen.getByLabelText("Search subscribers")).toHaveValue("Maria");
    expect(screen.getByLabelText("Filter subscriber status")).toHaveValue("ended");
    expect(screen.getByText(money("en", 99, "BRL"))).toBeVisible();
    expect(contracts).toEqual(originalContracts);
    expect(readCounts()).toEqual(counts);
  });
});

describe("language switch with no new subscription reads", () => {
  it("keeps the subscriptions and the profiles read after loading", async () => {
    await mountCenter();
    await waitFor(() => expect(screen.getAllByText("Maria Silva")).toHaveLength(2));
    const counts = readCounts();
    fireEvent.change(screen.getByLabelText("Search subscribers"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Filter subscriber status"), { target: { value: "active" } });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expect(screen.getByLabelText("Buscar suscriptores")).toHaveValue("Maria");
    expect(screen.getByLabelText("Filtrar el estado de los suscriptores")).toHaveValue("active");
    expect(screen.getByText(money("es", 99, "BRL"))).toBeVisible();
    expect(readCounts()).toEqual(counts);
  });

  it.each([
    ["subscriptions", "We could not load your subscribers.", "No pudimos cargar tus suscriptores."],
    ["courses", "We could not load subscription products.", "No pudimos cargar los productos de suscripción."],
    ["orders", "Renewal order details are temporarily unavailable.", "Los detalles de los pedidos de renovación no están disponibles temporalmente."],
    ["ledgers", "Renewal payout details are temporarily unavailable.", "Los detalles de los pagos de renovación no están disponibles temporalmente."],
  ] as const)("the %s error follows the language without a new contract per message", async (source, english, spanish) => {
    reads[source].mockImplementation((_uid, _next, onError) => { onError(new Error("Opaque fixture error: wording changed")); return () => {}; });
    await mountCenter();
    await waitFor(() => expect(screen.getByText(english)).toBeVisible());
    const counts = readCounts();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expect(screen.getByText(spanish)).toBeVisible();
    expect(screen.queryByText(english)).toBeNull();
    expect(readCounts()).toEqual(counts);
    expect(screen.queryByText("Opaque fixture error: wording changed")).toBeNull();
  });

  // A read error was a dead end: the sentence and no button, and the sentence stayed on screen
  // even after the read came back (it was the stored "last error").
  it("failing subscribers: Try again re-reads only them, and the notice goes away when they come back", async () => {
    let deliver: (next: CourseSubscription[]) => void = () => {};
    const reload = vi.fn(async () => deliver(viewProps.subscriptions));
    reads.subscriptions.mockImplementation((_uid, next, onError) => {
      deliver = next;
      onError(new Error("subscriptions failed"));
      return Object.assign(() => {}, { reload });
    });
    await mountCenter();
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your subscribers.");
    expect(screen.queryByRole("tab")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText("Maria Silva").length).toBeGreaterThan(0);
  });

  it("renewals that fail: the notice with Try again stays on top and goes away with the re-read", async () => {
    let deliver: (next: Order[]) => void = () => {};
    const reload = vi.fn(async () => deliver(viewProps.orders));
    reads.orders.mockImplementation((_uid, next, onError) => {
      deliver = next;
      onError(new Error("orders failed"));
      return Object.assign(() => {}, { reload });
    });
    await mountCenter();
    expect(screen.getByRole("alert")).toHaveTextContent("Renewal order details are temporarily unavailable.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Renewals" }));
    expect(screen.getByText("Clinical Focus renewal · Jul 15, 2026")).toBeInTheDocument();
  });

  it("while renewals arrive, rows in the renewal format, not a sentence", () => {
    mountView({ financialState: "loading" }, "en");
    fireEvent.click(screen.getByRole("tab", { name: "Renewals" }));
    const waiting = screen.getByRole("status");
    expect(waiting).toHaveTextContent("Loading renewal history...");
    expect(waiting.querySelectorAll("[aria-hidden=true]")).toHaveLength(3);
  });

  it("translates the loading state without restarting the connection", async () => {
    reads.subscriptions.mockImplementation(() => reads.closeSubscriptions);
    reads.courses.mockImplementation(() => reads.closeCourses);
    await mountCenter();
    expect(screen.getByRole("region", { name: "Loading subscriptions" })).toBeVisible();
    const counts = readCounts();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expect(screen.getByRole("region", { name: "Cargando suscripciones" })).toBeVisible();
    expect(readCounts()).toEqual(counts);
  });
});
