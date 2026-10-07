import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillingTabs } from "./billing-tabs";
import { PlansPanel } from "./plans-panel";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { Order } from "@/domain/order";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({
  user: { uid: "learner-1", roles: ["student"] }, tab: "overview", orders: [] as Order[], profile: { currentPlanId: "free", stripeCustomerId: "customer-test" },
  refund: vi.fn(), portal: vi.fn(), replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: mocks.replace }), useSearchParams: () => new URLSearchParams({ tab: mocks.tab }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ status: "authenticated", user: mocks.user }) }));
vi.mock("@/lib/data/orders", () => ({ subscribeToUserOrders: (_uid: string, next: (rows: Order[]) => void) => { next(mocks.orders); return vi.fn(); } }));
vi.mock("@/lib/data/user-profiles", () => ({ subscribeToUserProfile: (_uid: string, next: (profile: typeof mocks.profile) => void) => { next(mocks.profile); return vi.fn(); } }));
vi.mock("@/lib/payments/billing", () => ({ openBillingPortal: mocks.portal, requestOrderRefund: mocks.refund, isCheckoutClientConfigured: () => true }));
vi.mock("@/components/account/upgrade-modal", () => ({ UpgradeModal: () => null }));

function Language() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("en")}>English</button>;
}
function mount(children: React.ReactNode) {
  return render(<I18nProvider initialLocale="es"><Language />{children}</I18nProvider>);
}
const order: Order = {
  id: "order-1", userId: "learner-1", courseId: "course-1", courseSlug: "course", courseTitle: "Original $& course title",
  amountMinor: 1950, currency: "USD", platformFeeBps: 1000, status: "paid", provider: "stripe", checkoutSessionId: null, paymentIntentId: null,
  createdAt: "2026-09-01T12:00:00Z", receiptUrl: "https://example.com/receipt",
};
beforeEach(() => { vi.clearAllMocks(); mocks.tab = "overview"; mocks.orders = []; mocks.user.roles = ["student"]; mocks.refund.mockResolvedValue(undefined); mocks.portal.mockResolvedValue(undefined); });
afterEach(cleanup);

