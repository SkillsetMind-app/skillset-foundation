import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/assistant/knowledge-sync", () => ({
  syncKnowledgeDoc: mocks.sync,
}));

import { GET } from "@/app/api/cron/advisor-knowledge/route";

const CRON_TOKEN = "test-cron-token";
const ADMIN = { from: () => ({}) };

function call(authorization?: string) {
  return GET(
    new Request("http://localhost/api/cron/advisor-knowledge", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

describe("advisor knowledge cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", CRON_TOKEN);
    mocks.getAdmin.mockReturnValue(ADMIN);
    mocks.sync.mockResolvedValue({ ok: true, chunks: 12, skipped: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Every accepted call spends OpenAI embedding credit, so an unauthenticated
  // caller must not reach the sync — a 401 returned *after* reindexing would
  // still have paid for it.
  it("rejects a wrong secret without running the sync", async () => {
    const response = await call(`Bearer not-${CRON_TOKEN}`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  // A wrong secret of the SAME length is the only case that reaches the byte
  // comparison — every other rejection test above is decided by the length check
  // alone, so without this one the constant-time compare could be deleted
  // outright and the suite would stay green.
  it("rejects a same-length wrong secret", async () => {
    const response = await call(`Bearer ${"x".repeat(CRON_TOKEN.length)}`);

    expect(response.status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("rejects a missing header", async () => {
    const response = await call();

    expect(response.status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  // Dormant until the owner sets CRON_SECRET: an unset secret must not degrade
  // into "no auth required".
  it("stays closed when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await call("Bearer ");

    expect(response.status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("runs the sync with the service-role client and returns its result", async () => {
    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, chunks: 12, skipped: false });
    expect(mocks.sync).toHaveBeenCalledWith(ADMIN);
  });

  // The scheduler parses the body, so a missing service-role key has to come back
  // as JSON. Uncaught, it would throw and Next would answer with an HTML error
  // page — a 500 the cron log shows as unexplained.
  it("answers JSON, not a thrown HTML page, when the service-role key is missing", async () => {
    mocks.getAdmin.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
    });

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, reason: "service_role_missing" });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  // The status code is what turns a broken sync into a visible failed cron run
  // in Vercel; 200 here would hide a stale knowledge base indefinitely.
  it("reports a failed sync as 500 so the cron run goes red", async () => {
    mocks.sync.mockResolvedValue({
      ok: false,
      chunks: 0,
      skipped: false,
      reason: "doc_not_public: ...",
    });

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, reason: "doc_not_public: ..." });
  });

  // Not-yet-configured is not a breakage: alerting on it every day would train
  // the owner to ignore cron alerts.
  it("reports an unconfigured sync as 200", async () => {
    mocks.sync.mockResolvedValue({
      ok: false,
      chunks: 0,
      skipped: true,
      reason: "not_configured",
    });

    const response = await call(`Bearer ${CRON_TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: true, reason: "not_configured" });
  });
});
