import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CreatorOpsHub } from "@/components/teacher/creator-ops-hub";

const mocks = vi.hoisted(() => ({
  user: { uid: "teacher-1" },
  orders: [] as unknown[], ledgers: [] as unknown[], subscriptions: [] as unknown[],
  subscribeOrders: vi.fn(), subscribeLedgers: vi.fn(), subscribeSubscriptions: vi.fn(),
  exportTable: vi.fn<(props: { filename: string; rows: Record<string, unknown>[] }) => null>(() => null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/orders", () => ({ subscribeToTeacherOrders: mocks.subscribeOrders }));
vi.mock("@/lib/data/payout-ledger", () => ({ subscribeToTeacherPayoutLedger: mocks.subscribeLedgers }));
vi.mock("@/lib/data/course-subscriptions", () => ({ subscribeToTeacherCourseSubscriptions: mocks.subscribeSubscriptions }));
vi.mock("@/components/shared/export-table-button", () => ({ ExportTableButton: mocks.exportTable }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function hub(locale: "en" | "es") {
  return <I18nProvider initialLocale={locale}><ChangeLanguage /><CreatorOpsHub /></I18nProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  const createdAt = new Date().toISOString();
  mocks.orders = [{
    id: "order-1", courseId: "course-1", courseTitle: "Course title $&", courseSlug: "literal-slug",
    userId: "learner-1", teacherId: mocks.user.uid, provider: "stripe", status: "paid",
    amountMinor: 1234567, currency: "USD", platformFeeBps: 1000,
    checkoutSessionId: null, paymentIntentId: null, createdAt,
  }];
  mocks.ledgers = [{
    id: "ledger-1", teacherId: mocks.user.uid, courseId: "course-1", orderId: "order-1", paymentId: "payment-1",
    status: "settled", grossAmountMinor: 1234567, skillsetFeeMinor: 123457, stripeFeeMinor: 10000,
    netAmountMinor: 1101110, currency: "USD", createdAt,
  }];
  mocks.subscriptions = [{
    id: "subscription-1", courseId: "course-1", status: "active", interval: "month",
    priceAmountMinor: 2345678, currency: "EUR",
  }];
  mocks.subscribeOrders.mockImplementation((_uid, onData) => { onData(mocks.orders); return vi.fn(); });
  mocks.subscribeLedgers.mockImplementation((_uid, onData) => { onData(mocks.ledgers); return vi.fn(); });
  mocks.subscribeSubscriptions.mockImplementation((_uid, onData) => { onData(mocks.subscriptions); return vi.fn(); });
});
afterEach(cleanup);

describe("report currency follows the provider without changing amounts or exports", () => {
  it.each(["en", "es"] as const)("formats KPIs and product revenue in %s and keeps the chart total in en-US", locale => {
    render(hub(locale));
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    // Same as creator-reports.test: the chart total matches the shared chart's en-US axis.
    const chart = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    expect(screen.getAllByText(`USD ${number.format(12345.67)}`)).toHaveLength(2);
    expect(screen.getByText(`USD ${number.format(11011.10)}`)).toBeInTheDocument();
    expect(screen.getByText(`EUR ${number.format(23456.78)}`)).toBeInTheDocument();
    // Intl may emit NBSP; exact textContent checks avoid Testing Library whitespace normalization.
    expect(screen.getByText((_text, element) => element?.tagName === "STRONG" && element.textContent === chart.format(12345.67))).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Course title $&")).toBeInTheDocument();
  });

  it("relocalizes KPI and table money without restarting the streams or localizing numeric CSV cells", () => {
    render(hub("en"));
    expect(screen.getAllByText("USD 12,346")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getAllByText("USD 12.346")).toHaveLength(2);
    expect(screen.getByText("USD 11.011")).toBeInTheDocument();
    expect(screen.getByText("EUR 23.457")).toBeInTheDocument();
    expect(screen.getByText("$12,346", { selector: "strong" })).toBeInTheDocument();
    const props = mocks.exportTable.mock.lastCall?.[0];
    expect(props).toMatchObject({
      filename: "skillset-reports",
      rows: [{ Producto: "Course title $&", Pedidos: 1, Ingresos: "12345.67", Moneda: "USD", Reembolsos: 0 }],
    });
    for (const subscribe of [mocks.subscribeOrders, mocks.subscribeLedgers, mocks.subscribeSubscriptions]) {
      expect(subscribe).toHaveBeenCalledTimes(1);
    }
    expect(mocks.orders[0]).toMatchObject({ amountMinor: 1234567, currency: "USD" });
  });
});
