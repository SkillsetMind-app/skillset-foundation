import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  askKimi: vi.fn(),
  buildKnowledge: vi.fn(),
  buildTeacherContext: vi.fn(),
  createServer: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  retrieveKnowledge: vi.fn(),
  rpc: vi.fn(),
  runRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

vi.mock("@/lib/supabase/rate-limit", () => ({
  runRateLimit: mocks.runRateLimit,
}));

// The real one throws without SUPABASE_SERVICE_ROLE_KEY, which no test sets.
// retrieveKnowledge is mocked anyway, so the client it receives is never used.
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({}),
}));

// The error classes stay real: the route branches on `instanceof`, so a fully
// synthetic module would make every failure path fall through to the same 503
// and the tests below would agree with each other while proving nothing.
vi.mock("@/lib/assistant/kimi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assistant/kimi")>()),
  askKimi: mocks.askKimi,
}));

// formatKnowledge stays real — it is what turns retrieved passages into the
// block the prompt assertion looks for.
vi.mock("@/lib/assistant/retrieve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assistant/retrieve")>()),
  retrieveKnowledge: mocks.retrieveKnowledge,
}));

vi.mock("@/lib/assistant/teacher-context", () => ({
  buildTeacherContext: mocks.buildTeacherContext,
}));

vi.mock("@/lib/assistant/knowledge", () => ({
  buildAssistantKnowledge: mocks.buildKnowledge,
}));

import { GET, POST } from "@/app/api/teach/advisor/route";
import { KimiConfigError, KimiError } from "@/lib/assistant/kimi";

type Result = { data?: unknown; error?: unknown };

// What the route hands askKimi. Only the shape the assertions read back.
type KimiTurn = { role: string; content: string };

// Every chained call, so a test can assert on the shape of the query and not
// just on the rows the stub was told to hand back.
const chain: { table: string; method: string; args: unknown[] }[] = [];

// A supabase-js query builder is chainable AND thenable: `await q.select().eq()`
// resolves with no terminal method. Model both, so the route can await wherever
// it likes without this stub caring about the exact chain.
function query(table: string, result: Result) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "insert", "eq", "order", "limit", "single", "maybeSingle"]) {
    builder[method] = (...args: unknown[]) => {
      chain.push({ table, method, args });
      return builder;
    };
  }
  return builder;
}

function supabase(tables: Record<string, Result> = {}) {
  mocks.from.mockImplementation((table: string) =>
    query(table, tables[table] ?? { data: null, error: null }),
  );
  return { auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from };
}

