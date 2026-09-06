import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOpsQueueCounts } from "./ops-overview-metrics";
import type { CommunityReport } from "@/domain/community-report";
import type { CreatorVerificationCase } from "@/domain/creator-verification";
import type { SupportTicket } from "@/domain/support-ticket";

type Observer<T> = { next: (rows: T[]) => void; error: (error: Error) => void; stop: ReturnType<typeof vi.fn> };
const mocks = vi.hoisted(() => ({
  verification: null as Observer<CreatorVerificationCase> | null,
  support: null as Observer<SupportTicket> | null,
  reports: null as Observer<CommunityReport> | null,
  subscribeVerification: vi.fn(), subscribeSupport: vi.fn(), subscribeReports: vi.fn(),
  user: { uid: "operator-test", roles: ["admin"] },
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/creator-verification", () => ({ subscribeToVerificationQueue: mocks.subscribeVerification }));
vi.mock("@/lib/data/support-tickets", () => ({ subscribeToAdminSupportTickets: mocks.subscribeSupport }));
vi.mock("@/lib/data/community-posts", () => ({ subscribeToCommunityReports: mocks.subscribeReports }));

const verificationCase: CreatorVerificationCase = {
  id: "case-test", creatorId: "creator-test", status: "pending", profession: "Coach",
  registrationType: "Training", registrationId: "test", registrationRegion: "US",
  evidenceLinks: [], createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z",
};
function ticket(status: SupportTicket["status"], id = status): SupportTicket {
  return { id, status, userId: "learner-test", userEmail: null, userName: null, category: "technical", subject: "Test", message: "Technical test" };
}
function report(status: CommunityReport["status"], id = status): CommunityReport {
  return { id, status, courseSlug: "test-course", postId: "test-post", commentId: null, targetType: "post", targetAuthorId: "author-test", targetAuthorName: "Author", reporterId: "reporter-test", reporterName: "Reporter", reporterEmail: null, reason: "other", detail: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { uid: "operator-test", roles: ["admin"] };
  mocks.verification = mocks.support = mocks.reports = null;
  mocks.subscribeVerification.mockImplementation((next, error) => { mocks.verification = { next, error, stop: vi.fn() }; return mocks.verification.stop; });
  mocks.subscribeSupport.mockImplementation((next, error) => { mocks.support = { next, error, stop: vi.fn() }; return mocks.support.stop; });
  mocks.subscribeReports.mockImplementation((next, error) => { mocks.reports = { next, error, stop: vi.fn() }; return mocks.reports.stop; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("independent Ops queue counts", () => {
  it("does not report unloaded tickets or reports as zero when verification responds first", () => {
    const { result } = renderHook(() => useOpsQueueCounts());
    act(() => mocks.verification!.next([verificationCase]));
    expect(result.current.pendingVerifications).toBe(1);
    expect(result.current.openTickets).toBe("loading");
    expect(result.current.openReports).toBe("loading");
  });

  it("exposes each confirmed count without waiting for another queue", () => {
    const { result } = renderHook(() => useOpsQueueCounts());
    act(() => mocks.support!.next([ticket("open"), ticket("in_review"), ticket("resolved")]));
    expect(result.current.openTickets).toBe(2);
    expect(result.current.pendingVerifications).toBe("loading");
    act(() => mocks.reports!.next([report("open"), report("reviewed"), report("resolved"), report("dismissed")]));
    expect(result.current.openReports).toBe(1);
    act(() => mocks.verification!.next([]));
    expect(result.current.pendingVerifications).toBe(0);
  });

  it("distinguishes a failed queue from zero while keeping other numbers usable", () => {
    const { result } = renderHook(() => useOpsQueueCounts());
    act(() => { mocks.verification!.next([]); mocks.support!.error(new Error("Unavailable")); mocks.reports!.next([report("open")]); });
    expect(result.current.pendingVerifications).toBe(0);
    expect(result.current.openTickets).toBe("unavailable");
    expect(result.current.openReports).toBe(1);
    act(() => mocks.support!.next([]));
    expect(result.current.openTickets).toBe(0);
  });

  it("does not retain a stale number after a later read failure", () => {
    const { result } = renderHook(() => useOpsQueueCounts());
    act(() => mocks.verification!.next([verificationCase]));
    act(() => mocks.verification!.error(new Error("Read failed")));
    expect(result.current.pendingVerifications).toBe("unavailable");
    act(() => mocks.verification!.next([]));
    expect(result.current.pendingVerifications).toBe(0);
  });

  it("handles a synchronous data-client failure without printing private error details", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.subscribeSupport.mockImplementation(() => { throw new Error("Private service detail for this test"); });
    const { result } = renderHook(() => useOpsQueueCounts());
    expect(result.current.openTickets).toBe("unavailable");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("Private service detail");
  });

  it("does not subscribe to queues that a bare ops role cannot read globally", () => {
    mocks.user.roles = ["ops"];
    renderHook(() => useOpsQueueCounts());
    expect(mocks.subscribeVerification).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeSupport).not.toHaveBeenCalled();
    expect(mocks.subscribeReports).not.toHaveBeenCalled();
  });

  it("cleans up the three subscriptions without restarting on a rerender", () => {
    const { rerender, unmount } = renderHook(() => useOpsQueueCounts());
    const observers = [mocks.verification!, mocks.support!, mocks.reports!];
    rerender();
    expect(mocks.subscribeVerification).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeSupport).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeReports).toHaveBeenCalledTimes(1);
    unmount();
    for (const observer of observers) expect(observer.stop).toHaveBeenCalledTimes(1);
  });

  it.each(["support", "moderator"])("also requires the workspace gate before reading counts for %s", (role) => {
    mocks.user.roles = [role];
    renderHook(() => useOpsQueueCounts());
    expect(mocks.subscribeVerification).not.toHaveBeenCalled();
    expect(mocks.subscribeSupport).not.toHaveBeenCalled();
    expect(mocks.subscribeReports).not.toHaveBeenCalled();
  });

  it("clears old counts and ignores late responses after the account changes", () => {
    const { result, rerender } = renderHook(() => useOpsQueueCounts());
    act(() => mocks.support!.next([ticket("open")]));
    const previousSupport = mocks.support!;
    mocks.user = { uid: "another-operator-test", roles: ["admin"] };
    rerender();
    expect(previousSupport.stop).toHaveBeenCalledTimes(1);
    expect(result.current.openTickets).toBe("loading");
    act(() => previousSupport.next([ticket("open"), ticket("in_review")]));
    expect(result.current.openTickets).toBe("loading");
    act(() => mocks.support!.next([]));
    expect(result.current.openTickets).toBe(0);
  });

  it("stops unavailable role scopes and only resubscribes to allowed queues", () => {
    const { result, rerender } = renderHook(() => useOpsQueueCounts());
    const previousSupport = mocks.support!;
    const previousReports = mocks.reports!;
    act(() => previousSupport.next([ticket("open")]));
    mocks.user.roles = ["ops"];
    rerender();
    expect(previousSupport.stop).toHaveBeenCalledTimes(1);
    expect(previousReports.stop).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeSupport).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeReports).toHaveBeenCalledTimes(1);
    expect(result.current.openTickets).toBe("unavailable");
    act(() => previousSupport.next([]));
    expect(result.current.openTickets).toBe("unavailable");
  });

  it.each(["role", "account"])("does not restore a previous count after a %s scope round trip without a response", (transition) => {
    const { result, rerender } = renderHook(() => useOpsQueueCounts());
    act(() => mocks.support!.next([ticket("open")]));
    expect(result.current.openTickets).toBe(1);
    mocks.user = transition === "role"
      ? { uid: "operator-test", roles: ["ops"] }
      : { uid: "another-operator-test", roles: ["admin"] };
    rerender();
    mocks.user = { uid: "operator-test", roles: ["admin"] };
    rerender();
    expect(result.current.openTickets).toBe("loading");
    act(() => mocks.support!.next([]));
    expect(result.current.openTickets).toBe(0);
  });
});
