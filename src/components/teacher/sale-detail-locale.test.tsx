import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { Order } from "@/domain/order";
import { SaleDetail } from "./sale-detail";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), refresh: vi.fn(), copy: vi.fn(), user: { uid: "teacher-1", roles: ["teacher"] } }));
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
    const refund = screen.getByRole("link", { name: "Solicitar reembolso" });
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
    expect(screen.getByText(/Se descontó de tu propio saldo de Stripe/)).toHaveTextContent("se te devolvió la comisión de SkillsetMind");
    expect(screen.queryByText("Inscripción activada")).toBeNull();
    switchLanguage();
    expect(screen.getByText("Refund recorded")).toBeVisible();
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
    expect(screen.getByText("Cargando venta...")).toBeVisible();
    switchLanguage();
    expect(screen.getByText("Loading sale...")).toBeVisible();
    await act(async () => mocks.subscribe.mock.calls[0][2](new Error("internal")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load this sale.");
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar esta venta.");
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
