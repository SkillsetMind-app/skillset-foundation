import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpsQueueCounts } from "@/components/admin/ops-overview-metrics";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { resolveOverviewWindow } from "@/domain/ops-overview";

import { OpsOverviewPanel } from "./ops-overview-panel";

const mocks = vi.hoisted(() => ({
  query: "",
  users: vi.fn(), courses: vi.fn(), publications: vi.fn(),
  activations: vi.fn(), enrollments: vi.fn(), orders: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.query),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/data/ops-overview", () => ({
  readOverviewUsers: mocks.users,
  readOverviewCourses: mocks.courses,
  readOverviewPublications: mocks.publications,
  readOverviewActivations: mocks.activations,
  readOverviewEnrollments: mocks.enrollments,
  readOverviewOrders: mocks.orders,
}));

// Fixtures relative to the real clock: a minute ago is always in the 7-day
// window, and the same minute a week earlier is always in the one before it.
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const recent = () => ago(MINUTE);
const lastWeek = () => ago(7 * DAY + MINUTE);

const counts: OpsQueueCounts = {
  pendingVerifications: 2, openTickets: "loading", openReports: "unavailable", openPrivacyRequests: 0,
};

function order(overrides: Record<string, unknown>) {
  return {
    course_id: "course-a", course_title: "Real", status: "paid", amount_minor: 10_000, currency: "USD",
    platform_fee_bps: 1000, refunded_amount_minor: 0, paid_at: recent(), updated_at: recent(), ...overrides,
  };
}

function seed() {
  mocks.users.mockResolvedValue([
    { created_at: recent(), roles: ["student"] },
    { created_at: recent(), roles: ["teacher"] },
    { created_at: lastWeek(), roles: ["student"] },
  ]);
  mocks.courses.mockResolvedValue([
    { id: "course-a", title: "Real", owner_id: "creator-1", status: "published", created_at: recent() },
    { id: "smoke-checkout", title: "Smoke", owner_id: "creator-2", status: "published", created_at: recent() },
  ]);
  mocks.publications.mockResolvedValue([{ target_id: "course-a", created_at: recent(), metadata: { title: "Real" } }]);
  mocks.activations.mockResolvedValue([{ target_id: "creator-1", created_at: recent(), metadata: { amountTotal: 2_500, currency: "usd" } }]);
  mocks.enrollments.mockResolvedValue([
    { course_id: "course-a", course_title: "Real", source: "payment", created_at: recent() },
    { course_id: "course-b", course_title: "Free", source: "free_course", created_at: recent() },
  ]);
  mocks.orders.mockResolvedValue([
    order({}),
    order({ amount_minor: 5_000 }),
    order({ paid_at: lastWeek(), updated_at: lastWeek() }),
    order({ course_id: "smoke-checkout", amount_minor: 99_900 }),
    order({ status: "failed", paid_at: null }),
  ]);
}

function tile(label: string) {
  return screen.getByText(label, { selector: "p" }).closest("[data-tile]") as HTMLElement;
}

