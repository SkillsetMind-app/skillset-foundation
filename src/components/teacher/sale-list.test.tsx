import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/domain/order";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

import { SaleList } from "./sale-list";

// What the person suffered: with zero orders the sales page swapped everything for
// a 5-line empty card. No period, no search, no filter, no
// export — and no word on WHICH slice it was talking about. With orders,
// refunding money meant leaving here and hunting for the payment in Stripe by hand.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const DAY = 24 * 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
  // The SAME object on every render: a new user per render resubscribes the
  // effect and loops.
  user: { uid: "teacher-1", displayName: "Patricia", roles: ["teacher"] },
  orders: [] as Order[],
  openStripe: vi.fn(),
  // The first read fails; "Try again" reads again through the same channel.
  ordersFail: false,
  reload: vi.fn(),
  // The live channel: a later re-read that fails arrives through here.
  failLater: null as ((error: Error) => void) | null,
}));

vi.mock("@/lib/payments/connect", () => ({ openTeacherStripeDashboard: mocks.openStripe }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, status: "authenticated" }),
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (
    _uid: string,
    onData: (orders: Order[]) => void,
    onError: (error: Error) => void,
  ) => {
    mocks.failLater = onError;
    if (mocks.ordersFail) onError(new Error("orders down"));
    else onData(mocks.orders);
    return Object.assign(() => undefined, { reload: mocks.reload });
  },
}));

function order(overrides: Partial<Order>): Order {
  return {
    id: "order-1",
    userId: "buyer-1",
    teacherId: "teacher-1",
    courseId: "course-1",
    courseSlug: "facilitation",
    courseTitle: "Facilitation Fundamentals",
    amountMinor: 12000,
    currency: "USD",
    platformFeeBps: 0,
    status: "paid",
    provider: "stripe",
    checkoutSessionId: "cs_1",
    paymentIntentId: "pi_123",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mocks.orders = [];
  mocks.openStripe.mockReset();
  mocks.ordersFail = false;
  mocks.reload.mockReset();
});

