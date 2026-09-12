import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SkillsetUser } from "@/domain/auth";
import { subscribeToCommunityPresence } from "@/lib/data/community-presence";

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  }),
}));

describe("community presence authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("joins a private channel so Realtime enforces membership policies", () => {
    const channel = {
      on: vi.fn(),
      subscribe: vi.fn(),
      presenceState: vi.fn(() => ({})),
      track: vi.fn(),
    };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    mocks.channel.mockReturnValue(channel);

    const stop = subscribeToCommunityPresence(
      "psychology-foundations",
      {
        uid: "student-1",
        displayName: "Student One",
      } as SkillsetUser,
      vi.fn(),
    );

    expect(mocks.channel).toHaveBeenCalledWith("community-presence:psychology-foundations", {
      config: {
        private: true,
        presence: { key: "student-1" },
      },
    });

    stop();
    expect(mocks.removeChannel).toHaveBeenCalledWith(channel);
  });
});
