import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentOperationsPanel } from "@/components/admin/payment-operations-panel";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { Order } from "@/domain/order";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/data/orders", () => ({ subscribeToRecentOrders: mocks.subscribe }));
vi.mock("@/components/shared/export-table-button", () => ({ ExportTableButton: ({ filename, rows }: { filename: string; rows: unknown[] }) => <div data-testid="export" data-filename={filename}>{JSON.stringify(rows)}</div> }));

const order: Order = { id: "order-$$-$&", userId: "learner-$$-$&", courseId: "course-a", courseSlug: "course-a", courseTitle: 'Curso $$ $& "Álvarez"', amountMinor: 10000, currency: "USD", platformFeeBps: 1000, status: "paid", provider: "stripe", checkoutSessionId: null, paymentIntentId: null };
function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function panel() { return <I18nProvider initialLocale="en"><ChangeLanguage /><PaymentOperationsPanel /></I18nProvider>; }
function language() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
function deliver(rows = [order]) { act(() => mocks.subscribe.mock.calls[0][0](rows)); }
function money(amount: number, currency: string, locale: string) { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100); }

beforeEach(() => { vi.clearAllMocks(); mocks.subscribe.mockImplementation(() => vi.fn()); });
afterEach(cleanup);

describe("payments presentation and export contract", () => {
  it("keeps currencies separate, preserves fee units and only localizes the screen", () => {
    render(panel());
    const rows = [order, { ...order, id: "order-eur", currency: "EUR", amountMinor: 2500, platformFeeBps: 500 }, { ...order, id: "pending", status: "pending" as const, amountMinor: 90000 }];
    deliver(rows);
    const exportBefore = screen.getByTestId("export").textContent;
    expect(screen.getByText("Gross (last 12 orders)").nextElementSibling?.textContent).toBe(`${money(2500, "EUR", "en")} · ${money(10000, "USD", "en")}`);
    language();
    expect(screen.getByRole("heading", { name: "Seguimiento de pedidos de Stripe." })).toBeInTheDocument();
    expect(screen.getByText("Importe bruto (últimos 12 pedidos)")).toBeInTheDocument();
    expect(screen.getByText("Importe bruto (últimos 12 pedidos)").nextElementSibling?.textContent).toBe(`${money(2500, "EUR", "es")} · ${money(10000, "USD", "es")}`);
    expect(screen.getByText("Comisión estimada (los mismos 12)").nextElementSibling?.textContent).toBe(`${money(125, "EUR", "es")} · ${money(1000, "USD", "es")}`);
    expect(screen.getAllByText("Pagado")).toHaveLength(2);
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText(`Pedido ${order.id} - Usuario ${order.userId} - Proveedor stripe`)).toBeInTheDocument();
    expect(screen.getByTestId("export").textContent).toBe(exportBefore);
    expect(screen.getByTestId("export")).toHaveAttribute("data-filename", "skillset-orders");
    expect(JSON.parse(exportBefore!)[0]).toEqual({ id: order.id, courseTitle: order.courseTitle, userId: order.userId, provider: "stripe", status: "paid", amount: "$100.00", currency: "USD", platformFeeBps: 1000 });
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2])("renders a confirmed %i paid count in Spanish", count => {
    render(panel());
    language();
    deliver(Array.from({ length: count }, (_, index) => ({ ...order, id: `order-${index}` })));
    expect(screen.getByText("Pagados en esta muestra").parentElement).toHaveTextContent(String(count));
    expect(screen.queryAllByRole("article")).toHaveLength(count);
    if (!count) expect(screen.getByText(/Todavía no hay pedidos de Stripe/)).toBeInTheDocument();
  });

  it("distinguishes loading and a read failure from a confirmed empty sample", () => {
    render(panel());
    expect(screen.getByRole("status")).toHaveTextContent("Loading orders");
    expect(screen.getByText("Paid in this sample").parentElement).not.toHaveTextContent("0");
    act(() => mocks.subscribe.mock.calls[0][1](new Error("Private provider detail")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load recent Stripe orders.");
    expect(screen.queryByText(/No Stripe orders yet/)).toBeNull();
    language();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los pedidos recientes de Stripe.");
    expect(screen.getByText("Pagados en esta muestra").parentElement).toHaveTextContent("No disponible");
    deliver([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Todavía no hay pedidos de Stripe/)).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });
});
