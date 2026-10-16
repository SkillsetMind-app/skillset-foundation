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

// O status do selo decide a oferta e a linha do estúdio. Sem leitura não há
// status: null, e ninguém oferece o selo a quem talvez já o tenha.
describe("verificationStatus", () => {
  it("é null antes de a leitura chegar", () => {
    const { result } = renderHook(() => usePublishGates({ uid: "teacher-1" }));
    expect(result.current.verificationStatus).toBeNull();
  });

  it("fica null quando a leitura falha", async () => {
    mocks.fail = true;
    const { result } = renderHook(() => usePublishGates({ uid: "teacher-1" }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.verificationStatus).toBeNull();
  });

  it("traz o status lido, e 'none' quando o perfil não tem nenhum", async () => {
    mocks.profile = { creatorVerificationStatus: "rejected" };
    const first = renderHook(() => usePublishGates({ uid: "teacher-1" }));
    await waitFor(() => expect(first.result.current.verificationStatus).toBe("rejected"));

    mocks.profile = {};
    const second = renderHook(() => usePublishGates({ uid: "teacher-2" }));
    await waitFor(() => expect(second.result.current.verificationStatus).toBe("none"));
  });
});
