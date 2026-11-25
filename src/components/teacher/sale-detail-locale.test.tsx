import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { Order } from "@/domain/order";
import { SaleDetail } from "./sale-detail";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), refresh: vi.fn(), copy: vi.fn(), openStripe: vi.fn(), user: { uid: "teacher-1", roles: ["teacher"] } }));
vi.mock("@/lib/payments/connect", () => ({ openTeacherStripeDashboard: mocks.openStripe }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/orders", () => ({ subscribeToOrder: mocks.subscribe }));
const order: Order = {
  id: "order-$&-12345678", userId: "learner-1", teacherId: "teacher-1", courseId: "course-1", courseSlug: "original-course",
  courseTitle: "Original $& {id} course", amountMinor: 12345, currency: "USD", platformFeeBps: 1000,
  status: "paid", provider: "stripe", checkoutSessionId: "cs_$&", paymentIntentId: "pi_$&",
  createdAt: "2026-09-10T12:00:00Z", updatedAt: "2026-09-10T13:00:00Z",
};
function Language() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}
function mount() { return render(<I18nProvider initialLocale="es"><Language /><SaleDetail orderId={order.id} /></I18nProvider>); }
function switchLanguage() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { uid: "teacher-1", roles: ["teacher"] };
  mocks.subscribe.mockImplementation((_id, callback) => { callback(order); return () => {}; });
  mocks.copy.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.copy } });
});
afterEach(cleanup);

