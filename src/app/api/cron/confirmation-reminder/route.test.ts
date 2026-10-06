import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  listUsers: vi.fn(),
  generateLink: vi.fn(),
  updateUserById: vi.fn(),
  fetch: vi.fn(),
  sleep: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.getAdmin }));
// The pause between sends (Resend allows 2 requests/second) runs instantly here.
vi.mock("node:timers/promises", () => ({ default: { setTimeout: mocks.sleep }, setTimeout: mocks.sleep }));

// The real Resend sender runs: only the network (fetch) is faked, so these
// cases prove what the provider actually got.
import { GET } from "@/app/api/cron/confirmation-reminder/route";

const CRON_TOKEN = "test-cron-token";
const APP = "https://app.example.test";
const NOW = Date.parse("2026-10-05T08:07:00Z");
const MARK = "confirmation_reminder_sent_at";
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

type FakeUser = {
  id: string;
  email?: string;
  created_at: string;
  email_confirmed_at?: string | null;
  deleted_at?: string;
  banned_until?: string;
  invited_at?: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
};

let users: FakeUser[];
let seq = 0;
function user(hours: number, extra: Partial<FakeUser> = {}): FakeUser {
  seq += 1;
  const created = {
    id: `user-${seq}`,
    email: `person${seq}@example.test`,
    created_at: ago(hours),
    email_confirmed_at: null,
    app_metadata: { provider: "email" },
    user_metadata: {},
    ...extra,
  };
  users.push(created);
  return created;
}

function call(header?: string, query = "") {
  return GET(new Request(`http://localhost/api/cron/confirmation-reminder${query}`, {
    headers: header ? { authorization: header } : {},
  }));
}
const run = (query = "") => call(`Bearer ${CRON_TOKEN}`, query);
const sentBodies = () => mocks.fetch.mock.calls.map((args) => JSON.parse(args[1].body as string));
const sentTo = () => sentBodies().map((body) => body.to[0]);

