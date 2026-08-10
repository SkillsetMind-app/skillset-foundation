"use client";

import type { SkillsetUser } from "@/domain/auth";
import type {
  Leaderboard,
  LeaderboardEntry,
  LeaderboardWindow,
  MemberStats,
} from "@/domain/gamification";
import { levelForPoints } from "@/domain/gamification";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type CommunityPostLikeRow =
  Database["public"]["Tables"]["community_post_likes"]["Row"];
type MemberStatsRow = Database["public"]["Tables"]["member_stats"]["Row"];
type LeaderboardRow = Database["public"]["Tables"]["leaderboards"]["Row"];

function nowIso(): string {
  return new Date().toISOString();
}

function rowToMemberStats(row: MemberStatsRow): MemberStats {
  const points = row.points ?? 0;
  return {
    uid: row.uid,
    displayName: row.display_name && row.display_name.trim() ? row.display_name : "Member",
    points,
    level: row.level ?? levelForPoints(points),
    totalLikesReceived: row.total_likes_received ?? 0,
    updatedAt: row.updated_at,
  };
}

function rowToLeaderboard(row: LeaderboardRow): Leaderboard {
  return {
    window: row.window as LeaderboardWindow,
    entries: (row.entries as unknown as LeaderboardEntry[]) ?? [],
    updatedAt: row.updated_at,
  };
}

/**
 * Toggle the current user's like on a post. The like is a presence row whose
 * primary key is (post_id, liker_id) (one like per user); server triggers award
 * the post author +/-1 point. Liking your own post is allowed but earns nothing
 * (the trigger skips self-likes); callers should hide the control on own posts.
 */
export async function setCommunityPostLike(
  postId: string,
  liked: boolean,
  user: SkillsetUser,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  if (liked) {
    const { error } = await supabase.from("community_post_likes").upsert(
      {
        post_id: postId,
        liker_id: user.uid,
        created_at: nowIso(),
      },
      { onConflict: "post_id,liker_id" },
    );

    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("community_post_likes")
      .delete()
      .eq("post_id", postId)
      .eq("liker_id", user.uid);

    if (error) throw error;
  }
}

export type PostLikeState = {
  count: number;
  likerIds: string[];
};

/** Live like count + liker ids for one post (the card derives "did I like"). */
export function subscribeToPostLikes(
  postId: string,
  callback: (state: PostLikeState) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from("community_post_likes")
      .select("liker_id")
      .eq("post_id", postId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const rows = (data ?? []) as Pick<CommunityPostLikeRow, "liker_id">[];
    callback({
      count: rows.length,
      likerIds: rows.map((r) => r.liker_id),
    });
  };

  void load();

  const channel = supabase
    .channel(`community_post_likes:post:${postId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "community_post_likes",
        filter: `post_id=eq.${postId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

function normalizeMemberStats(uid: string, data: Partial<MemberStats>): MemberStats {
  const points = typeof data.points === "number" ? data.points : 0;
  return {
    uid,
    displayName:
      typeof data.displayName === "string" && data.displayName.trim()
        ? data.displayName
        : "Member",
    points,
    level: typeof data.level === "number" ? data.level : levelForPoints(points),
    totalLikesReceived:
      typeof data.totalLikesReceived === "number" ? data.totalLikesReceived : 0,
  };
}

/**
 * Fetch the gamification stats (level/points) for a specific set of members,
 * used to render level badges next to post/comment authors and the viewer's own
 * leaderboard row.
 *
 * Reads one row per known uid — the current user plus authors of posts/comments
 * in a course the viewer is enrolled in. RLS on `member_stats` scopes reads to
 * your own row plus members you share a course with, so the roster a caller can
 * reach is already bounded server-side; this per-uid shape is just what the
 * badge UI needs. A per-uid failure (or missing row) simply omits that badge —
 * it never rejects the whole map or breaks the feed.
 */
export async function fetchMemberStatsForUids(
  uids: string[],
): Promise<Map<string, MemberStats>> {
  const unique = [...new Set(uids.filter((uid) => uid))];
  const statsByUid = new Map<string, MemberStats>();

  await Promise.all(
    unique.map(async (uid) => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase
          .from("member_stats")
          .select("*")
          .eq("uid", uid)
          .maybeSingle();

        if (data) {
          statsByUid.set(uid, normalizeMemberStats(uid, rowToMemberStats(data)));
        }
      } catch {
        // A single unreadable member just loses its badge; the rest still load.
      }
    }),
  );

  return statsByUid;
}

/** Live precomputed leaderboard for one window. */
export function subscribeToLeaderboard(
  window: LeaderboardWindow,
  callback: (board: Leaderboard | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  void supabase
    .from("leaderboards")
    .select("*")
    .eq("window", window)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      callback(data ? rowToLeaderboard(data) : null);
    });

  const channel = supabase
    .channel(`leaderboards:window:${window}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "leaderboards",
        filter: `window=eq.${window}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          callback(null);
          return;
        }
        callback(rowToLeaderboard(payload.new as unknown as LeaderboardRow));
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