describe("sale detail with real EN/ES dictionaries", () => {
  it("requires integrated keys and translates payment, timeline and accessible copy labels", () => {
    expect(translate(getDictionary("es"), "saleDetail.sale")).toBe("Venta");
    expect(translate(getDictionary("en"), "saleDetail.sale")).toBe("Sale");
    const view = mount();
    expect(screen.getByRole("heading", { name: "Pedido #12345678" })).toBeVisible();
    for (const text of ["Cliente", "Cuenta del estudiante", "Pago", "Cronología", "Acciones", "Pedido creado", "Pago completado", "Inscripción activada", "Cobro creado en tu cuenta de Stripe"]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText(/sin retención por parte de SkillsetMind/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Copiar identificador del pedido" })).toHaveTextContent(order.id);
    expect(screen.getByRole("button", { name: "Copiar identificador del intento de pago" })).toHaveTextContent("pi_$&");
    expect(screen.getByText("Sesión de Stripe cs_$&")).toBeVisible();
    expect(screen.getByRole("heading", { name: order.courseTitle })).toBeVisible();
    const amount = screen.getByText("Importe").parentElement!.querySelector("p:last-child")!;
    expect(amount.textContent).toBe(new Intl.NumberFormat("es", { style: "currency", currency: "USD" }).format(123.45));
    const dates = screen.getByText(/^Creado /);
    expect(dates).toHaveTextContent(new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.createdAt as string)));
    const refund = screen.getByRole("link", { name: "Ayuda con el reembolso" });
    const params = new URL(refund.getAttribute("href")!).searchParams;
    expect(params.get("subject")).toBe(`Solicitud de reembolso - pedido ${order.id}`);
    expect(params.get("body")).toBe(`Por favor, ayúdenme a tramitar un reembolso del pedido ${order.id} (${order.courseTitle}).`);
    expect(screen.getByRole("link", { name: "Ver curso público" })).toHaveAttribute("href", `/courses/${order.courseSlug}`);
    switchLanguage();
    expect(screen.getByText("Amount").parentElement!.querySelector("p:last-child")!.textContent).toBe("$123.45");
    expect(screen.getByRole("heading", { name: order.courseTitle })).toBeVisible();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).not.toContain("saleDetail.");
  });

  it.each(["refunded", "partially_refunded"] as const)("translates %s without changing refund semantics", (status) => {
    mocks.subscribe.mockImplementation((_id, callback) => { callback({ ...order, status }); return () => {}; });
    mount();
    expect(screen.getByText("Reembolso registrado")).toBeVisible();
    // The commission only comes back when the refund goes through SkillsetMind.
    const refundDetail = screen.getByText(/Se descontó de tu propio saldo de Stripe/);
    expect(refundDetail).toHaveTextContent("Si el reembolso se hizo a través de SkillsetMind, se te devolvió la comisión de SkillsetMind");
    expect(refundDetail).toHaveTextContent("un reembolso hecho directamente en tu panel de Stripe no la devuelve");
    expect(screen.queryByText("Inscripción activada")).toBeNull();
    switchLanguage();
    expect(screen.getByText("Refund recorded")).toBeVisible();
  });

  // Before, the order code was the largest text on the screen and the net amount was the
  // size of the value and the fee; and there was no way back to Sales.
  it("makes the net the strongest figure, keeps the order code small and links back to sales", () => {
    mount();
    const net = screen.getByText("Neto antes de la comisión de Stripe").parentElement!.querySelector("p:last-child")!;
    expect(net.textContent).toBe(new Intl.NumberFormat("es", { style: "currency", currency: "USD" }).format(111.11));
    expect(net).toHaveClass("text-3xl");
    const amount = screen.getByText("Importe").parentElement!.querySelector("p:last-child")!;
    expect(amount).not.toHaveClass("text-3xl");
    expect(screen.getByRole("heading", { name: "Pedido #12345678" })).toHaveClass("text-sm");
    expect(screen.getByRole("link", { name: "Volver a ventas" })).toHaveAttribute("href", "/teach/sales");
    switchLanguage();
    expect(screen.getByRole("link", { name: "Back to sales" })).toHaveAttribute("href", "/teach/sales");
  });

  // The big number cannot show money that was not kept: a partial refund
  // counts the amount minus what was returned (like Earnings), and what is not revenue
  // (fully refunded, pending) has no big number.
  describe("money by order state (EN)", () => {
    function show(overrides: Partial<Order>) {
      mocks.subscribe.mockImplementation((_id, callback) => { callback({ ...order, ...overrides }); return () => {}; });
      render(<I18nProvider initialLocale="en"><SaleDetail orderId={order.id} /></I18nProvider>);
    }
    const figure = (label: string) =>
      screen.getByText(label, { selector: "p" }).parentElement!.querySelector("p:last-child")!.textContent;
    const headline = () => document.querySelector("p.text-3xl");

    it("paid: the net is the headline", () => {
      show({ status: "paid" });
      expect(headline()).toHaveTextContent("$111.11");
      expect(figure("Net before Stripe fee")).toBe("$111.11");
      expect(figure("Amount")).toBe("$123.45");
      expect(figure("SkillsetMind fee")).toBe("$12.34");
      expect(screen.queryByText("Refunded", { selector: "p" })).toBeNull();
    });

    it("partially refunded $120 - $30: headline from what was kept, fee as charged, refund shown", () => {
      show({ status: "partially_refunded", amountMinor: 12000, refundedAmountMinor: 3000 });
      expect(headline()).toHaveTextContent("$78.00");
      expect(figure("Net after refund, before Stripe fee")).toBe("$78.00");
      expect(figure("Amount")).toBe("$120.00");
      expect(figure("Refunded")).toBe("−$30.00");
      expect(figure("SkillsetMind fee")).toBe("$12.00");
      expect(screen.queryByText("Net before Stripe fee")).toBeNull();
    });

    it("fully refunded: no headline, the three small figures plus the refund", () => {
      show({ status: "refunded", amountMinor: 12000, refundedAmountMinor: 12000 });
      expect(headline()).toBeNull();
      expect(figure("Amount")).toBe("$120.00");
      expect(figure("Refunded")).toBe("−$120.00");
      expect(figure("SkillsetMind fee")).toBe("$12.00");
      expect(figure("Net before Stripe fee")).toBe("$108.00");
    });

    it("pending: no headline and no refund line", () => {
      show({ status: "pending", amountMinor: 12000 });
      expect(headline()).toBeNull();
      expect(figure("Amount")).toBe("$120.00");
      expect(figure("SkillsetMind fee")).toBe("$12.00");
      expect(figure("Net before Stripe fee")).toBe("$108.00");
      expect(screen.queryByText("Refunded", { selector: "p" })).toBeNull();
    });
  });

  it("sends a missing sale back to the sales list", () => {
    mocks.subscribe.mockImplementation((_id, callback) => { callback(null); return () => {}; });
    mount();
    expect(screen.getByRole("link", { name: "Volver a ventas" })).toHaveAttribute("href", "/teach/sales");
  });

  it("translates pending dates and unavailable identifiers", () => {
    mocks.subscribe.mockImplementation((_id, callback) => { callback({ ...order, status: "pending", createdAt: undefined, updatedAt: undefined, checkoutSessionId: null, paymentIntentId: null }); return () => {}; });
    mount();
    expect(screen.getAllByText("No disponible")).toHaveLength(2);
    expect(screen.getByText(/^Creado /)).toHaveTextContent("Fecha pendiente");
    expect(screen.queryByText("Inscripción activada")).toBeNull();
    switchLanguage();
    expect(screen.getAllByText("Not available")).toHaveLength(2);
  });

  it("relocalizes loading and a later subscription error", async () => {
    mocks.subscribe.mockImplementation(() => () => {});
    mount();
    // The wait is a skeleton shaped like the sale; the sentence is left for the screen reader.
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-skeleton", "detail");
    expect(status).toHaveTextContent("Cargando venta...");
    switchLanguage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading sale...");
    await act(async () => mocks.subscribe.mock.calls[0][2](new Error("internal")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load this sale.");
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar esta venta.");
  });

  // F-11: a read failure was a dead end (only "Back to sales"); now "Try
  // again" subscribes to the same read again. A sale that does not exist does not offer it.
  it("load error offers Try again, which subscribes again and shows the sale", async () => {
    mocks.subscribe.mockImplementationOnce((_id, _callback, onError) => { onError(new Error("down")); return () => {}; });
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar esta venta.");
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: order.courseTitle })).toBeVisible();
  });

  it("a missing sale does not offer Try again", () => {
    mocks.subscribe.mockImplementation((_id, callback) => { callback(null); return () => {}; });
    mount();
    expect(screen.queryByRole("button", { name: "Intentar de nuevo" })).toBeNull();
  });

  it("keeps course id, slug and currency in a collapsed support block and the e-mails as text links", () => {
    mount();
    const details = screen.getByText("Detalles para soporte").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(order.courseId);
    expect(details).toHaveTextContent(order.courseSlug);
    expect(details).toHaveTextContent(order.currency);
    for (const name of ["Contactar con soporte", "Ayuda con el reembolso"]) {
      expect(screen.getByRole("link", { name })).not.toHaveClass("button-outline");
    }
    switchLanguage();
    expect(screen.getByText("Details for support")).toBeInTheDocument();
  });

  it("translates missing and forbidden sales without exposing order data", () => {
    mocks.subscribe.mockImplementation((_id, callback) => { callback(null); return () => {}; });
    const view = mount();
    expect(screen.getByRole("alert")).toHaveTextContent("Venta no encontrada.");
    view.unmount();
    mocks.subscribe.mockImplementation((_id, callback) => { callback(order); return () => {}; });
    mocks.user = { uid: "unrelated", roles: ["student"] };
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes acceso a esta venta.");
    expect(screen.queryByText(order.courseTitle)).toBeNull();
    expect(screen.queryByRole("button", { name: /Copiar/ })).toBeNull();
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("You do not have access to this sale.");
  });

  it.each([["learner-1", "student"], ["other-admin", "admin"]])("preserves authorized access for %s", (uid, role) => {
    mocks.user = { uid, roles: [role] };
    mount();
    expect(screen.getByRole("heading", { name: order.courseTitle })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Abrir mi Stripe" })).toBeNull();
    expect(screen.getByRole("link", { name: "Solicitar reembolso" })).toBeVisible();
  });

  it("uses the same EN/ES refund guidance as the list and opens only the teacher's own Stripe on click", async () => {
    mount();
    expect(mocks.openStripe).not.toHaveBeenCalled();
    expect(screen.getByText(translate(getDictionary("es"), "stripeDashboard.refundGuidance"))).toBeVisible();
    expect(document.getElementById("sale-refund")).toContainElement(screen.getByRole("button", { name: "Abrir mi Stripe" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir mi Stripe" }));
    await act(async () => {});
    expect(mocks.openStripe).toHaveBeenCalledTimes(1);
    switchLanguage();
    expect(screen.getByText(translate(getDictionary("en"), "stripeDashboard.refundGuidance"))).toBeVisible();
    expect(screen.getByRole("button", { name: "Open my Stripe" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Get refund help" })).toHaveAttribute("href", expect.stringContaining("mailto:support@skillsetmind.com?subject="));
  });

  it("copies literal IDs and relocalizes success and clipboard failure", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copiar identificador del pedido" }));
    expect(await screen.findByText("Copiado")).toBeVisible();
    expect(mocks.copy).toHaveBeenCalledWith(order.id);
    switchLanguage();
    expect(screen.getByRole("button", { name: "Copy order ID" })).toHaveTextContent("Copied");
    mocks.copy.mockRejectedValue(new Error("permission denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy payment intent ID" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy the ID.");
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos copiar el identificador.");
  });
});
