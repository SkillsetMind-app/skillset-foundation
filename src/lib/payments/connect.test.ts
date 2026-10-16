import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), assign: vi.fn() }));
vi.mock("@/lib/payments/client-fetch", () => ({ postPaymentRoute: mocks.post }));
import { openTeacherStripeDashboard } from "./connect";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("window", { location: { assign: mocks.assign } });
});
afterEach(() => vi.unstubAllGlobals());

describe("openTeacherStripeDashboard", () => {
  it("requests a fresh link without client account or URL parameters and navigates in the same tab", async () => {
    const url = "https://connect.stripe.com/express/acct_fixture/login";
    mocks.post.mockResolvedValue({ url });
    await openTeacherStripeDashboard();
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/api/payments/connect/login-link");
    expect(mocks.assign).toHaveBeenCalledExactlyOnceWith(url);
  });

  it.each([
    undefined, null, 42, "", "/express/login", "javascript:alert(1)",
    "http://connect.stripe.com/express/login", "https://connect.stripe.com.evil.test/express/login",
    "https://connect.stripe.com@evil.test/express/login", "https://user@connect.stripe.com/express/login",
    "https://connect.stripe.com:444/express/login", "https://dashboard.stripe.com/payments",
    "https://connect.stripe.com/other", "https://evil.test/express/login",
  ])("refuses an invalid destination %#", async (url) => {
    mocks.post.mockResolvedValue({ url });
    await expect(openTeacherStripeDashboard()).rejects.toThrow();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("does not navigate on request failure", async () => {
    mocks.post.mockRejectedValue(new Error("unavailable"));
    await expect(openTeacherStripeDashboard()).rejects.toThrow("unavailable");
    expect(mocks.assign).not.toHaveBeenCalled();
  });
});
