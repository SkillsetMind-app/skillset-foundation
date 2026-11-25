"use client";

import type { SkillsetUser } from "@/domain/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PresentMember = {
  uid: string;
  name: string;
};

// "3 online · 38 members" — who is in the community RIGHT NOW. Supabase Realtime
// Presence: each tab joins the course channel with its own name; the server
// merges and notifies everyone. It writes nothing to the database and goes away when the tab closes.
export function subscribeToCommunityPresence(
  courseSlug: string,
  user: SkillsetUser,
  callback: (members: PresentMember[]) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  const channel = supabase.channel(`community-presence:${courseSlug}`, {
    config: { private: true, presence: { key: user.uid } },
  });

  const publish = () => {
    const state = channel.presenceState<PresentMember>();
    const members = new Map<string, PresentMember>();
    for (const entries of Object.values(state)) {
      for (const entry of entries) {
        if (entry.uid) {
          members.set(entry.uid, { uid: entry.uid, name: entry.name });
        }
      }
    }
    callback([...members.values()]);
  };

  channel
    .on("presence", { event: "sync" }, publish)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track({
          uid: user.uid,
          name: user.displayName?.trim() || "SkillsetMind member",
        });
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