function post(body?: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/teach/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

function ask(content = "How should I price this course?") {
  return post({ messages: [{ role: "user", content }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  chain.length = 0;

  mocks.getUser.mockResolvedValue({ data: { user: { id: "teacher" } }, error: null });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.runRateLimit.mockResolvedValue({ data: null, error: null });
  mocks.createServer.mockResolvedValue(supabase());

  mocks.buildKnowledge.mockReturnValue("STATIC_CORPUS");
  mocks.retrieveKnowledge.mockResolvedValue([]);
  mocks.buildTeacherContext.mockResolvedValue("");
  mocks.askKimi.mockResolvedValue("Here is one concrete next step.");
});

describe("advisor route guards", () => {
  it("refuses an anonymous caller without touching the model", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await post();

    expect(response.status).toBe(401);
    expect(mocks.askKimi).not.toHaveBeenCalled();
  });

  // The sidebar hides itself for non-teachers, but that is the shop window, not
  // the lock: this endpoint is reachable with any signed-in session and every
  // accepted call spends paid reasoning-model inference.
  it("rejects a signed-in non-teacher before spending inference or a rate-limit slot", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const response = await post();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Teacher access is required." });
    expect(mocks.askKimi).not.toHaveBeenCalled();
    expect(mocks.runRateLimit).not.toHaveBeenCalled();
  });

  it("fails closed when the role check itself errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    const response = await post();

    expect(response.status).toBe(403);
    expect(mocks.askKimi).not.toHaveBeenCalled();
  });

  it("authenticates, then authorizes, then throttles", async () => {
    mocks.runRateLimit.mockResolvedValue({
      data: null,
      error: { message: "RATE_LIMIT exceeded" },
    });

    const response = await ask();

    expect(response.status).toBe(429);
    expect(mocks.runRateLimit).toHaveBeenCalledWith("advisor_teacher", 30, 3_600_000);
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0],
    );
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runRateLimit.mock.invocationCallOrder[0],
    );
    expect(mocks.askKimi).not.toHaveBeenCalled();
  });

  // The hourly window blunts a scripted burst; the daily one is what bounds the
  // monthly inference bill. Losing either is invisible until the invoice arrives,
  // so assert the exact pair rather than "the limiter ran".
  it("spends both an hourly and a daily budget on every accepted question", async () => {
    await ask();

    expect(mocks.runRateLimit.mock.calls).toEqual([
      ["advisor_teacher", 30, 3_600_000],
      ["advisor_daily_teacher", 120, 86_400_000],
    ]);
  });

  it("returns an opaque error when the limiter is unavailable", async () => {
    mocks.runRateLimit.mockRejectedValue(new Error("service role unavailable"));

    const response = await post();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Something went wrong. Please try again.",
    });
  });

  // The rate limiter counts finished requests; nothing in it stops one teacher
  // from holding six 55-second model calls open at once. The in-process ceiling
  // is the only thing that does, and it also has to give the slot back — a
  // counter that leaks turns the endpoint permanently unavailable after six
  // failures, which is worse than the burst it was meant to prevent.
  it("sheds load past the concurrency ceiling and releases the slots after", async () => {
    const release: (() => void)[] = [];
    mocks.askKimi.mockImplementation(
      () => new Promise<string>((resolve) => release.push(() => resolve("held"))),
    );

    const held = Array.from({ length: 6 }, () => ask());
    await vi.waitFor(() => expect(mocks.askKimi).toHaveBeenCalledTimes(6));

    const shed = await ask();
    expect(shed.status).toBe(429);
    expect(await shed.json()).toEqual({
      error: "The advisor is busy right now. Please try again in a moment.",
    });
    expect(mocks.askKimi).toHaveBeenCalledTimes(6); // the 7th never reached the model

    release.forEach((resolve) => resolve());
    await Promise.all(held);

    mocks.askKimi.mockResolvedValue("Here is one concrete next step.");
    expect((await ask()).status).toBe(200);
  });

  // The shape the test above could never see: it waited for the first six to
  // be counted before sending the seventh. In production the requests arrive
  // together, and the check used to sit one await ahead of the increment, so
  // all of them read zero, all passed, and all reached the paid model.
  it("sheds the excess of a simultaneous burst, not just late arrivals", async () => {
    const release: (() => void)[] = [];
    mocks.askKimi.mockImplementation(
      () => new Promise<string>((resolve) => release.push(() => resolve("held"))),
    );

    const burst = Array.from({ length: 9 }, () => ask());
    const shed: number[] = [];
    for (const pending of burst) {
      void pending.then((response) => {
        if (response.status === 429) shed.push(response.status);
      });
    }

    try {
      await vi.waitFor(() => expect(shed).toHaveLength(3));
      expect(mocks.askKimi).toHaveBeenCalledTimes(6);
    } finally {
      // Also on failure, so held slots never bleed into the next test.
      release.forEach((resolve) => resolve());
    }

    const statuses = (await Promise.all(burst)).map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(6);
  });

  // The slot is now taken before the grounding lookups, so it has to come back
  // if one of them blows up — otherwise six such failures leave the endpoint
  // answering 429 to everyone until the lambda is recycled.
  it("gives the slot back when a grounding lookup throws", async () => {
    mocks.retrieveKnowledge.mockRejectedValueOnce(new Error("embedding service down"));
    await expect(ask()).rejects.toThrow("embedding service down");

    const release: (() => void)[] = [];
    mocks.askKimi.mockImplementation(
      () => new Promise<string>((resolve) => release.push(() => resolve("held"))),
    );
    const held = Array.from({ length: 6 }, () => ask());
    try {
      // All six admitted: a leaked slot would have shed the sixth.
      await vi.waitFor(() => expect(mocks.askKimi).toHaveBeenCalledTimes(6));
    } finally {
      release.forEach((resolve) => resolve());
    }
    await Promise.all(held);
  });

  it("gives the slot back when the model call fails", async () => {
    mocks.askKimi.mockRejectedValue(new KimiError("upstream_error", "502 from gateway"));

    const failed = await Promise.all(Array.from({ length: 6 }, () => ask()));
    expect(failed.map((response) => response.status)).toEqual([502, 502, 502, 502, 502, 502]);

    mocks.askKimi.mockResolvedValue("Here is one concrete next step.");
    expect((await ask()).status).toBe(200);
  });
});

