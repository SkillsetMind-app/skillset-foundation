import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountControl, setAccountControl } from "@/lib/data/account-controls";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc }) }));
beforeEach(() => { rpc.mockReset(); });

describe("account controls transport", () => {
  it("uses the authenticated RPC and maps live status without profile fallback", async () => {
    rpc.mockResolvedValue({ data: { suspended: true, blocked_email: "person@example.test", is_self: false }, error: null });
    expect(await getAccountControl("u2")).toEqual({ suspended: true, blockedEmail: "person@example.test", isSelf: false });
    expect(rpc).toHaveBeenCalledWith("admin_get_account_control", { p_target_uid: "u2" });
    await setAccountControl("u2", "restore", "  Documented reason  ");
    expect(rpc).toHaveBeenLastCalledWith("admin_set_account_control", { p_target_uid: "u2", p_action: "restore", p_reason: "Documented reason" });
  });

  it.each([null, {}, { suspended: "false", blocked_email: null }, { suspended: false }, { suspended: false, blocked_email: 1 }])("rejects malformed status %#", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(getAccountControl("u2")).rejects.toThrow("Account status unavailable.");
  });

  it("never treats an RPC failure as successful restoration", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "ACCOUNT_CONTROL_LAST_ADMIN" } });
    await expect(setAccountControl("u2", "restore", "Reason")).rejects.toMatchObject({ message: "ACCOUNT_CONTROL_LAST_ADMIN" });
  });
});
