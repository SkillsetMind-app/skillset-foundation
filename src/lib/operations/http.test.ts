// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/rate-limit", () => ({ runRateLimit: vi.fn() }));
vi.mock("@/lib/ops/alert", () => ({ notifyOps: vi.fn() }));

import { PaymentAuthError, PaymentError } from "@/lib/payments/server/auth";
import { caughtFailure, databaseFailure, failure, isSameOrigin, readSmallObject, uuidPattern } from "./http";

const origin = "https://app.example.test";
function request(body?: string, headers?: HeadersInit) {
  return new Request(`${origin}/api/operations/invitations`, { method: "POST", body, headers });
}

describe("operation error responses", () => {
  it("uses an opaque default and permits a deliberate public message", async () => {
    const response = failure(500);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not update access. Please try again." });
    expect(await failure(400, "Invalid request.").json()).toEqual({ error: "Invalid request." });
  });

  it.each([
    ["42501", 403, "This action requires the appropriate account permissions and verification."],
    ["22023", 409, "The invitation or account is unavailable. Check its details and status."],
    ["23505", 409, "The invitation or account is unavailable. Check its details and status."],
    ["P0002", 409, "The invitation or account is unavailable. Check its details and status."],
    ["XX000", 500, "Could not update access. Please try again."],
    [undefined, 500, "Could not update access. Please try again."],
  ])("maps DB code %s without exposing provider fields", async (code, status, message) => {
    const error = { code, message: "private database diagnostic", details: "private row", hint: "private schema" };
    const response = databaseFailure(error);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
  });

  it.each([
    new PaymentAuthError(), new PaymentError("Admin privileges are required.", 403),
    new PaymentError("Too many attempts.", 429),
  ])("preserves deliberate PaymentError status and message: %s", async (error) => {
    const response = caughtFailure(error);
    expect(response.status).toBe(error.status);
    expect(await response.json()).toEqual({ error: error.message });
  });

  it.each([new Error("private diagnostic"), { status: 403, message: "private diagnostic", name: "PaymentError" }, "private diagnostic", null])("does not trust arbitrary thrown values: %j", async (error) => {
    const response = caughtFailure(error);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not update access. Please try again." });
  });
});

describe("operation request boundaries", () => {
  it.each([
    [undefined, true], [origin, true], ["https://foreign.example.test", false],
    ["http://app.example.test", false], [`${origin}:444`, false],
    [`${origin}.foreign.example.test`, false], ["null", false],
  ])("compares the actual origin (%s), preserving requests without Origin", (header, expected) => {
    expect(isSameOrigin(request(undefined, header === undefined ? undefined : { Origin: header }))).toBe(expected);
  });

  it("does not trust a forwarded host to excuse a foreign origin", () => {
    expect(isSameOrigin(request(undefined, {
      Origin: "https://foreign.example.test", "X-Forwarded-Host": "foreign.example.test",
    }))).toBe(false);
  });

  it.each(["22222222-2222-4222-8222-222222222222", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"])("accepts a whole UUID (%s)", (id) => {
    expect(uuidPattern.test(id)).toBe(true);
  });

  it.each(["", "not-a-uuid", "22222222-2222-4222-8222-222222222222/path", " 22222222-2222-4222-8222-222222222222"])("rejects a malformed UUID (%s)", (id) => {
    expect(uuidPattern.test(id)).toBe(false);
  });

  it("returns a JSON object without altering its fields", async () => {
    const value = { action: "waive", waived: false, nested: { count: 1 } };
    await expect(readSmallObject(request(JSON.stringify(value)))).resolves.toEqual(value);
  });

  it.each([undefined, "", "{", "null", "[]", '"text"', "false", "42"])("rejects missing, malformed or non-object JSON (%s)", async (body) => {
    const input = request(body);
    await expect(readSmallObject(input)).rejects.toMatchObject({ status: 400, message: "Invalid request." });
    expect(input.body?.locked ?? false).toBe(false);
  });

  it("accepts exactly 2048 bytes and rejects 2049 without Content-Length", async () => {
    const value = { value: "a".repeat(2036) };
    const text = JSON.stringify(value);
    expect(new TextEncoder().encode(text)).toHaveLength(2048);
    const input = request(text);
    expect(input.headers.has("Content-Length")).toBe(false);
    await expect(readSmallObject(input)).resolves.toEqual(value);
    expect(input.body?.locked).toBe(false);
    await expect(readSmallObject(request(`${text} `))).rejects.toMatchObject({ status: 413 });
  });

  it("counts UTF-8 bytes rather than characters or an understated Content-Length", async () => {
    const text = JSON.stringify({ value: "\u00e9".repeat(1020) });
    expect(text.length).toBeLessThan(2048);
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(2048);
    await expect(readSmallObject(request(text, { "Content-Length": "1" }))).rejects.toMatchObject({ status: 413 });
  });

  it("reassembles chunks even when a UTF-8 character is split between them", async () => {
    const value = { value: "\u00e9" };
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const split = bytes.indexOf(0xc3) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close(); },
    });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body: stream, duplex: "half" };
    await expect(readSmallObject(new Request(origin, init))).resolves.toEqual(value);
    expect(stream.locked).toBe(false);
  });

  it("cancels an oversized multi-chunk stream and releases its reader", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1024)); controller.enqueue(new Uint8Array(1025)); },
      cancel,
    });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body: stream, duplex: "half" };
    const input = new Request(origin, init);
    expect(input.headers.has("Content-Length")).toBe(false);
    await expect(readSmallObject(input)).rejects.toMatchObject({ status: 413, message: "Request is too large." });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it("releases a failed stream without mistaking a transport error for a valid body", async () => {
    const error = new Error("private stream diagnostic");
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(error); } });
    const init: RequestInit & { duplex: "half" } = { method: "POST", body: stream, duplex: "half" };
    await expect(readSmallObject(new Request(origin, init))).rejects.toBe(error);
    expect(stream.locked).toBe(false);
    expect(await caughtFailure(error).json()).toEqual({ error: "Could not update access. Please try again." });
  });
});
