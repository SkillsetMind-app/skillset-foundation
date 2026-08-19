import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notifyOps: vi.fn() }));

vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notifyOps }));

async function run(country: string | null, allowList?: string) {
  vi.resetModules();
  if (allowList === undefined) {
    delete process.env.GEO_ALLOWED_COUNTRIES;
  } else {
    process.env.GEO_ALLOWED_COUNTRIES = allowList;
  }
  const { middleware } = await import("@/middleware");
  const headers = new Headers();
  if (country !== null) {
    headers.set("x-vercel-ip-country", country);
  }
  return middleware(
    new NextRequest("https://www.skillsetmind.com/auth?mode=signin", {
      headers,
    }),
  );
}

afterEach(() => {
  delete process.env.GEO_ALLOWED_COUNTRIES;
  vi.clearAllMocks();
});

describe("country filter", () => {
  it("allows a country on the list", async () => {
    const response = await run("US");
    expect(response.status).toBe(200);
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });

  it("allows Brazil by default, because the founder is there", async () => {
    // The default list locking the owner out of his own platform is the most
    // expensive way this feature can fail, so it is asserted, not assumed.
    const response = await run("BR");
    expect(response.status).toBe(200);
  });

  it("refuses a country off the list and reports it", async () => {
    const response = await run("RU");
    expect(response.status).toBe(403);
    expect(mocks.notifyOps).toHaveBeenCalledTimes(1);
  });

  it("allows when the country is unknown", async () => {
    // Fails open on purpose. A filter that blocks whenever the signal is
    // missing takes the platform down the first time the header hiccups.
    const response = await run(null);
    expect(response.status).toBe(200);
  });

  it("allows everything when the list is emptied", async () => {
    // Emptying the variable is how the filter gets switched off in a hurry.
    // It has to mean "allow all", never "allow none".
    const response = await run("RU", "");
    expect(response.status).toBe(200);
  });

  it("reads the list from the environment, tolerating spaces and case", async () => {
    const response = await run("PT", " us , pt ");
    expect(response.status).toBe(200);
  });
});
