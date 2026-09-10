// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentRequestError } from "@/lib/payments/client-fetch";
import { acceptPlatformInvite } from "./platform-invites";

const fetchMock = vi.fn<typeof fetch>();
const id = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => { throw new Error("Unexpected fetch in invitation helper test"); });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("acceptPlatformInvite destination allowlist", () => {
  it.each(["/ops", "/learn", "/onboarding?path=teacher"])("accepts exactly the allowed destination %s", async (nextPath) => {
    const result = { next_path: nextPath };
    fetchMock.mockResolvedValueOnce(Response.json(result));
    await expect(acceptPlatformInvite(id)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/invitations/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
  });

  it.each([
    "https://foreign.example.test", "//foreign.example.test", "javascript:alert(1)",
    "/ops/", "/ops?next=https://foreign.example.test", "/ops#fragment", "/learn/../ops",
    "/onboarding", "/onboarding?path=admin", "/onboarding?path=teacher&next=/ops",
    "%2Fops", " /ops", "/OPS", "", null, undefined, 42, ["/ops"],
  ].map((nextPath) => ({ nextPath })))("rejects non-allowlisted next_path $nextPath", async ({ nextPath }) => {
    fetchMock.mockResolvedValueOnce(Response.json({ next_path: nextPath }));
    await expect(acceptPlatformInvite(id)).rejects.toThrow("Invitation destination unavailable.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("encodes the invitation id as one path component", async () => {
    const suppliedId = "other/id?next=/ops#fragment";
    fetchMock.mockResolvedValueOnce(Response.json({ next_path: "/learn" }));
    await acceptPlatformInvite(suppliedId);
    expect(fetchMock).toHaveBeenCalledWith(`/api/invitations/${encodeURIComponent(suppliedId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
  });

  it("preserves an API refusal rather than using even an allowlisted destination", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Invitation unavailable.", next_path: "/ops" }, { status: 403 }));
    const result = acceptPlatformInvite(id);
    await expect(result).rejects.toBeInstanceOf(PaymentRequestError);
    await expect(result).rejects.toMatchObject({ status: 403, message: "Invitation unavailable." });
  });

  it("propagates transport failure without retrying acceptance", async () => {
    const error = new Error("offline");
    fetchMock.mockRejectedValueOnce(error);
    await expect(acceptPlatformInvite(id)).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
