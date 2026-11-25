import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// REAL alert module: only the global fetch and Next's after() are fake, and the
// relay is an invented address (never the real one).
const RELAY = "https://relay.example.test/hook";

// By default after() does what Next does outside the request scope:
// it throws. The tests for the "inside rendering" path swap it for one that keeps
// the task, as Next does there.
const nextServer = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: nextServer.after }));

function afterOutsideRequestScope() {
  throw new Error("after was called outside a request scope");
}

type Instrumentation = typeof import("@/instrumentation");

async function loadFresh(): Promise<Instrumentation["onRequestError"]> {
  // The per-route throttle lives in the module: each case starts with its own.
  vi.resetModules();
  return (await import("@/instrumentation")).onRequestError;
}

// Request with everything that must NEVER go out in the notice: query, email in the URL and
// headers with private data. Invented addresses use example.test.
const request = {
  path: "/courses/deep-focus?coupon=PRIVADO&email=pessoa@example.test",
  method: "POST",
  headers: {
    cookie: "sessao=valor-privado",
    "x-user-email": "pessoa@example.test",
    "x-forwarded-for": "203.0.113.9",
  },
};

const context = {
  routerKind: "App Router",
  routePath: "/courses/[slug]",
  routeType: "route",
  revalidateReason: undefined,
} as const;

const REQUEST_CONTEXT = Symbol.for("@next/request-context");
const slots = globalThis as unknown as Record<symbol, unknown>;

function withDigest(message: string, digest: string) {
  return Object.assign(new Error(message), { digest });
}

function sentBody(call: unknown[]) {
  return JSON.parse((call as [string, RequestInit])[1].body as string);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.OPS_ALERT_WEBHOOK_URL = RELAY;
  fetchMock = vi.fn(() => Promise.resolve(new Response("ok")));
  vi.stubGlobal("fetch", fetchMock);
  nextServer.after.mockReset();
  nextServer.after.mockImplementation(afterOutsideRequestScope);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPS_ALERT_WEBHOOK_URL;
  delete slots[REQUEST_CONTEXT];
});

