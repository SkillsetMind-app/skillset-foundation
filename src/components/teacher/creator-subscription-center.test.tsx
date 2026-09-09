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

// Referências estáveis: trocar idioma não equivale a trocar usuário/dados.
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
    expect(screen.getByText("BRL 99.00")).toBeInTheDocument();

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
    expect(screen.getByText("Renewal in-1")).toBeInTheDocument();
    expect(screen.getByText(/Maria Silva/)).toBeInTheDocument();
    expect(screen.getByText(/Gross BRL 99.00/)).toBeInTheDocument();
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

describe("jornada de assinaturas no idioma da pessoa", () => {
  it("troca EN↔ES conservando busca, filtro, aba, autores, datas e valores", () => {
    const subscriptions: CreatorCourseSubscription[] = [
      { ...subscription, cancelAtPeriodEnd: true, priceAmountMinor: 9900, currency: "BRL" },
      { ...subscription, id: "annual", userId: "annual", interval: "year", status: "past_due", pastDue: true, priceAmountMinor: 120000, currency: "USD" },
      { ...subscription, id: "trial", userId: "trial", status: "trialing" },
      { ...subscription, id: "ended", userId: "ended", status: "canceled", updatedAt: "2026-09-07T15:00:00Z" },
    ];
    mountView({ subscriptions }, "en");
    fireEvent.change(screen.getByLabelText("Search subscribers"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Filter subscriber status"), { target: { value: "canceling" } });
    expect(screen.getByText("BRL 99.00 + USD 100.00")).toBeVisible();
    expect(screen.getByText("2 active")).toBeVisible();
    expect(screen.getByText("25%")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expect(screen.getByLabelText("Buscar suscriptores")).toHaveValue("Maria");
    expect(screen.getByLabelText("Filtrar el estado de los suscriptores")).toHaveValue("canceling");
    expect(screen.getByRole("tab", { name: "Suscriptores" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("BRL 99.00 + USD 100.00")).toBeVisible();
    expect(screen.getByText("2 activos")).toBeVisible();
    expect(screen.getByText("1 cancelación programada")).toBeVisible();
    expect(screen.getByText("25%")).toBeVisible();
    expect(screen.getAllByText("Maria Silva")).toHaveLength(2);
    expect(screen.getAllByText("Clinical Focus")).toHaveLength(2);
    expect(screen.getAllByText("Se cancela 15 ago 2026")).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "Renovaciones" }));
    expect(screen.getByText("Renovación in-1")).toBeVisible();
    expect(screen.getByText(/Maria Silva \/ Clinical Focus \/ 15 jul 2026/)).toBeVisible();
    expect(screen.getByText("Bruto BRL 99.00")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Switch to English" }));
    expect(screen.getByRole("tab", { name: "Renewals" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Renewal in-1")).toBeVisible();
    expect(screen.getByText("Gross BRL 99.00")).toBeVisible();
    expect(screen.getByText(/Maria Silva \/ Clinical Focus \/ Jul 15, 2026/)).toBeVisible();
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
  it.each(subscriptionStatuses)("traduz %s preservando o estado e a variante", (status, label) => {
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
  ] as const)("mantém o agrupamento do filtro %s em espanhol", (filter, expected) => {
    const subscriptions = subscriptionStatuses.map(([status], index) => ({ ...subscription, id: `s-${index}`, status, cancelAtPeriodEnd: status === "active" }));
    const { container } = mountView({ subscriptions });
    fireEvent.change(screen.getByLabelText("Filtrar el estado de los suscriptores"), { target: { value: filter } });
    expect([...new Set([...container.querySelectorAll("[data-status]")].map((chip) => chip.getAttribute("data-status")))]).toEqual(expected);
  });

  it.each([
    ["settled", "Registrado"], ["in_release", "Registrado"], ["releasing", "Registrado"],
    ["released", "Registrado"], ["released_advance", "Registrado"], ["disputed", "En disputa"],
    ["refunded", "Reembolsado"], ["partially_refunded", "Reembolso parcial"],
  ] as const)("traduz a renovação %s mantendo o valor e o estado", (status, label) => {
    const { container } = mountView({ ledgers: [{ ...ledger, status }] });
    fireEvent.click(screen.getByRole("tab", { name: "Renovaciones" }));
    expect(screen.getByText(label)).toBeVisible();
    expect(container.querySelector("[data-status]")).toHaveAttribute("data-status", status);
    expect(screen.getByText("Bruto BRL 99.00")).toBeVisible();
  });

  it("preserva um estado futuro sem exibir uma chave de tradução", () => {
    const { container } = mountView({ subscriptions: [{ ...subscription, status: "future_mode" }] });
    const chips = [...container.querySelectorAll('[data-status="future_mode"]')];
    expect(chips).toHaveLength(2);
    chips.forEach((chip) => expect(chip).toHaveTextContent(/future mode/i));
  });

  it("traduz frequência anual e a data ausente sem mudar o preço normalizado", () => {
    mountView({ subscriptions: [{ ...subscription, interval: "year", currentPeriodEnd: null }] });
    expect(screen.getAllByText("Anual")).toHaveLength(2);
    expect(screen.getAllByText("Se renueva Fecha pendiente")).toHaveLength(2);
    expect(screen.getByText("BRL 8.25")).toBeVisible();
    expect(screen.getByText("1 activo")).toBeVisible();
    expect(screen.getByText(/1 contrato anterior con precio basado en el historial de facturas/)).toBeVisible();
  });

  it("usa a máscara localizada e preserva ID e título históricos literais", () => {
    mountView({ profiles: [], orders: [], ledgers: [{ ...ledger, id: "in-$&-{id}", createdAt: null }] });
    expect(screen.getAllByText("Estudiante ...rner-1").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Renovaciones" }));
    expect(screen.getByText("Renovación in-$&-{id}")).toBeVisible();
    expect(screen.getByText("Suscriptor histórico / course-1 / Fecha pendiente")).toBeVisible();
  });

  it("distingue falta de produto, de assinantes, de resultados e de renovações", () => {
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
    expect(screen.getByText("BRL 99.00")).toBeVisible();
  });

  it.each(["loading", "error"] as const)("traduz o estado financeiro %s", (financialState) => {
    mountView({ financialState });
    expect(screen.getByText(financialState === "loading"
      ? "Cargando los precios registrados de los contratos"
      : "No se pudieron cargar los precios registrados de los contratos")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Renovaciones" }));
    expect(screen.getByText(financialState === "loading"
      ? "Cargando el historial de renovaciones..."
      : "El historial de renovaciones no está disponible.")).toBeVisible();
  });

  it("pluraliza contagens e avisos reais de contratos legados e sem preço", () => {
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
    expect(within(metrics).getByText("BRL 198.00")).toBeVisible();
  });
});

describe("troca de idioma sem novas leituras de assinaturas", () => {
  it("conserva as subscriptions e a leitura de perfis depois de carregar", async () => {
    await mountCenter();
    await waitFor(() => expect(screen.getAllByText("Maria Silva")).toHaveLength(2));
    const counts = readCounts();
    fireEvent.change(screen.getByLabelText("Search subscribers"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Filter subscriber status"), { target: { value: "active" } });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a español" }));
    expect(screen.getByLabelText("Buscar suscriptores")).toHaveValue("Maria");
    expect(screen.getByLabelText("Filtrar el estado de los suscriptores")).toHaveValue("active");
    expect(screen.getByText("BRL 99.00")).toBeVisible();
    expect(readCounts()).toEqual(counts);
  });

  it.each([
    ["subscriptions", "We could not load your subscribers.", "No pudimos cargar tus suscriptores."],
    ["courses", "We could not load subscription products.", "No pudimos cargar los productos de suscripción."],
    ["orders", "Renewal order details are temporarily unavailable.", "Los detalles de los pedidos de renovación no están disponibles temporalmente."],
    ["ledgers", "Renewal payout details are temporarily unavailable.", "Los detalles de los pagos de renovación no están disponibles temporalmente."],
  ] as const)("o erro de %s acompanha o idioma sem novo contrato por mensagem", async (source, english, spanish) => {
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

  it("traduz o carregamento sem reiniciar a conexão", async () => {
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