describe("confirmation reminder cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("CRON_SECRET", CRON_TOKEN);
    vi.stubEnv("RESEND_API_KEY", "re_fixture");
    vi.stubEnv("SKILLSET_APP_URL", APP);
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockImplementation(async () => new Response("{}"));
    users = [];

    mocks.getAdmin.mockReturnValue({
      auth: {
        admin: {
          listUsers: mocks.listUsers,
          generateLink: mocks.generateLink,
          updateUserById: mocks.updateUserById,
        },
      },
    });
    // GoTrue lists newest first.
    mocks.listUsers.mockImplementation(async ({ page, perPage }: { page: number; perPage: number }) => {
      const sorted = [...users].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return { data: { users: sorted.slice((page - 1) * perPage, page * perPage) }, error: null };
    });
    mocks.generateLink.mockImplementation(async ({ email }: { email: string }) => {
      const found = users.find((entry) => entry.email === email);
      return { data: { properties: { hashed_token: `h_${found?.id}` }, user: found }, error: null };
    });
    // Same merge GoTrue does on app_metadata.
    mocks.updateUserById.mockImplementation(async (id: string, attributes: { app_metadata: Record<string, unknown> }) => {
      const found = users.find((entry) => entry.id === id);
      if (found) found.app_metadata = { ...found.app_metadata, ...attributes.app_metadata };
      return { data: { user: found }, error: null };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["missing header", undefined],
    ["wrong value", `Bearer not-${CRON_TOKEN}`],
  ])("refuses a %s without touching accounts", async (_label, header) => {
    user(30);

    const response = await call(header);

    expect(response.status).toBe(401);
    expect(mocks.getAdmin).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refuses to start without the email key, so nobody is marked for an email that cannot leave", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    user(30);

    const response = await run();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, reason: "email_channel_missing" });
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it("reminds only unconfirmed accounts created 24 to 72 hours ago, oldest first", async () => {
    user(23);
    const young = user(25);
    const old = user(71);
    user(73);
    user(30, { email_confirmed_at: ago(29) });
    user(30, { app_metadata: { [MARK]: ago(5) } });
    user(30, { deleted_at: ago(1) });
    user(30, { banned_until: new Date(NOW + 3_600_000).toISOString() });
    const banLifted = user(30, { banned_until: ago(2) });
    user(30, { invited_at: ago(30) });
    user(30, { email: "" });

    const response = await run();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, due: 3, sent: 3, failed: 0 });
    expect(sentTo()).toEqual([old.email, banLifted.email, young.email]);
  });

  it("marks the account before the email goes out and never sends twice", async () => {
    const pending = user(30);

    await run();
    const second = await run();

    expect(sentTo()).toEqual([pending.email]);
    expect(await second.json()).toEqual({ ok: true, due: 0, sent: 0, failed: 0 });
    expect(mocks.updateUserById).toHaveBeenCalledTimes(1);
    expect(mocks.updateUserById).toHaveBeenCalledWith(pending.id, {
      app_metadata: { [MARK]: new Date(NOW).toISOString() },
    });
    expect(mocks.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetch.mock.invocationCallOrder[0]);
    // The rest of app_metadata survives the mark.
    expect(pending.app_metadata.provider).toBe("email");
  });

  it("sends a fresh confirmation link in the account's language", async () => {
    const english = user(40);
    const spanish = user(30, { user_metadata: { locale: "es" } });
    const unknown = user(26, { user_metadata: { locale: "pt" } });

    await run();

    expect(mocks.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: english.email });
    const [en, es, fallback] = sentBodies();
    const link = `${APP}/auth/confirm?token_hash=h_${english.id}&type=email`;

    expect(en.from).toBe("SkillsetMind <no-reply@skillsetmind.com>");
    expect(en.to).toEqual([english.email]);
    expect(en.subject).toBe("Confirm your email to finish signing up");
    expect(en.html).toContain("Confirm my email");
    expect(en.html).toContain(`href="${link.replace("&", "&amp;")}"`);
    expect(en.text).toContain(link);
    expect(es.to).toEqual([spanish.email]);
    expect(es.subject).toBe("Confirma tu correo para terminar tu registro");
    expect(es.html).toContain("Confirmar mi correo");
    expect(fallback.to).toEqual([unknown.email]);
    expect(fallback.html).toContain("Confirm my email");
    for (const body of [en, es, fallback]) {
      expect(`${body.subject} ${body.html} ${body.text}`.toLowerCase()).not.toMatch(/invit/);
    }
  });

  it("caps each run at 25 and leaves the rest for the next hour", async () => {
    for (let hours = 30; hours < 60; hours += 1) user(hours);

    const response = await run();

    expect(await response.json()).toEqual({ ok: true, due: 30, sent: 25, failed: 0 });
    // The 25 oldest: whoever waits is still inside the window next hour.
    expect(sentTo()).toEqual(users.slice(5).reverse().map((entry) => entry.email));
    expect(mocks.sleep).toHaveBeenCalledTimes(24);
    expect(mocks.sleep).toHaveBeenCalledWith(600);
  });

  it("reads the next page only while it is still inside the window", async () => {
    for (let index = 0; index < 199; index += 1) user(1);
    const due = user(30);
    const lastPage = user(40);

    await run();
    // Page 2 is short: it is the last one, no third call.
    expect(mocks.listUsers).toHaveBeenCalledTimes(2);
    expect(sentTo()).toEqual([lastPage.email, due.email]);

    users = [];
    vi.clearAllMocks();
    for (let index = 0; index < 199; index += 1) user(1);
    user(80);
    user(100);

    await run();
    expect(mocks.listUsers).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("widens the window for the one-off catch-up, never narrows it", async () => {
    const stuck = user(24 * 20);
    const recent = user(50);

    await run("?max_age_hours=1");
    expect(sentTo()).toEqual([recent.email]);

    await run("?max_age_hours=720");
    expect(sentTo()).toEqual([recent.email, stuck.email]);
  });

  it("answers 500 without sending when the account list cannot be read", async () => {
    user(30);
    mocks.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: { message: "boom" } });

    const response = await run();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, reason: "list_failed" });
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("skips an account whose link cannot be minted, leaves it unmarked, and retries it next run", async () => {
    const unlucky = user(40);
    const fine = user(30);
    mocks.generateLink.mockResolvedValueOnce({ data: { properties: null, user: null }, error: { message: "boom" } });

    const response = await run();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, due: 2, sent: 1, failed: 1 });
    expect(sentTo()).toEqual([fine.email]);
    expect(unlucky.app_metadata[MARK]).toBeUndefined();

    await run();
    expect(sentTo()).toEqual([fine.email, unlucky.email]);
  });

  it("does not send when the mark cannot be saved", async () => {
    const unlucky = user(40);
    const fine = user(30);
    mocks.updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: "boom" } });

    const response = await run();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, due: 2, sent: 1, failed: 1 });
    expect(sentTo()).toEqual([fine.email]);
    expect(unlucky.app_metadata[MARK]).toBeUndefined();
  });

  it("stops at the first failed send and never retries that account", async () => {
    const first = user(40);
    const second = user(30);
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 503 }));

    const response = await run();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, due: 2, sent: 0, failed: 1 });
    expect(mocks.generateLink).toHaveBeenCalledTimes(1);
    expect(first.app_metadata[MARK]).toBeDefined();

    // Next hour: the second account gets its reminder; the first is not retried
    // (the provider may have delivered it before failing).
    await run();
    expect(sentTo()).toEqual([first.email, second.email]);
  });

  it("logs and answers with counts only: no email address, no account id", async () => {
    const logs = [
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    user(40);
    user(30);
    mocks.generateLink.mockResolvedValueOnce({ data: { properties: null, user: null }, error: { message: "boom" } });
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 503 }));

    const response = await run();
    const body = JSON.stringify(await response.json());

    const logged = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
    expect(logs[0]).toHaveBeenCalled();
    for (const text of [logged, body]) {
      expect(text).not.toContain("@");
      expect(text).not.toContain("user-");
    }
  });
});
