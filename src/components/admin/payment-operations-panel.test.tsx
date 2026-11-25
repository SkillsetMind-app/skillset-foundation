import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    // The table (wide card) and the blocks (narrow card) show the same
    // orders; CSS shows one of the two. The count is by design.
    const table = screen.getByRole("table", { name: "Pedidos recientes de Stripe" });
    expect(within(table).getAllByText("Pagado")).toHaveLength(2);
    expect(within(table).getByText("Pendiente")).toBeInTheDocument();
    // I-06: labeled parts; short buyer (full in the title and in the record),
    // full order, selectable.
    const first = screen.getAllByRole("article")[0];
    const part = (label: string) => within(first).getByText(label, { selector: "dt" }).nextElementSibling;
    expect(part("Pedido")).toHaveTextContent(order.id);
    expect(part("Pedido")).toHaveClass("select-all", "break-all");
    expect(within(first).getByRole("link", { name: order.userId })).toHaveAttribute("href", `/ops/users/${encodeURIComponent(order.userId)}`);
    expect(part("Usuario")).toHaveTextContent("learner-…");
    expect(part("Proveedor")).toHaveTextContent("stripe");
    expect(part("Creado el")).toHaveTextContent("—");
    expect(screen.getByTestId("export").textContent).toBe(exportBefore);
    expect(screen.getByTestId("export")).toHaveAttribute("data-filename", "skillset-orders");
    expect(JSON.parse(exportBefore!)[0]).toEqual({ id: order.id, courseTitle: order.courseTitle, userId: order.userId, provider: "stripe", status: "paid", amount: "$100.00", currency: "USD", platformFeeBps: 1000 });
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it("dates each order by payment, else by creation, in the active locale", () => {
    render(panel());
    deliver([
      { ...order, id: "paid", paidAt: "2026-11-18T14:41:00.000Z", createdAt: "2026-11-18T14:30:00.000Z" },
      { ...order, id: "pending", status: "pending", paidAt: null, createdAt: "2026-11-03T18:15:00.000Z" },
    ]);
    const format = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
    // The label says which date it is: the payment date or the order creation date.
    const dates = () => screen.getAllByText(/^(Paid on|Created on|Pagado el|Creado el)$/, { selector: "dt" }).map((term) => [term.textContent, term.nextElementSibling?.textContent]);
    expect(dates()).toEqual([["Paid on", format("2026-11-18T14:41:00.000Z", "en")], ["Created on", format("2026-11-03T18:15:00.000Z", "en")]]);
    language();
    expect(dates()).toEqual([["Pagado el", format("2026-11-18T14:41:00.000Z", "es")], ["Creado el", format("2026-11-03T18:15:00.000Z", "es")]]);
  });

  // I-06: on the wide card the orders are a real table, with date,
  // buyer, course, status and the amount aligned right. Nothing disappears from the
  // block: provider and the full order code stay on the line.
  it("lists orders as a real table with the amount in its own right-aligned column", () => {
    render(panel());
    deliver([{ ...order, paidAt: "2026-11-18T14:41:00.000Z" }, { ...order, id: "order-eur", currency: "EUR", amountMinor: 2500, status: "pending" as const, createdAt: "2026-11-03T18:15:00.000Z" }]);
    const table = screen.getByRole("table", { name: "Recent Stripe orders" });
    expect(table.closest(".hidden")).toHaveClass("@3xl:block");
    expect(screen.getAllByRole("article")[0].parentElement).toHaveClass("@3xl:hidden");
    expect(within(table).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Date", "User", "Course", "Provider", "Status", "Amount"]);
    const [first, second] = within(table).getAllByRole("row").slice(1);
    const format = (iso: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
    // exact textContent: the English time carries a narrow space that
    // toHaveTextContent swaps for a regular space.
    const dateParts = (row: HTMLElement) => [...within(row).getAllByRole("cell")[0].querySelectorAll("span")].map((part) => part.textContent);
    expect(dateParts(first)).toEqual(["Paid on", format("2026-11-18T14:41:00.000Z")]);
    expect(dateParts(second)).toEqual(["Created on", format("2026-11-03T18:15:00.000Z")]);
    expect(within(first).getByRole("rowheader")).toHaveTextContent(`${order.courseTitle}${order.id}`);
    expect(within(first).getByText(order.id)).toHaveClass("select-all");
    expect(within(first).getByRole("link", { name: order.userId })).toHaveAttribute("href", `/ops/users/${encodeURIComponent(order.userId)}`);
    expect(within(first).getByText("stripe")).toBeInTheDocument();
    const amount = within(first).getByText(money(10000, "USD", "en"));
    expect(amount).toHaveClass("text-right", "tabular-nums");
    expect(within(second).getByText(money(2500, "EUR", "en"))).toHaveClass("text-right");
    language();
    expect(within(screen.getByRole("table", { name: "Pedidos recientes de Stripe" })).getAllByRole("columnheader").map((head) => head.textContent))
      .toEqual(["Fecha", "Usuario", "Curso", "Proveedor", "Estado", "Importe"]);
    expect(screen.getByRole("table").querySelector("tbody tr td:last-child")?.textContent).toBe(money(10000, "USD", "es"));
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
