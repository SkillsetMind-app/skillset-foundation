import { afterEach, beforeEach, expect, it, vi } from "vitest";

// posthog-js itself is faked: the question here is what OUR client hands it.
const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthog }));

const CONSENT_KEY = "skillset.cookie-consent.v1";

// The client keeps an `initialized` flag at module scope; each test starts
// from a fresh copy, like a fresh page load.
async function freshClient() {
  vi.resetModules();
  return import("@/lib/posthog/client");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_funnel");
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

it("sends nothing without an explicit Accept, even once PostHog is initialized", async () => {
  const client = await freshClient();
  client.initPostHog();

  expect(client.captureEvent("course_viewed", { course_id: "course-1" })).toBe(false);
  window.localStorage.setItem(CONSENT_KEY, "rejected");
  expect(client.captureEvent("course_viewed", { course_id: "course-1" })).toBe(false);
  expect(posthog.capture).not.toHaveBeenCalled();
});

// React runs a child's effects before its parent's, so a page tracker fires
// before PostHogProvider's init effect. That first event used to be dropped.
it("does not drop the first event of a page load that fires before the provider's init", async () => {
  window.localStorage.setItem(CONSENT_KEY, "accepted");
  const client = await freshClient();

  expect(client.captureEvent("course_viewed", { course_id: "course-1" })).toBe(true);
  expect(posthog.init).toHaveBeenCalledTimes(1);
  expect(posthog.capture).toHaveBeenCalledExactlyOnceWith("course_viewed", { course_id: "course-1" });
});

// Control: no key configured, no analytics at all, consent or not.
it("stays silent when no PostHog key is configured", async () => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  window.localStorage.setItem(CONSENT_KEY, "accepted");
  const client = await freshClient();

  expect(client.captureEvent("course_viewed", { course_id: "course-1" })).toBe(false);
  expect(posthog.init).not.toHaveBeenCalled();
  expect(posthog.capture).not.toHaveBeenCalled();
});
