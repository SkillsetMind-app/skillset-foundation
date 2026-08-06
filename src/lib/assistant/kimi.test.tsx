import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KimiConfigError, KimiError, askKimi } from "./kimi";

// A stand-in key with a shape nothing would mistake for a real credential. Its
// only job is to be searchable: the HTTP-error case asserts it never appears in
// a thrown message.
const FAKE_KEY = "kimi-test-key-value";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function reply(content: string) {
  return { choices: [{ message: { role: "assistant", content } }] };
}

// The rejection is the assertion target in the failure cases below; `.catch()`
// alone widens the type back to include the resolved string.
async function askAndCatch(): Promise<KimiError> {
  try {
    await askKimi({ messages: [{ role: "user", content: "hi" }] });
  } catch (thrown) {
    return thrown as KimiError;
  }
  throw new Error("expected askKimi to reject");
}

describe("askKimi", () => {
  beforeEach(() => {
    vi.stubEnv("KIMI_API_KEY", FAKE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses to call Moonshot at all when the key is unset, so the caller can say 'being set up'", async () => {
    vi.stubEnv("KIMI_API_KEY", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(askKimi({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
      KimiConfigError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the model's answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(reply("Price it at USD 49.")));
    vi.stubGlobal("fetch", fetchMock);

    const out = await askKimi({ messages: [{ role: "user", content: "What price?" }] });

    expect(out).toBe("Price it at USD 49.");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(JSON.parse(String(init.body)).model).toBe("kimi-k2.6");
    // A mis-named or missing auth header is a 401 on every call in production
    // and nothing here would have noticed.
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  // Regression guard for a bug that shipped green: the client used to send
  // temperature: 0.2, every mocked test passed, and the live endpoint answered
  //   400 {"error":{"message":"invalid temperature: only 1 is allowed for this model"}}
  // i.e. 100% of advisor calls would have failed in production. A mock never
  // argues about the request body, so the only defence is asserting on the body
  // we send rather than on the reply we get back. Adding temperature back here —
  // however sensible it looks — breaks the feature outright.
  it("sends no temperature, which both Kimi models reject outright", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(reply("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await askKimi({ messages: [{ role: "user", content: "hi" }] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("temperature");
  });

  // "Make it think harder" is the obvious next edit, and every version of it is
  // wrong here. Measured against the live endpoint: kimi-k2.6 already reasons
  // unprompted (3330 tokens on a hard question), enable_thinking:true produced
  // FEWER (2484), and thinking:{type:"enabled"} spent 4095 of a 4096 budget and
  // came back finish_reason "length" — a blank answer. There is no switch to
  // flip, and the one that looks most like a switch starves the reply.
  it("sends no thinking flag — k2.6 reasons by default and the flags backfire", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(reply("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await askKimi({ messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("enable_thinking");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  // The trap this client exists to survive: a reasoning model that spends its
  // whole budget thinking answers HTTP 200 with an empty string. Measured at
  // max_tokens=12 -> content "" with reasoning_tokens 9.
  it("names the reasoning budget when the model thought but never answered", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ...reply(""),
        usage: { completion_tokens: 0, completion_tokens_details: { reasoning_tokens: 9 } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await askAndCatch();

    expect(error).toBeInstanceOf(KimiError);
    expect(error.code).toBe("reasoning_budget_exhausted");
    expect(error.message).toContain("reasoning");
    expect(error.message).toContain("9");
  });

  it("does not blame the reasoning budget when the model simply said nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(reply(""))));

    const error = await askAndCatch();

    expect(error.code).toBe("empty_reply");
    expect(error.message).not.toContain("reasoning");
  });

  // Thinking then declining looks identical to thinking then running out, if the
  // only evidence you read is reasoning_tokens. finish_reason settles it, and
  // getting this wrong sends the next person to raise a ceiling that was fine.
  it("does not blame the budget when the model finished on its own after thinking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "" } }],
          usage: { completion_tokens_details: { reasoning_tokens: 240 } },
        }),
      ),
    );

    const error = await askAndCatch();

    expect(error.code).toBe("empty_reply");
  });

  it("trusts finish_reason 'length' even when the server reports no usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ finish_reason: "length", message: { role: "assistant", content: "" } }],
        }),
      ),
    );

    expect((await askAndCatch()).code).toBe("reasoning_budget_exhausted");
  });

  // Some OpenAI-compatible servers answer with content parts instead of a
  // string. Calling .trim() on that throws a TypeError, which is not a KimiError
  // and so slips past every caller that catches one.
  it("reports a non-string content as a KimiError instead of crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }],
        }),
      ),
    );

    expect(await askAndCatch()).toBeInstanceOf(KimiError);
  });

  it("surfaces the API's own error text", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: "max_tokens is too large", type: "invalid_request_error" } }, 400),
        ),
    );

    const error = await askAndCatch();

    expect(error).toBeInstanceOf(KimiError);
    expect(error.code).toBe("upstream_error");
    expect(error.message).toContain("400");
    expect(error.message).toContain("max_tokens is too large");
  });

  // The leak that actually happens: OpenAI-compatible auth errors quote the key
  // they rejected, and this message goes to the server log. Asserting against an
  // upstream body that never held the key would prove nothing, so this one holds
  // it.
  it("redacts the key when the API quotes it back in an auth error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: `Incorrect API key provided: ${FAKE_KEY}.` } }, 401),
        ),
    );

    const error = await askAndCatch();

    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.message).toContain("[redacted]");
  });

  // HTTP/2 has no reason phrase, so statusText is "" rather than absent — a
  // nullish fallback here silently produces "failed (500): ".
  it("still says something when the body is not JSON and statusText is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
    );

    expect((await askAndCatch()).message).toContain("no detail returned");
  });
});
