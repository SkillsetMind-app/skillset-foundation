import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

vi.mock("@/lib/supabase/config", () => ({
  assertSupabaseClientConfig: () => ({
    url: "https://project.example.test",
    anonKey: "publishable-test-key",
  }),
}));

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

describe("Supabase browser Realtime channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps every channel private while preserving its feature config", () => {
    const realtimeChannel = {};
    const originalChannel = vi.fn(() => realtimeChannel);
    mocks.createBrowserClient.mockReturnValue({ channel: originalChannel });

    const client = getSupabaseBrowserClient();
    expect(client.channel("orders")).toBe(realtimeChannel);
    expect(originalChannel).toHaveBeenNthCalledWith(1, "orders#1", {
      config: { private: true },
    });

    client.channel("community-presence:course", {
      config: { presence: { key: "student-1" } },
    });
    expect(originalChannel).toHaveBeenNthCalledWith(2, "community-presence:course#2", {
      config: {
        presence: { key: "student-1" },
        private: true,
      },
    });
  });
});