async function settle() {
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = "";
  seed();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Overview de /ops", () => {
  it("shows each number with its change against the previous 7 days by default", async () => {
    render(<OpsOverviewPanel counts={counts} />);
    await settle();

    expect(tile("Signups")).toHaveTextContent("2");
    expect(tile("Signups")).toHaveTextContent("+1 vs previous 7 days");
    expect(tile("New creators")).toHaveTextContent("1");
    // smoke- course stays out of every number.
    expect(tile("Courses created")).toHaveTextContent(/^Courses created1/);
    expect(tile("Creators with a published course")).toHaveTextContent("1");
    expect(tile("Enrollments")).toHaveTextContent("1 paid · 1 free");
    expect(tile("Paid orders")).toHaveTextContent("2");
    expect(tile("Gross sales")).toHaveTextContent("$150.00");
    expect(tile("Gross sales")).toHaveTextContent("+$50.00 vs previous 7 days");
    // $10 + $5 platform fees, plus one $25 activation fee.
    expect(tile("Platform revenue")).toHaveTextContent("$40.00");
    expect(tile("Platform revenue")).toHaveTextContent("Platform fees plus 1 activation fees");
    expect(tile("Failed payments")).toHaveTextContent("1");
  });

  it("colors a rise in failed payments as bad and a rise in signups as good, with an arrow too", async () => {
    render(<OpsOverviewPanel counts={counts} />);
    await settle();
    const signups = within(tile("Signups")).getByText(/vs previous 7 days/);
    const failed = within(tile("Failed payments")).getByText(/vs previous 7 days/);
    expect(signups).toHaveClass("text-[var(--color-success-fg)]");
    expect(failed).toHaveClass("text-[var(--color-danger-fg)]");
    expect(signups).toHaveTextContent("▲");
  });

  it("keeps the rest of the page when one read fails", async () => {
    mocks.orders.mockRejectedValue(new Error("Private database detail"));
    render(<OpsOverviewPanel counts={counts} />);
    await settle();

    for (const label of ["Paid orders", "Gross sales", "Refunds", "Failed payments", "Platform revenue"]) {
      expect(tile(label)).toHaveTextContent("Could not load this number.");
    }
    expect(tile("Signups")).toHaveTextContent("+1 vs previous 7 days");
    expect(tile("Enrollments")).toHaveTextContent("1 paid · 1 free");
    expect(screen.queryByText("Private database detail")).toBeNull();
  });

  it("isolates a read that throws before returning a promise", async () => {
    mocks.users.mockImplementation(() => { throw new Error("Supabase is not configured"); });
    render(<OpsOverviewPanel counts={counts} />);
    await settle();
    expect(tile("Signups")).toHaveTextContent("Could not load this number.");
    expect(tile("Paid orders")).toHaveTextContent("2");
  });

  it("gives up on a read that hangs, without blocking the others", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mocks.users.mockReturnValue(new Promise(() => {}));
    render(<OpsOverviewPanel counts={counts} />);
    await settle();
    expect(within(tile("Signups")).getByRole("status")).toHaveTextContent("Loading");
    expect(tile("Paid orders")).toHaveTextContent("2");
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(tile("Signups")).toHaveTextContent("Could not load this number.");
  });

  it("shows zero and no change instead of blanks when nothing happened", async () => {
    for (const read of [mocks.users, mocks.courses, mocks.publications, mocks.activations, mocks.enrollments, mocks.orders]) {
      read.mockResolvedValue([]);
    }
    render(<OpsOverviewPanel counts={counts} />);
    await settle();
    expect(tile("Signups")).toHaveTextContent("0");
    expect(tile("Signups")).toHaveTextContent("No change vs previous 7 days");
    expect(tile("Gross sales")).toHaveTextContent("Nothing in this period");
  });

  it("reads the period from the URL and asks only for the window it compares", async () => {
    mocks.query = "tab=overview&period=30d";
    render(<OpsOverviewPanel counts={counts} />);
    await settle();
    const period = screen.getByRole("navigation", { name: "Period" });
    expect(within(period).getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "page");
    expect(within(period).getByRole("link", { name: "Today" })).toHaveAttribute("href", "/ops?tab=overview&period=today");
    expect(tile("Signups")).toHaveTextContent("vs previous 30 days");
    const expected = new Date(resolveOverviewWindow("30d").previousStart).toISOString();
    expect(mocks.users).toHaveBeenCalledWith(expected);
    expect(mocks.orders).toHaveBeenCalledWith(expected);
  });

  it("draws a per-day trend for 7 and 30 days but not for today", async () => {
    const { unmount } = render(<OpsOverviewPanel counts={counts} />);
    await settle();
    const trend = within(tile("Signups")).getByRole("img");
    expect(trend.getAttribute("aria-label")).toMatch(/^Per day: (\d+, ){6}\d+$/);
    unmount();

    mocks.query = "period=today";
    render(<OpsOverviewPanel counts={counts} />);
    await settle();
    expect(within(tile("Signups")).queryByRole("img")).toBeNull();
    expect(tile("Signups")).toHaveTextContent("vs same time yesterday");
  });

  it("links each open queue to its tab and keeps loading and unavailable apart from zero", async () => {
    render(<OpsOverviewPanel counts={counts} />);
    await settle();
    expect(screen.getByRole("link", { name: /Verifications pending\s*2/ })).toHaveAttribute("href", "/ops?tab=verification");
    expect(screen.getByRole("link", { name: /Support tickets open.*Count loading/ })).toHaveAttribute("href", "/ops?tab=support");
    expect(screen.getByRole("link", { name: /Reports open.*Count unavailable/ })).toHaveAttribute("href", "/ops?tab=community");
    expect(screen.getByRole("link", { name: /Privacy requests open\s*0/ })).toHaveAttribute("href", "/ops?tab=users");
  });

  it("translates the panel to Spanish", async () => {
    render(<I18nProvider initialLocale="es"><OpsOverviewPanel counts={counts} /></I18nProvider>);
    await settle();
    expect(await screen.findByRole("heading", { name: "Cómo va el negocio" })).toBeInTheDocument();
    expect(tile("Registros")).toHaveTextContent("vs. los 7 días anteriores");
    expect(tile("Inscripciones")).toHaveTextContent("1 de pago · 1 gratis");
  });
});
