// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(), getUser: vi.fn(), from: vi.fn(), select: vi.fn(), order: vi.fn(),
  rpc: vi.fn(), single: vi.fn(), write: vi.fn(), admin: vi.fn(),
  config: vi.fn(), add: vi.fn(), limit: vi.fn(), network: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/domains/server/vercel-domains", () => ({
  vercelDomainsConfig: mocks.config,
  addDomainToProject: mocks.add,
}));
vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  enforceRateLimit: mocks.limit,
}));

import { GET } from "./route";

const marker = "LOCAL_QA_DOMAIN_GET";
const dbError = {
  code: `${marker}_CODE`,
  message: `${marker}_MESSAGE`,
  details: `${marker}_DETAILS`,
  hint: `${marker}_HINT`,
};
const domain = {
  id: "local-qa-domain",
  hostname: "local-qa.example.test",
  status: "pending_dns",
  verification_name: null,
  verification_value: null,
  error_reason: null,
  created_at: "2026-09-09T12:00:00.000Z",
  verified_at: null,
};
const config = {
  apiCredential: "LOCAL_QA_NOT_A_CREDENTIAL",
  projectId: "local-qa-project",
  teamId: "local-qa-team",
};
const table = {
  select: mocks.select,
  order: mocks.order,
  insert: mocks.write,
  update: mocks.write,
  upsert: mocks.write,
  delete: mocks.write,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "local-qa-teacher" } }, error: null,
  });
  mocks.from.mockReturnValue(table);
  mocks.select.mockReturnValue(table);
  mocks.order.mockResolvedValue({ data: [domain], error: null });
  // Model rpc() as a synchronous builder; its mocked single() result is a Promise.
  mocks.rpc.mockReturnValue({ single: mocks.single });
  mocks.single.mockResolvedValue({ data: { used: 1, limit: 3 }, error: null });
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc,
  });
  mocks.config.mockReturnValue(config);
  mocks.network.mockRejectedValue(new Error(`${marker}_NETWORK_FORBIDDEN`));
  vi.stubGlobal("fetch", mocks.network);
});

afterEach(() => {
  try {
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.network).not.toHaveBeenCalled();
    for (const call of mocks.from.mock.calls) expect(call).toEqual(["custom_domains"]);
    for (const call of mocks.rpc.mock.calls) expect(call).toEqual(["get_my_custom_domain_quota"]);
  } finally {
    vi.unstubAllGlobals();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function expectOpaqueFailure(response: Response) {
  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/json");
  const body = await response.json();
  expect(body).toEqual({ error: expect.any(String) });
  expect(body.error.trim()).not.toBe("");
  expect(JSON.stringify(body)).not.toContain(marker);
}

describe("GET /api/teach/domains — read failures are not empty success", () => {
  it.each(["order", "single"] as const)("rejects a returned error from %s", async (terminal) => {
    mocks[terminal].mockResolvedValueOnce({ data: null, error: dbError });
    await expectOpaqueFailure(await GET());
    expect(mocks.order).toHaveBeenCalledTimes(1);
    expect(mocks.single).toHaveBeenCalledTimes(1);
  });

  it.each(["client", "getUser", "order", "single"] as const)(
    "returns opaque JSON when %s rejects instead of resolving",
    async (boundary) => {
      mocks[boundary].mockRejectedValueOnce(new Error(`${marker}_REJECTED`));
      await expectOpaqueFailure(await GET());
    },
  );

  it.each([
    { name: "existing domains", rows: [domain], quota: { used: 1, limit: 3 }, configured: true },
    { name: "legitimate zero quota", rows: [], quota: { used: 0, limit: 0 }, configured: true },
    { name: "empty list with room", rows: [], quota: { used: 0, limit: 3 }, configured: true },
    { name: "unconfigured integration", rows: [domain], quota: { used: 1, limit: 3 }, configured: false },
  ])("preserves successful $name with both mocked builders constructed", async (scenario) => {
    const domainsRead = deferred<{ data: Array<typeof domain>; error: null }>();
    const quotaRead = deferred<{ data: { used: number; limit: number }; error: null }>();
    mocks.order.mockReturnValueOnce(domainsRead.promise);
    mocks.single.mockReturnValueOnce(quotaRead.promise);
    mocks.config.mockReturnValueOnce(scenario.configured ? config : null);
    const pendingResponse = GET();
    // Both mocked builders are constructed before either result resolves.
    // This does not establish concurrency of real Supabase requests.
    await vi.waitFor(() => {
      expect(mocks.order).toHaveBeenCalledTimes(1);
      expect(mocks.single).toHaveBeenCalledTimes(1);
    });
    domainsRead.resolve({ data: scenario.rows, error: null });
    quotaRead.resolve({ data: scenario.quota, error: null });
    const response = await pendingResponse;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      domains: scenario.rows, quota: scenario.quota, configured: scenario.configured,
    });
    expect(mocks.order).toHaveBeenCalledTimes(1);
    expect(mocks.single).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "no user", error: null },
    { name: "auth error", error: { code: "bad_jwt", message: `${marker}_AUTH_ERROR` } },
    { name: "pending MFA", error: { code: "mfa_required", status: 401, message: `${marker}_MFA_REQUIRED` } },
  ])("keeps 401 for $name before any domain read", async (scenario) => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: scenario.error });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "You must be signed in." });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
