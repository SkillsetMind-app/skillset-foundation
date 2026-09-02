"use client";

import type { SkillsetUser } from "@/domain/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PresentMember = {
  uid: string;
  name: string;
};

// "3 online · 38 members" — quem esta na comunidade AGORA. Supabase Realtime
// Presence: cada aba entra no canal do curso com o proprio nome; o servidor
// junta e avisa a todos. Nao grava nada no banco e some quando a aba fecha.
export function subscribeToCommunityPresence(
  courseSlug: string,
  user: SkillsetUser,
  callback: (members: PresentMember[]) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  const channel = supabase.channel(`community-presence:${courseSlug}`, {
    config: { presence: { key: user.uid } },
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