describe("onRequestError", () => {
  // Route handler catch: Next AWAITS the hook, outside the request
  // scope. While the relay has not answered, the hook stays alive.
  it("awaited (route handler): only finishes after the relay answers", async () => {
    let deliver!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve; }));
    const onRequestError = await loadFresh();

    let finished = false;
    const pending = Promise.resolve(onRequestError(new Error("boom"), request, context)).then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    deliver(new Response("ok"));
    await pending;
    expect(finished).toBe(true);
  });

  // Rendering error (RSC/SSR) or server action: React's onError calls
  // the hook and DISCARDS the promise. The send has to go to after().
  it("discarded inside rendering: the send goes to after() and reaches the relay", async () => {
    const tasks: unknown[] = [];
    nextServer.after.mockImplementation((task: unknown) => {
      tasks.push(task);
    });
    const onRequestError = await loadFresh();

    void onRequestError(new Error("render"), request, { ...context, routeType: "render" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    const kept = typeof task === "function" ? (task as () => Promise<unknown>)() : task;
    await expect(kept).resolves.toBe(true);
  });

  it("discarded outside the scope: the same send goes to the platform's waitUntil", async () => {
    const waitUntil = vi.fn();
    slots[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) };
    const onRequestError = await loadFresh();

    void onRequestError(new Error("action"), request, { ...context, routeType: "action" });

    expect(nextServer.after).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledExactlyOnceWith(expect.any(Promise));
    await expect(waitUntil.mock.calls[0][0]).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends only route, type, method, error name and fingerprint", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(new TypeError("falhou para pessoa@example.test no pedido 123"), request, context);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RELAY);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ event: "app.server_error", severity: "critical" });
    expect(body.context).toEqual({
      route: "/courses/[slug]",
      routeType: "route",
      method: "POST",
      errorName: "TypeError",
      fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/),
    });

    // Neither in the body nor in the headers of the send.
    const sent = JSON.stringify(init);
    for (const leak of ["coupon", "PRIVADO", "pessoa@example.test", "deep-focus", "falhou", "123", "valor-privado", "203.0.113.9"]) {
      expect(sent).not.toContain(leak);
    }
  });

  // Error caught by error.tsx, or thrown in a Suspense after the shell, goes out with
  // 200: the text cannot promise "HTTP 500".
  it("the summary says route and type, without HTTP status", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(new Error("x"), request, { ...context, routeType: "render" });

    const { summary, severity } = sentBody(fetchMock.mock.calls[0]);
    expect(summary).toBe("Server error on /courses/[slug] (render).");
    expect(summary).not.toMatch(/500|HTTP/);
    expect(severity).toBe("critical");
  });

  it("uses Next's digest as the fingerprint and strips any query that comes in the route", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(withDigest("boom", "2890447281"), request, { ...context, routePath: "/api/checkout?x=1" });

    expect(sentBody(fetchMock.mock.calls[0]).context).toMatchObject({ route: "/api/checkout", fingerprint: "2890447281" });
  });

  it("throttles per route: different routes alert, the same route alerts once", async () => {
    const onRequestError = await loadFresh();

    await onRequestError(new Error("a"), request, { ...context, routePath: "/api/checkout" });
    await onRequestError(new Error("b"), request, { ...context, routePath: "/learn/courses/[slug]" });
    await onRequestError(new Error("c"), request, { ...context, routePath: "/api/checkout" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => sentBody(call).context.route)).toEqual(["/api/checkout", "/learn/courses/[slug]"]);
  });

  // A send the relay did not confirm: does not silence the route for 5 minutes, but also
  // does not release it right away. A relay that delivers to Telegram and answers after
  // 4 s reports a "failure" with the message delivered; releasing right away would flood the channel.
  it("a lost send shortens the slot to 60 s: nothing before, a new attempt after", async () => {
    // Only the clock is fake: the 4 s cap on the send stays on the real timer.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t0 = new Date("2026-09-15T12:00:00Z").getTime();
      vi.setSystemTime(t0);
      fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("fora", { status: 502 })));
      const onRequestError = await loadFresh();

      await onRequestError(new Error("a"), request, context);
      vi.setSystemTime(t0 + 30_000);
      await onRequestError(new Error("b"), request, context);
      // Within 60 s of the failure: held back.
      expect(fetchMock).toHaveBeenCalledOnce();

      vi.setSystemTime(t0 + 61_000);
      await onRequestError(new Error("c"), request, context);
      // After 60 s: tries again, and this one arrives.
      expect(fetchMock).toHaveBeenCalledTimes(2);

      vi.setSystemTime(t0 + 120_000);
      await onRequestError(new Error("d"), request, context);
      // Delivered: back to the 5 minutes.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["notFound", withDigest("NEXT_HTTP_ERROR_FALLBACK;404", "NEXT_HTTP_ERROR_FALLBACK;404")],
    ["redirect", withDigest("NEXT_REDIRECT", "NEXT_REDIRECT;replace;/entrar;307;")],
    ["pedido abortado", Object.assign(new Error("aborted"), { name: "AbortError" })],
    ["conexao fechada", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })],
  ])("%s does not send a notice", async (_case, error) => {
    const onRequestError = await loadFresh();

    await onRequestError(error, request, context);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(nextServer.after).not.toHaveBeenCalled();
  });

  it("a relay that is down does not throw", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("relay down")));
    const onRequestError = await loadFresh();

    await expect(onRequestError(new Error("a"), request, context)).resolves.toBeUndefined();
  });

  it("an error that comes back to the hook during the send, on the same route, does not resend", async () => {
    const onRequestError = await loadFresh();
    fetchMock.mockImplementationOnce(async () => {
      await onRequestError(new Error("inside the send"), request, context);
      return new Response("ok");
    });

    await onRequestError(new Error("outside"), request, context);

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