describe("billing locale with real dictionaries", () => {
  // A página é de servidor e serve aluno e criador: o texto não fala de plano de criador.
  it("keeps the billing page copy neutral for learners", () => {
    for (const locale of ["en", "es"] as const) {
      const dictionary = getDictionary(locale);
      const description = translate(dictionary, "accountBillingPage.description");
      expect(description).not.toMatch(/SkillsetMind|Payouts|Pagos e impuestos/);
      expect(description).toContain(locale === "en"
        ? "Payment methods and invoices live in your secure Stripe portal."
        : "Los métodos de pago y las facturas están en tu portal seguro de Stripe.");
    }
    expect(translate(getDictionary("en"), "accountBillingPage.eyebrow")).toBe("Purchases & receipts");
    expect(translate(getDictionary("es"), "accountBillingPage.eyebrow")).toBe("Compras y recibos");
  });

  it("translates overview and navigation without changing route keys", () => {
    mount(<BillingTabs />);
    expect(screen.getByRole("group", { name: "Secciones de facturación" })).toBeTruthy();
    expect(screen.getByText("Gasto total")).toBeTruthy();
    expect(screen.getByText("0 cursos comprados", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compras" }));
    expect(mocks.replace).toHaveBeenCalledWith("/account/billing?tab=purchases", { scroll: false });
  });

  it("translates empty purchases and payment methods", () => {
    mocks.tab = "purchases";
    const first = mount(<BillingTabs />);
    expect(screen.getByRole("heading", { name: "Aún no tienes compras." })).toBeTruthy();
    first.unmount();
    mocks.tab = "payment-methods";
    mount(<BillingTabs />);
    expect(screen.getByRole("heading", { name: "Gestionados de forma segura por Stripe." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gestionar métodos de pago" })).toBeTruthy();
  });

  it("keeps course text and refund identity while translating confirmation and success", async () => {
    mocks.tab = "purchases"; mocks.orders = [order];
    mount(<BillingTabs />);
    expect(screen.getByText(order.courseTitle)).toBeTruthy();
    expect(screen.getByText(new Intl.NumberFormat("es", { style: "currency", currency: "USD" }).format(19.5), { normalizer: (text) => text })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ver recibo/ }).getAttribute("href")).toBe(order.receiptUrl);
    fireEvent.click(screen.getByRole("button", { name: "Solicitar un reembolso" }));
    const modal = screen.getByRole("dialog", { name: "Solicitar un reembolso" });
    expect(document.activeElement).toBe(modal);
    fireEvent.click(within(modal).getByRole("button", { name: "Solicitar reembolso" }));
    await screen.findByText("Reembolso solicitado");
    expect(mocks.refund).toHaveBeenCalledWith("learner-1__course-1");
    expect(within(modal).getByText(order.courseTitle)).toBeTruthy();
    fireEvent.click(within(modal).getByRole("button", { name: "Listo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("relocalizes a policy rejection without retrying or inventing eligibility", async () => {
    mocks.tab = "purchases"; mocks.orders = [order];
    mocks.refund.mockRejectedValue(new Error("The automatic refund window has ended."));
    mount(<BillingTabs />);
    fireEvent.click(screen.getByRole("button", { name: "Solicitar un reembolso" }));
    fireEvent.click(screen.getByRole("button", { name: "Solicitar reembolso" }));
    await screen.findByText("El plazo para solicitar un reembolso automático ha finalizado.");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText("The automatic refund window has ended.")).toBeTruthy();
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });

  it("keeps provider errors private and offers retry in the chosen language", async () => {
    mocks.portal.mockRejectedValue(new Error("private transport details"));
    mount(<BillingTabs />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el portal de Stripe" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No pudimos abrir el portal"));
    expect(screen.queryByText("private transport details")).toBeNull();
    expect(screen.getByRole("button", { name: "Abrir el portal de Stripe" })).toHaveProperty("disabled", false);
  });

  // A learner saw the creator's plan: a Subscription tab and "Active
  // subscription: Free" next to the courses they bought.
  it("a learner sees what they bought, with no creator plan", () => {
    mount(<BillingTabs />);
    expect(screen.queryByRole("button", { name: "Suscripción" })).toBeNull();
    expect(screen.queryByText("Suscripción activa")).toBeNull();
    expect(screen.queryByText(/suscripción Free/i)).toBeNull();
    expect(screen.getByText("Cursos comprados")).toBeTruthy();
    cleanup();
    // An old link straight to the plans tab lands on the overview instead.
    mocks.tab = "subscriptions";
    mount(<BillingTabs />);
    expect(screen.queryByText("Plan actual:")).toBeNull();
    expect(screen.getByText("Gasto total")).toBeTruthy();
  });

  it("a teacher keeps the Subscription tab and the plan line", () => {
    mocks.user.roles = ["student", "teacher"];
    mount(<BillingTabs />);
    expect(screen.getByRole("button", { name: "Suscripción" })).toBeTruthy();
    expect(screen.getByText("Suscripción activa")).toBeTruthy();
    cleanup();
    mocks.tab = "subscriptions";
    mount(<BillingTabs />);
    expect(screen.getByText("Plan actual:")).toBeTruthy();
  });

  it("translates plans and their existing pricing highlights without changing cycle", () => {
    mount(<PlansPanel />);
    expect(screen.getByText("Plan actual:")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Ciclo de facturación" })).toBeTruthy();
    const annual = screen.getByRole("radio", { name: "Anual" });
    fireEvent.click(annual);
    expect(annual.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Mejorar a Starter" })).toBeTruthy();
    expect(screen.queryByText("Start selling without a subscription.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("radio", { name: "Yearly" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Start selling without a subscription.")).toBeTruthy();
  });
});
