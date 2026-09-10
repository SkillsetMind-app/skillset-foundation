import { describe, expect, it, vi } from "vitest";
import { fetchCreatorActivationBlocked } from "@/lib/data/creator-verification";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc }) }));

describe("creator activation RPC response", () => {
  it.each([false, true])("preserves the server verdict %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(fetchCreatorActivationBlocked()).resolves.toBe(data);
    expect(rpc).toHaveBeenCalledWith("creator_activation_blocked");
  });

  it.each([null, undefined, 0, "false", { value: false }])("rejects malformed verdict %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(fetchCreatorActivationBlocked()).rejects.toThrow("Activation status unavailable.");
  });
});
