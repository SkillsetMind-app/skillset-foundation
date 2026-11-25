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

import { getServerEnrollmentSeed } from "@/lib/data/server/learner-enrollments";

// The enrollments /learn leaves the server with. Null always means "let the
// browser read it", so the dashboard can only get faster, never different.

function client(result: { data: unknown; error: unknown }) {
  const eq = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  mocks.createSupabaseServerClient.mockResolvedValue({ from });
  return { from, select, eq };
}

describe("getServerEnrollmentSeed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isDocumentRequest.mockResolvedValue(true);
    mocks.getServerAccount.mockResolvedValue({ user: { uid: "student-1" }, profile: {} });
  });

  it("reads nothing when nobody is signed in", async () => {
    mocks.getServerAccount.mockResolvedValue(null);
    client({ data: [], error: null });

    await expect(getServerEnrollmentSeed()).resolves.toBeNull();
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("reads nothing on an in-app navigation: the route opens at once, as before", async () => {
    mocks.isDocumentRequest.mockResolvedValue(false);
    client({ data: [], error: null });

    await expect(getServerEnrollmentSeed()).resolves.toBeNull();
    // Not even the account: nothing may hold the navigation back.
    expect(mocks.getServerAccount).not.toHaveBeenCalled();
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("reads the signed-in person's own rows and sends them sorted by title, tagged with the account", async () => {
    const { from, select, eq } = client({
      data: [
        { id: "2", course_title: "Zen for Teams" },
        { id: "1", course_title: "Brand Design" },
      ],
      error: null,
    });

    await expect(getServerEnrollmentSeed()).resolves.toEqual({
      id: expect.any(String),
      uid: "student-1",
      rows: [
        { id: "1", course_title: "Brand Design" },
        { id: "2", course_title: "Zen for Teams" },
      ],
    });
    expect(from).toHaveBeenCalledWith("enrollments");
    expect(select).toHaveBeenCalledWith("*");
    expect(eq).toHaveBeenCalledWith("user_id", "student-1");
  });

  it("gives every read its own id, so the dashboard can tell a fresh one from a cached one", async () => {
    client({ data: [], error: null });

    const first = await getServerEnrollmentSeed();
    const second = await getServerEnrollmentSeed();

    expect(first?.id).toBeTruthy();
    expect(second?.id).not.toBe(first?.id);
  });

  it("an empty list is still an answer (the empty state), not null", async () => {
    client({ data: [], error: null });

    await expect(getServerEnrollmentSeed()).resolves.toMatchObject({ uid: "student-1", rows: [] });
  });

  it("leaves it to the browser when the read fails or throws", async () => {
    client({ data: null, error: { message: "permission denied" } });
    await expect(getServerEnrollmentSeed()).resolves.toBeNull();

    mocks.createSupabaseServerClient.mockRejectedValue(new Error("no config"));
    await expect(getServerEnrollmentSeed()).resolves.toBeNull();
  });
});
