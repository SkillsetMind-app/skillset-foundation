import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { deliverPlanTrialEmail } from "./plan-trial-email-delivery";

const key = "trial_started:sub_test";
const payload = '{"from":"sender@example.test","to":["user@example.test"],"text":"Frozen"}';
const rpc = vi.fn();
const fetchMock = vi.fn();
const admin = { rpc } as unknown as SupabaseClient<Database>;
const prepare = vi.fn(async () => payload);
const claim = () => ({ action: "send", payload, token: "attempt-1", send_before: new Date(Date.now() + 60_000).toISOString() });

beforeEach(() => {
  rpc.mockReset().mockResolvedValueOnce({ data: claim(), error: null })
    .mockResolvedValue({ data: true, error: null });
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
  prepare.mockClear();
  vi.stubEnv("RESEND_API_KEY", "re_fixture");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("persisted trial email delivery", () => {
  it.each([null, [], "send", {}, { action: "unknown" },
    { action: "send", payload, token: "attempt-1", send_before: "invalid" },
    { action: "send", payload: {}, token: "attempt-1", send_before: "2099-01-01T00:00:00Z" },
    { action: "send", payload, token: null, send_before: "2099-01-01T00:00:00Z" },
  ])("fails closed for malformed claim output %j", async (data) => {
    rpc.mockReset().mockResolvedValue({ data, error: null });
    await expect(deliverPlanTrialEmail(admin, key, prepare)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("sends the stored body without rebuilding it", async () => {
    await deliverPlanTrialEmail(admin, key, prepare);
    expect(prepare).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].body).toBe(payload);
    expect(rpc).toHaveBeenLastCalledWith("finish_plan_trial_email", {
      p_key: key, p_token: "attempt-1", p_outcome: "accepted",
    });
  });

  it.each([400, 401, 403, 404, 405, 422, 429])("records HTTP %s as definitively rejected", async (status) => {
    fetchMock.mockResolvedValue(new Response("private provider body", { status }));
    await expect(deliverPlanTrialEmail(admin, key, prepare)).rejects.toThrow("rejected");
    expect(rpc.mock.calls[1][1].p_outcome).toBe("rejected");
  });

  it.each([409, 500, 502, 503])("retains uncertainty for HTTP %s", async (status) => {
    fetchMock.mockResolvedValue(new Response("private provider body", { status }));
    await expect(deliverPlanTrialEmail(admin, key, prepare)).rejects.toThrow("uncertain");
    expect(rpc.mock.calls[1][1].p_outcome).toBe("uncertain");
  });

  it("sanitizes transport errors and records uncertainty", async () => {
    fetchMock.mockRejectedValue(new Error("private provider diagnostic"));
    await expect(deliverPlanTrialEmail(admin, key, prepare)).rejects.toThrow("delivery uncertain");
    expect(rpc.mock.calls[1][1].p_outcome).toBe("uncertain");
  });

  it.each(["busy", "manual"])("does not send or rebuild a %s delivery", async (action) => {
    rpc.mockReset().mockResolvedValue({ data: { action }, error: null });
    await expect(deliverPlanTrialEmail(admin, key, prepare)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("does not send after a claim expires while the worker is waiting", async () => {
    rpc.mockReset().mockResolvedValueOnce({ data: { ...claim(), send_before: new Date(0).toISOString() }, error: null })
      .mockResolvedValue({ data: true, error: null });
    await expect(deliverPlanTrialEmail(admin, key, prepare)).rejects.toThrow("uncertain");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, null, "true", {}, []])("requires a boolean confirmation, not just provider success: %j", async (data) => {
    rpc.mockReset().mockResolvedValueOnce({ data: claim(), error: null })
      .mockResolvedValue({ data, error: null });
    await expect(deliverPlanTrialEmail(admin, key, prepare)).rejects.toThrow("Could not record");
  });
});