describe("advisor route input validation", () => {
  it("refuses a thread whose last turn is not the teacher's", async () => {
    const response = await post({
      messages: [
        { role: "user", content: "How should I price this?" },
        { role: "assistant", content: "Start at 49 and test." },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Send a message to the advisor." });
    expect(mocks.askKimi).not.toHaveBeenCalled();
  });

  // A control byte in a chat message is never legitimate and is a classic way to
  // smuggle a payload past a downstream parser. Written escaped, not literal:
  // this file keeps its source free of invisible bytes for the same reason the
  // route does. Both bands, because the route promises C1 as well and a C0-only
  // test lets that half be deleted in silence.
  it.each([
    ["C0", "\u0007"],
    ["C1", "\u0085"],
  ])("rejects a message carrying a %s control character", async (_band, char) => {
    const response = await ask(`How do I price${char} this?`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Message contains unsupported characters.",
    });
    expect(mocks.askKimi).not.toHaveBeenCalled();
  });

  // Both caps exist to bound what one request can cost in tokens, and both fail
  // open: drop either and every request still answers 200, just fatter.
  it("forwards only the tail of a long thread, each turn capped", async () => {
    const thread = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn-${i}`,
    }));
    thread[24] = { role: "user", content: "x".repeat(5000) };

    const response = await post({ messages: thread });

    expect(response.status).toBe(200);
    const { messages } = mocks.askKimi.mock.calls[0][0];
    // two system turns + at most the last 20 turns of the thread
    expect(messages).toHaveLength(22);
    expect(messages.some((m: KimiTurn) => m.content === "turn-0")).toBe(false);
    expect(messages[messages.length - 1].content).toHaveLength(4000);
  });
});

describe("advisor route prompt assembly", () => {
  // The test that matters most. If a grounding layer stops reaching the prompt
  // the route still answers 200 and the reply merely turns generic — a failure
  // with no signal anywhere except the quality of the advice.
  it("sends all three grounding layers plus the teacher's turn", async () => {
    mocks.retrieveKnowledge.mockResolvedValue(["RETRIEVED_PASSAGE"]);
    mocks.buildTeacherContext.mockResolvedValue("TEACHER_SNAPSHOT");

    const response = await ask("How should I price this course?");

    expect(response.status).toBe(200);
    expect(mocks.askKimi).toHaveBeenCalledTimes(1);

    const { messages } = mocks.askKimi.mock.calls[0][0];

    // Context rides as its own system turn, separate from the instructions, so
    // that a sentence inside the Doc is harder to read as an instruction.
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("system");
    // And stays out of the instruction turn. Doc text that reads like an order
    // is easier to ignore when it arrives as data than when it is concatenated
    // onto the rules — assert the separation, not just its presence somewhere.
    expect(messages[0].content).not.toContain("RETRIEVED_PASSAGE");

    const context = messages[1].content;
    expect(context).toContain("STATIC_CORPUS");
    expect(context).toContain("RETRIEVED_PASSAGE");
    expect(context).toContain("TEACHER_SNAPSHOT");

    // The retrieved block goes through the real formatKnowledge, which labels it
    // — an unlabelled passage would reach the model as anonymous text.
    expect(context).toContain("# Platform knowledge base");

    // Retrieval is searched with the question, not the whole thread.
    expect(mocks.retrieveKnowledge).toHaveBeenCalledWith(
      expect.anything(),
      "How should I price this course?",
    );
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "How should I price this course?",
    });
  });

  // Every test that sends a single message is blind here: head and tail are the
  // same string. In a real thread they are not, and the newest turn is what gets
  // embedded for retrieval, stored as the user row and used as the title — pick
  // the wrong one and the advisor answers a question from ten turns ago.
  it("searches, stores and titles from the newest turn", async () => {
    mocks.createServer.mockResolvedValue(
      supabase({
        advisor_conversations: { data: { id: "conv-1" }, error: null },
        advisor_messages: { data: null, error: null },
      }),
    );

    await post({
      messages: [
        { role: "user", content: "How should I price this?" },
        { role: "assistant", content: "Start at 49 and test." },
        { role: "user", content: "And the description?" },
      ],
    });

    expect(mocks.retrieveKnowledge).toHaveBeenCalledWith(
      expect.anything(),
      "And the description?",
    );
    expect(chain).toContainEqual({
      table: "advisor_conversations",
      method: "insert",
      args: [{ teacher_id: "teacher", title: "And the description?" }],
    });
    expect(chain).toContainEqual({
      table: "advisor_messages",
      method: "insert",
      args: [
        [
          { conversation_id: "conv-1", role: "user", content: "And the description?" },
          {
            conversation_id: "conv-1",
            role: "assistant",
            content: "Here is one concrete next step.",
          },
        ],
      ],
    });
  });

  it("keeps answering when a grounding layer comes back empty", async () => {
    const response = await ask();

    expect(response.status).toBe(200);
    const { messages } = mocks.askKimi.mock.calls[0][0];
    expect(messages[1].content).toBe("STATIC_CORPUS");
  });
});

describe("advisor route upstream failures", () => {
  it("reports a missing key as unconfigured, not as a broken request", async () => {
    mocks.askKimi.mockRejectedValue(new KimiConfigError());

    const response = await ask();

    expect(response.status).toBe(503);
    // The chat panel keys its calm "being set up" state off this exact string.
    expect(await response.json()).toEqual({
      error: "advisor_not_configured",
      reply: "The studio advisor is being set up and will be available shortly.",
    });
  });

  it("gives an exhausted reasoning budget different copy from a generic failure", async () => {
    mocks.askKimi.mockRejectedValueOnce(
      new KimiError("reasoning_budget_exhausted", "budget gone"),
    );
    const exhausted = await ask();

    mocks.askKimi.mockRejectedValueOnce(new KimiError("upstream_error", "502 from gateway"));
    const generic = await ask();

    expect(exhausted.status).toBe(502);
    expect(generic.status).toBe(502);

    const exhaustedBody = await exhausted.json();
    const genericBody = await generic.json();

    // Retrying an over-broad question fails identically, so the copy has to ask
    // for a narrower one instead of the usual "try again".
    expect(exhaustedBody.error).not.toBe(genericBody.error);
    expect(exhaustedBody.error).toMatch(/one thing at a time/i);
    expect(genericBody.error).toMatch(/try again/i);
  });

  it("reports a timeout as worth retrying", async () => {
    mocks.askKimi.mockRejectedValue(
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    );

    const response = await ask();

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: "The advisor is taking too long to respond. Please try again.",
    });
  });
});

describe("advisor route persistence", () => {
  it("stores the turn and hands back the conversation id", async () => {
    mocks.createServer.mockResolvedValue(
      supabase({
        advisor_conversations: { data: { id: "conv-1" }, error: null },
        advisor_messages: { data: null, error: null },
      }),
    );

    const response = await ask();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reply: "Here is one concrete next step.",
      conversationId: "conv-1",
    });
  });

  // The teacher already has their answer by the time this runs. Losing the
  // transcript is a smaller harm than turning a good reply into an error.
  it("still returns the reply when RLS refuses the write", async () => {
    mocks.createServer.mockResolvedValue(
      supabase({
        advisor_conversations: { data: { id: "conv-1" }, error: null },
        advisor_messages: { data: null, error: { message: "row-level security" } },
      }),
    );

    const response = await ask();

    expect(response.status).toBe(200);
    // conversationId null, not "conv-1": handing it back would have the client
    // keep sending an id that can never store anything.
    expect(await response.json()).toEqual({
      reply: "Here is one concrete next step.",
      conversationId: null,
    });
  });

  // Memory is the whole reason these tables exist. Ignoring the id the client
  // sends back would open a fresh thread on every turn: still 200, still a good
  // reply, and the transcript quietly shattered into one-message conversations.
  it("continues the supplied thread instead of opening a second one", async () => {
    mocks.createServer.mockResolvedValue(
      supabase({ advisor_messages: { data: null, error: null } }),
    );

    const response = await post({
      messages: [{ role: "user", content: "And the description?" }],
      conversationId: "conv-1",
    });

    expect(await response.json()).toEqual({
      reply: "Here is one concrete next step.",
      conversationId: "conv-1",
    });
    expect(mocks.from).not.toHaveBeenCalledWith("advisor_conversations");
    expect(chain).toContainEqual({
      table: "advisor_messages",
      method: "insert",
      args: [
        [
          { conversation_id: "conv-1", role: "user", content: "And the description?" },
          {
            conversation_id: "conv-1",
            role: "assistant",
            content: "Here is one concrete next step.",
          },
        ],
      ],
    });
  });

  // A conversationId is client-supplied and therefore attacker-supplied. RLS is
  // what stops it landing in someone else's thread; this asserts the route's
  // half of that deal — it neither falls back to a thread of its own nor echoes
  // an id the database just refused, which would have the client keep sending it.
  it("does not hand back a conversation id the database refused", async () => {
    mocks.createServer.mockResolvedValue(
      supabase({
        advisor_messages: { data: null, error: { message: "row-level security" } },
      }),
    );

    const response = await post({
      messages: [{ role: "user", content: "Show me that thread." }],
      conversationId: "another-teachers-conversation",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reply: "Here is one concrete next step.",
      conversationId: null,
    });
    expect(mocks.from).not.toHaveBeenCalledWith("advisor_conversations");
  });
});

describe("advisor route thread recovery", () => {
  it("refuses an anonymous caller", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns an empty thread for a teacher who never asked anything", async () => {
    mocks.createServer.mockResolvedValue(
      supabase({ advisor_conversations: { data: null, error: null } }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversationId: null, messages: [] });
    // Nothing to fetch messages for — the second query must not run.
    expect(mocks.from).not.toHaveBeenCalledWith("advisor_messages");
  });

  it("returns the stored messages oldest first", async () => {
    mocks.createServer.mockResolvedValue(
      supabase({
        advisor_conversations: { data: { id: "conv-1" }, error: null },
        advisor_messages: {
          data: [
            { role: "user", content: "How should I price this?" },
            { role: "assistant", content: "Start at 49 and test." },
          ],
          error: null,
        },
      }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      conversationId: "conv-1",
      messages: [
        { role: "user", content: "How should I price this?" },
        { role: "assistant", content: "Start at 49 and test." },
      ],
    });
    // Everything below is invisible to the response body — the stub hands back
    // the same rows however the query is shaped — so it has to be asserted on
    // the query itself or it can be deleted without a single test going red.
    for (const call of [
      // Scoping. RLS is the real fence, but a route that stops asking for its own
      // rows is one policy regression away from serving somebody else's, and the
      // conversation filter is not defence in depth at all: drop it and the
      // teacher's every thread arrives merged into one.
      { table: "advisor_conversations", method: "eq", args: ["teacher_id", "teacher"] },
      { table: "advisor_messages", method: "eq", args: ["conversation_id", "conv-1"] },
      // "Most recent thread" — ascending here reopens the teacher's first ever
      // conversation on every reload.
      {
        table: "advisor_conversations",
        method: "order",
        args: ["updated_at", { ascending: false }],
      },
      // The order the client renders is the database's, not the stub's.
      { table: "advisor_messages", method: "order", args: ["created_at", { ascending: true }] },
    ]) {
      expect(chain).toContainEqual(call);
    }
  });
});
