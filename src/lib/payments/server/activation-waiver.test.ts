// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), stripe: vi.fn(), list: vi.fn(), expire: vi.fn(), retrieve: vi.fn(), refund: vi.fn(),
  admin: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/payments/server/stripe-helpers", () => ({ getUserRow: mocks.profile }));
vi.mock("@/lib/payments/server/stripe", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/payments/server/stripe")>(), getStripeClient: mocks.stripe,
}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/rate-limit", () => ({ runRateLimit: vi.fn() }));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: vi.fn() }));

import { ACTIVATION_FEE_CHECKOUT_PURPOSE } from "@/data/plans";
import { PaymentError } from "@/lib/payments/server/auth";
import { finishActivationWaiver } from "./activation-waiver";

const uid = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const customer = "cus_waiver_test";
const message = "Could not complete the activation waiver. Please try again.";
function session(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, object: "checkout.session", customer, status: "open",
    metadata: { uid, purpose: ACTIVATION_FEE_CHECKOUT_PURPOSE }, ...overrides,
  };
}
function page(data: ReturnType<typeof session>[], hasMore = false) {
  return { object: "list", url: "/v1/checkout/sessions", data, has_more: hasMore };
}
async function expectOpaqueFailure(result: Promise<void>) {
  await expect(result).rejects.toBeInstanceOf(PaymentError);
  await expect(result).rejects.toMatchObject({ status: 503, message });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call in waiver test"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.profile.mockResolvedValue({ uid, stripe_customer_id: customer });
  mocks.stripe.mockReturnValue({
    checkout: { sessions: { list: mocks.list, expire: mocks.expire, retrieve: mocks.retrieve } },
    refunds: { create: mocks.refund },
  });
  mocks.list.mockResolvedValue(page([]));
  mocks.expire.mockImplementation(async (id: string) => session(id, { status: "expired" }));
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});
afterEach(() => {
  try {
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

describe("finishActivationWaiver", () => {
  it("finalizes without touching Stripe when the user has no customer", async () => {
    mocks.profile.mockResolvedValue({ uid, stripe_customer_id: null });
    await expect(finishActivationWaiver(uid, revision)).resolves.toBeUndefined();
    expect(mocks.profile).toHaveBeenCalledWith(uid);
    expect(mocks.stripe).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("finalize_creator_activation_waiver", { p_target_uid: uid, p_revision: revision });
  });

  it("paginates all customer sessions, using the unfiltered page's last id", async () => {
    mocks.list.mockResolvedValueOnce(page([
      session("cs_activation_1"), session("cs_other_course", { metadata: { uid, purpose: "course_checkout" } }),
    ], true)).mockResolvedValueOnce(page([
      session("cs_activation_2", { customer: { id: customer } }),
      session("cs_other_creator", { metadata: { uid: "other", purpose: ACTIVATION_FEE_CHECKOUT_PURPOSE } }),
    ], true)).mockResolvedValueOnce(page([session("cs_expired", { status: "expired" })]));
    await finishActivationWaiver(uid, revision);
    expect(mocks.list.mock.calls).toEqual([
      [{ customer, limit: 100 }],
      [{ customer, limit: 100, starting_after: "cs_other_course" }],
      [{ customer, limit: 100, starting_after: "cs_other_creator" }],
    ]);
    expect(mocks.expire.mock.calls).toEqual([["cs_activation_1"], ["cs_activation_2"]]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("finalize_creator_activation_waiver", { p_target_uid: uid, p_revision: revision });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.list.mock.invocationCallOrder[2]);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.expire.mock.invocationCallOrder[1]);
  });

  it("does not expire or inspect unrelated completed/course/creator sessions", async () => {
    mocks.list.mockResolvedValue(page([
      session("cs_course", { status: "complete", metadata: { uid, purpose: "course_checkout" } }),
      session("cs_other", { metadata: { uid: "other", purpose: ACTIVATION_FEE_CHECKOUT_PURPOSE } }),
      session("cs_no_metadata", { metadata: null }),
      session("cs_no_uid", { metadata: { purpose: ACTIVATION_FEE_CHECKOUT_PURPOSE } }),
      session("cs_no_purpose", { metadata: { uid } }),
    ]));
    await finishActivationWaiver(uid, revision);
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("waits for provider expiration confirmation before finalizing", async () => {
    let confirm!: (value: ReturnType<typeof session>) => void;
    let entered!: () => void;
    const expiring = new Promise<void>((resolve) => { entered = resolve; });
    mocks.list.mockResolvedValue(page([session("cs_pending")]));
    mocks.expire.mockImplementation(() => {
      entered();
      return new Promise<ReturnType<typeof session>>((resolve) => { confirm = resolve; });
    });
    const result = finishActivationWaiver(uid, revision);
    await expiring;
    expect(mocks.rpc).not.toHaveBeenCalled();
    confirm(session("cs_pending", { status: "expired" }));
    await result;
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["complete", "expired"])("does not alter a matched session already listed as %s", async (status) => {
    mocks.list.mockResolvedValue(page([session("cs_finished", { status })]));
    await finishActivationWaiver(uid, revision);
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([null, "unknown"])("does not finalize a matched session with status %s", async (status) => {
    mocks.list.mockResolvedValue(page([session("cs_blocked", { status })]));
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { id: "cs_open", status: "open" }, { id: "cs_open", status: "complete" },
    { id: "cs_other", status: "expired" }, { id: "cs_open" }, null,
  ])("requires expiration confirmation for the same session: %j", async (confirmation) => {
    mocks.list.mockResolvedValue(page([session("cs_open")]));
    mocks.expire.mockResolvedValue(confirmation);
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.expire.mock.calls).toEqual([["cs_open"]]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not finalize if expiration fails, including a payment completing concurrently", async () => {
    mocks.list.mockResolvedValue(page([session("cs_open")]));
    mocks.expire.mockRejectedValue({ code: "checkout_session_not_open", message: "private provider diagnostic" });
    mocks.retrieve.mockResolvedValue(session("cs_open", { status: "complete" }));
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.retrieve.mock.calls).toEqual([["cs_open"]]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("finalizes after a competing cleanup has verifiably expired the same session", async () => {
    mocks.list.mockResolvedValue(page([session("cs_open")]));
    mocks.expire.mockRejectedValue(new Error("private already-expired diagnostic"));
    mocks.retrieve.mockResolvedValue(session("cs_open", { status: "expired" }));
    await finishActivationWaiver(uid, revision);
    expect(mocks.expire.mock.calls).toEqual([["cs_open"]]);
    expect(mocks.retrieve.mock.calls).toEqual([["cs_open"]]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.retrieve.mock.invocationCallOrder[0]);
  });

  it.each([
    { id: "cs_open", status: "open" }, { id: "cs_open", status: "complete" },
    { id: "cs_other", status: "expired" }, { id: "cs_open", status: null }, null,
  ])("does not finalize an inconclusive retrieval after expiration failure: %j", async (confirmation) => {
    mocks.list.mockResolvedValue(page([session("cs_open")]));
    mocks.expire.mockRejectedValue(new Error("private expire diagnostic"));
    mocks.retrieve.mockResolvedValue(confirmation);
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.retrieve.mock.calls).toEqual([["cs_open"]]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the grant pending when both expiration and retrieval fail", async () => {
    mocks.list.mockResolvedValue(page([session("cs_open")]));
    mocks.expire.mockRejectedValue(new Error("private expire diagnostic"));
    mocks.retrieve.mockRejectedValue(new Error("private retrieve diagnostic"));
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { customer: "cus_other" }, { customer: null }, { id: "" }, { id: " cs_invalid" },
  ])("rejects an inconsistent matching session without expiring it: %j", async (overrides) => {
    mocks.list.mockResolvedValue(page([session("cs_open", overrides)]));
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: [], has_more: true }, { data: null, has_more: false }, { data: [], has_more: "false" },
    { data: [], has_more: undefined }, { data: [{}], has_more: true },
    { data: [{ id: "" }], has_more: true }, { data: [{ id: " cs_invalid " }], has_more: true },
  ])("fails closed on invalid pagination: %j", async (result) => {
    mocks.list.mockResolvedValue(result);
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([false, true])("rejects a repeated cursor, including a multi-page cycle (%s)", async (cycle) => {
    mocks.list.mockResolvedValueOnce(page([session("cs_cursor_a", { status: "expired" })], true));
    if (cycle) mocks.list.mockResolvedValueOnce(page([session("cs_cursor_b", { status: "expired" })], true));
    mocks.list.mockResolvedValue(page([session("cs_cursor_a", { status: "expired" })], true));
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.list).toHaveBeenCalledTimes(cycle ? 3 : 2);
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("leaves the grant pending if a later page fails after an earlier expiration", async () => {
    mocks.list.mockResolvedValueOnce(page([session("cs_first")], true)).mockRejectedValueOnce(new Error("private list diagnostic"));
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.expire.mock.calls).toEqual([["cs_first"]]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("safely retries a partial cleanup without expiring the already-expired session again", async () => {
    mocks.list.mockResolvedValueOnce(page([session("cs_first")], true))
      .mockRejectedValueOnce(new Error("private later-page diagnostic"));
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.list.mockResolvedValueOnce(page([session("cs_first", { status: "expired" }), session("cs_remaining")]));
    await finishActivationWaiver(uid, revision);
    expect(mocks.expire.mock.calls).toEqual([["cs_first"], ["cs_remaining"]]);
    expect(mocks.rpc.mock.calls).toEqual([["finalize_creator_activation_waiver", { p_target_uid: uid, p_revision: revision }]]);
  });

  it.each([null, { uid: "other", stripe_customer_id: customer }, { uid, stripe_customer_id: "" }, { uid }])("does not finalize an absent or invalid profile: %j", async (profile) => {
    mocks.profile.mockResolvedValue(profile);
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.stripe).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["profile", "stripe", "list", "admin", "rpc"])("masks errors from %s", async (stage) => {
    const error = new Error("private provider diagnostic");
    if (stage === "profile") mocks.profile.mockRejectedValue(error);
    if (stage === "stripe") mocks.stripe.mockImplementation(() => { throw error; });
    if (stage === "list") mocks.list.mockRejectedValue(error);
    if (stage === "admin") mocks.admin.mockImplementation(() => { throw error; });
    if (stage === "rpc") mocks.rpc.mockRejectedValue(error);
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    if (stage !== "rpc") expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: false, error: null }, { data: null, error: null }, { data: "true", error: null },
    { data: true, error: { message: "private finalize diagnostic" } },
  ])("requires boolean true from the revision compare-and-set: %j", async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expectOpaqueFailure(finishActivationWaiver(uid, revision));
    expect(mocks.rpc.mock.calls).toEqual([["finalize_creator_activation_waiver", { p_target_uid: uid, p_revision: revision }]]);
  });

  it.each([["", revision], [uid, ""], [` ${uid}`, revision], [uid, `${revision} `]])("rejects invalid uid/revision before provider access (%s, %s)", async (target, version) => {
    await expectOpaqueFailure(finishActivationWaiver(target, version));
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.stripe).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
