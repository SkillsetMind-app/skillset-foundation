import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePublishGates } from "@/components/teacher/use-publish-gates";

const mocks = vi.hoisted(() => ({
  planRequired: vi.fn<() => Promise<boolean>>(),
  profile: null as null | { creatorVerificationStatus?: string },
  fail: false,
}));
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: mocks.planRequired }));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (
    _uid: string,
    onData: (profile: unknown) => void,
    onError: (error: Error) => void,
  ) => {
    queueMicrotask(() => (mocks.fail ? onError(new Error("offline")) : onData(mocks.profile)));
    return () => {};
  },
}));
vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: async () => false,
  fetchCreatorActivationBlocked: async () => false,
}));

beforeEach(() => {
  mocks.profile = null;
  mocks.fail = false;
  mocks.planRequired.mockReset().mockResolvedValue(false);
});

describe("creator plan gate", () => {
  it("uses the server verdict and fails closed on read errors", async () => {
    mocks.planRequired.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => usePublishGates({ uid: "teacher-1" }));
    expect(result.current.account.planRequired).toBe(true);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.account.planRequired).toBe(true);
  });

  it("does not carry another account's entitlement across a user switch", async () => {
    const { result, rerender } = renderHook(({ uid }) => usePublishGates({ uid }), {
      initialProps: { uid: "teacher-1" },
    });
    await waitFor(() => expect(result.current.account.planRequired).toBe(false));
    mocks.planRequired.mockImplementationOnce(() => new Promise(() => {}));
    rerender({ uid: "teacher-2" });
    expect(result.current.account.planRequired).toBe(true);
    expect(result.current.loaded).toBe(false);
  });
});

// The badge status decides the offer and the studio row. With no read there is
// no status: null, and nobody offers the badge to someone who may already have it.
describe("verificationStatus", () => {
  it("is null before the read arrives", () => {
    const { result } = renderHook(() => usePublishGates({ uid: "teacher-1" }));
    expect(result.current.verificationStatus).toBeNull();
  });

  it("stays null when the read fails", async () => {
    mocks.fail = true;
    const { result } = renderHook(() => usePublishGates({ uid: "teacher-1" }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.verificationStatus).toBeNull();
  });

  it("brings the status read, and 'none' when the profile has none", async () => {
    mocks.profile = { creatorVerificationStatus: "rejected" };
    const first = renderHook(() => usePublishGates({ uid: "teacher-1" }));
    await waitFor(() => expect(first.result.current.verificationStatus).toBe("rejected"));

    mocks.profile = {};
    const second = renderHook(() => usePublishGates({ uid: "teacher-2" }));
    await waitFor(() => expect(second.result.current.verificationStatus).toBe("none"));
  });
});
