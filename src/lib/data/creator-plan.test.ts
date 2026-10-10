import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCreatorPlanRequired } from "./creator-plan";
import { publishTeacherCourse } from "./teacher-courses";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc }) }));
beforeEach(() => rpc.mockReset());

describe("creator plan verdict", () => {
  it.each([true, false])("returns the server boolean %s", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(fetchCreatorPlanRequired()).resolves.toBe(data);
    expect(rpc).toHaveBeenCalledWith("creator_plan_required");
  });
  it.each([null, {}, "false"])("rejects a malformed verdict %s", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(fetchCreatorPlanRequired()).rejects.toThrow("Creator plan status unavailable");
  });
  it("normalizes the PostgREST error so the publish UI can offer billing", async () => {
    rpc.mockResolvedValue({ error: { message: "creator_plan_required", code: "P0001" } });
    await expect(publishTeacherCourse("course-1")).rejects.toThrow("creator_plan_required");
    await expect(publishTeacherCourse("course-1")).rejects.toMatchObject({ code: "P0001" });
  });
});
