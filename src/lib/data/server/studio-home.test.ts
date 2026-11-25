// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAccount: vi.fn(),
  isDocumentRequest: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/server-session", () => ({
  getServerAccount: mocks.getServerAccount,
  isDocumentRequest: mocks.isDocumentRequest,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { getServerStudioSeed } from "@/lib/data/server/studio-home";

// The products and publish gates /teach leaves the server with. Null always
// means "let the browser read it"; a null gate means "the browser reads that
// one". Either way the home can only get faster, never different.

type Answer = { data: unknown; error: unknown };

function client({
  courses = { data: [{ id: "c1", title: "Course" }], error: null } as Answer,
  flag = { data: { value: true }, error: null } as Answer,
  blocked = { data: false, error: null } as Answer,
  plan = { data: true, error: null } as Answer,
} = {}) {
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: (column: string, value: string) =>
        table === "courses"
          ? Promise.resolve(courses).then((answer) => {
              calls.push(`${table}.${column}=${value}`);
              return answer;
            })
          : { maybeSingle: () => Promise.resolve(flag) },
    }),
  }));
  const rpc = vi.fn((name: string) =>
    Promise.resolve(name === "creator_activation_blocked" ? blocked : plan),
  );
  const calls: string[] = [];
  mocks.createSupabaseServerClient.mockResolvedValue({ from, rpc });
  return { from, rpc, calls };
}

const creator = {
  user: { uid: "teacher-1", roles: ["teacher"] },
  profile: {
    stripeConnectChargesEnabled: true,
    stripeConnectPayoutsEnabled: true,
    creatorVerificationStatus: "approved",
    stripeConnectCountry: "US",
    currentPlanId: "plus",
  },
};

describe("getServerStudioSeed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isDocumentRequest.mockResolvedValue(true);
    mocks.getServerAccount.mockResolvedValue(creator);
  });

  it("reads nothing on an in-app navigation, for nobody, or for someone who does not teach", async () => {
    client();

    mocks.isDocumentRequest.mockResolvedValue(false);
    await expect(getServerStudioSeed()).resolves.toBeNull();
    expect(mocks.getServerAccount).not.toHaveBeenCalled();

    mocks.isDocumentRequest.mockResolvedValue(true);
    mocks.getServerAccount.mockResolvedValue(null);
    await expect(getServerStudioSeed()).resolves.toBeNull();

    mocks.getServerAccount.mockResolvedValue({ ...creator, user: { uid: "s-1", roles: ["student"] } });
    await expect(getServerStudioSeed()).resolves.toBeNull();

    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("sends the creator's own products and every gate, tagged with the account and the read", async () => {
    const { calls, rpc } = client();

    const seed = await getServerStudioSeed();

    expect(seed).toEqual({
      id: expect.any(String),
      uid: "teacher-1",
      courseRows: [{ id: "c1", title: "Course" }],
      gates: {
        payoutsReady: true,
        verificationStatus: "approved",
        stripeConnectCountry: "US",
        planId: "plus",
        requireVerification: true,
        activationBlocked: false,
        planRequired: true,
      },
    });
    expect(calls).toEqual(["courses.owner_id=teacher-1"]);
    expect(rpc).toHaveBeenCalledWith("creator_activation_blocked");
    expect(rpc).toHaveBeenCalledWith("creator_plan_required");
  });

  it("reads a profile with nothing set the way the hook does", async () => {
    mocks.getServerAccount.mockResolvedValue({ ...creator, profile: {} });
    client({ flag: { data: null, error: null } });

    await expect(getServerStudioSeed()).resolves.toMatchObject({
      gates: {
        payoutsReady: false,
        verificationStatus: "none",
        stripeConnectCountry: null,
        planId: "free",
        requireVerification: false,
      },
    });
  });

  it("a gate it could not read is 'unknown', never 'no': the browser reads that one", async () => {
    client({
      flag: { data: null, error: { message: "down" } },
      blocked: { data: null, error: { message: "down" } },
      // Not a boolean: the browser treats that as unavailable too.
      plan: { data: { value: true }, error: null },
    });

    await expect(getServerStudioSeed()).resolves.toMatchObject({
      gates: { requireVerification: null, activationBlocked: null, planRequired: null },
    });
  });

  it("leaves everything to the browser when the products cannot be read", async () => {
    client({ courses: { data: null, error: { message: "permission denied" } } });
    await expect(getServerStudioSeed()).resolves.toBeNull();

    mocks.createSupabaseServerClient.mockRejectedValue(new Error("no config"));
    await expect(getServerStudioSeed()).resolves.toBeNull();
  });

  it("does not put a heavy catalog inside the HTML", async () => {
    // A course row carries its whole outline, lesson text included.
    client({ courses: { data: [{ id: "c1", modules: "x".repeat(70_000) }], error: null } });

    await expect(getServerStudioSeed()).resolves.toBeNull();
  });
});