describe("SaleList", () => {
  // A failure is not "no sales": the error with "Try again", which reads again through the
  // same channel (before, the only way out was reloading the page).
  it("a failed read shows the error with Try again, never the empty state", () => {
    mocks.ordersFail = true;
    render(<SaleList />);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your sales.");
    expect(screen.queryByLabelText("Filter by period")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // A re-read that fails with the table on screen does not erase the good sales: the
  // notice with "Try again" appears on top of them.
  it("a failed background re-read keeps the rows, with the alert and Try again above them", () => {
    mocks.orders = [order({})];
    render(<SaleList />);
    expect(screen.getAllByText("Facilitation Fundamentals").length).toBeGreaterThan(0);

    act(() => mocks.failLater?.(new Error("re-read down")));

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your sales.");
    expect(screen.getAllByText("Facilitation Fundamentals").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Filter by period")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    // The table stays on screen while it reads again (no going back to "loading").
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText("Facilitation Fundamentals").length).toBeGreaterThan(0);
  });

  it("keeps the operating frame and names the period with zero orders", () => {
    render(<SaleList />);

    expect(screen.getByLabelText("Filter by period")).toHaveValue("30d");
    // The search had min-w-0: at 390 px it became a 35 px box between the two
    // selects. With a minimum it wraps to the next line, at full width.
    expect(screen.getByLabelText("Search sales by course or order id")).toHaveClass(
      "min-w-[12rem]",
    );
    expect(screen.getByLabelText("Filter by status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeDisabled();

    // The default skin of the fields (a 1.5px border that shows on white), without the
    // full width that would break the row. The modifier has to come after
    // .field-input in the stylesheet to beat its width: 100%.
    for (const label of ["Filter by period", "Search sales by course or order id", "Filter by status"]) {
      expect(screen.getByLabelText(label), label).toHaveClass("field-input", "field-input--inline");
    }
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const inline = css.indexOf(".field-input--inline {");
    expect(inline).toBeGreaterThan(css.indexOf(".field-input {"));
    expect(css.slice(inline, css.indexOf("}", inline))).toMatch(/width: auto;[\s\S]*min-height: 44px;/);

    // The count line states the slice: "0 orders between <from> and <to>".
    expect(screen.getByText(/^0 orders between .+ and .+$/)).toBeInTheDocument();

    // No sales ever: the receipt scene is a single sentence, without the 5-line
    // paragraph about the Stripe model.
    expect(screen.getByRole("heading", { name: "Your sales will show up here." })).toBeInTheDocument();
    expect(document.querySelector('svg[data-scene="noSales"]')).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("link", { name: "Go to your products" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/settlement and payout timing/i)).toBeNull();
    // With no orders, "Open my Stripe" could only return "connect Stripe".
    expect(screen.queryByRole("button", { name: "Open my Stripe" })).toBeNull();
    // And the sentence that tells people to open Stripe goes away with the button.
    expect(screen.queryByText(/Open your Stripe dashboard to find the payment/)).toBeNull();
  });

  it("names the period when there were sales, just not in it", () => {
    mocks.orders = [order({ id: "order-old", createdAt: new Date(Date.now() - 200 * DAY).toISOString() })];
    render(<SaleList />);

    expect(screen.getByText("No sales in this period.")).toBeInTheDocument();
    expect(
      screen.getByText("When a learner completes checkout, the order appears here."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your sales will show up here.")).toBeNull();
  });

  it("lists the orders as one table, newest first, each row opening its sale", () => {
    mocks.orders = [
      order({
        id: "order-1",
        paymentIntentId: "pi_123",
        createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
      }),
      order({
        id: "order-2",
        courseTitle: "Group Work",
        status: "refunded",
        paymentIntentId: "pi_456",
        createdAt: new Date(Date.now() - DAY).toISOString(),
      }),
    ];

    render(<SaleList />);

    expect(screen.getByText(/^2 orders between .+ and .+$/)).toBeInTheDocument();

    // Before: 50 loose cards, no columns. Now a table with a header.
    const table = screen.getByRole("table", { name: "Your sales, newest first" });
    expect(
      within(table).getAllByRole("columnheader").map((head) => head.textContent),
    ).toEqual(["Product", "Order", "Status", "Date", "Amount", "Actions"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Group Work");
    expect(rows[0]).toHaveTextContent("#ORDER-2");
    // The product is the row header and, again, the link to the sale.
    const product = within(rows[0]).getByRole("rowheader");
    expect(within(product).getByRole("link", { name: "Group Work" })).toHaveAttribute("href", "/teach/sales/order-2");

    const viewLinks = within(table).getAllByRole("link", { name: /^View sale/ });
    expect(viewLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/teach/sales/order-2",
      "/teach/sales/order-1",
    ]);
    // The refund help appears once, above; not repeated on every row.
    expect(screen.queryByRole("link", { name: "Refund options" })).toBeNull();
    expect(screen.getAllByText(/Open your Stripe dashboard to find the payment/)).toHaveLength(1);

    // The chip, not the "Refunded" option of the status filter.
    expect(
      within(table).getByText("Refunded", { selector: "span.status-chip" }),
    ).toHaveAttribute("data-status", "refunded");
    expect(screen.getByRole("button", { name: /export/i })).toBeEnabled();
  });

  // Money: each order in its own currency, right-aligned, without adding currencies together.
  // A partial refund shows the amount charged (as before) and the status badge.
  it("shows each amount in the order's own currency, right-aligned, with the refund state", () => {
    mocks.orders = [
      order({ id: "order-brl", amountMinor: 9900, currency: "BRL", createdAt: new Date(Date.now() - DAY).toISOString() }),
      order({
        id: "order-part",
        amountMinor: 12000,
        refundedAmountMinor: 3000,
        status: "partially_refunded",
        createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
      }),
    ];

    render(<SaleList />);

    const [brl, partial] = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const brlAmount = within(brl).getByText(
      new Intl.NumberFormat("en", { style: "currency", currency: "BRL" }).format(99),
    );
    expect(brlAmount).toHaveClass("text-right", "num");
    expect(within(partial).getByText("$120.00")).toHaveClass("text-right");
    expect(within(partial).getByText("Partially refunded", { selector: "span.status-chip" })).toBeInTheDocument();
    expect(screen.queryByText(/\$219|\$90\.00/)).toBeNull();
  });

  // At 360px the 640px table hid the amount and the only link in the side
  // scroll. Narrow card: each sale becomes a block with a title link, badge,
  // date and amount; the table only appears when the card is wide enough for it.
  it("in a narrow card, shows each sale as a short block with the link and the amount", () => {
    mocks.orders = [
      order({ id: "order-a", courseTitle: "Group Work", amountMinor: 4900, createdAt: new Date(Date.now() - DAY).toISOString() }),
      order({ id: "order-b", status: "partially_refunded", refundedAmountMinor: 1000, createdAt: new Date(Date.now() - 2 * DAY).toISOString() }),
    ];

    render(<SaleList />);

    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("hidden", "@2xl:block");
    const list = screen.getAllByRole("list").find((item) => item.className.includes("@2xl:hidden"))!;
    expect(list).toBeDefined();
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first).getByRole("link", { name: "Group Work" })).toHaveAttribute("href", "/teach/sales/order-a");
    expect(within(first).getByText("$49.00")).toHaveClass("num", "text-right");
    expect(within(second).getByText("$120.00")).toBeInTheDocument();
    expect(within(second).getByText("Partially refunded", { selector: "span.status-chip" })).toBeInTheDocument();
  });

  // The table shows "#1A2B3C4D"; the stored id has no "#". Pasting the code
  // from the screen has to find the sale, regardless of case.
  it("finds a sale by the short code shown in the table, with or without #", () => {
    mocks.orders = [
      order({ id: "order-abcd1234", courseTitle: "Group Work" }),
      order({ id: "order-ffff0000", courseTitle: "Other" }),
    ];

    render(<SaleList />);

    const search = screen.getByLabelText("Search sales by course or order id");
    for (const value of ["#ABCD1234", "abcd1234", " #abcd1234 "]) {
      fireEvent.change(search, { target: { value } });
      const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
      expect(rows, value).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("#ABCD1234");
    }
  });

  it.each(["en", "es"] as const)("opens the shared Stripe action only on click, with conditional refund guidance (%s)", async (locale) => {
    const dictionary = getDictionary(locale);
    mocks.orders = [order({})];
    render(<I18nProvider initialLocale={locale}><SaleList /></I18nProvider>);
    expect(mocks.openStripe).not.toHaveBeenCalled();
    expect(screen.getByText(translate(dictionary, "stripeDashboard.refundGuidance"))).toBeVisible();
    expect(screen.getByRole("link", { name: translate(dictionary, "stripeDashboard.refundSupport") })).toHaveAttribute("href", "/support");
    expect(document.querySelector('a[href^="https://dashboard.stripe.com"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: translate(dictionary, "stripeDashboard.open") }));
    await waitFor(() => expect(mocks.openStripe).toHaveBeenCalledTimes(1));
  });
});
