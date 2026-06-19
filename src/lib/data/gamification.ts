"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";

import type { SkillsetUser } from "@/domain/auth";
import type {
  Leaderboard,
  LeaderboardWindow,
  MemberStats,
} from "@/domain/gamification";
import { levelForPoints } from "@/domain/gamification";
import { getFirestoreDb } from "@/lib/firebase/client";

const communityPostsCollection = "communityPosts";

/**
 * Toggle the current user's like on a post. The like is a presence doc whose id
 * is the user's uid (one like per user); server triggers award the post author
 * +/-1 point. Liking your own post is allowed but earns nothing (the trigger
 * skips self-likes); callers should hide the control on own posts.
 */
export async function setCommunityPostLike(
  postId: string,
  liked: boolean,
  user: SkillsetUser,
): Promise<void> {
  const likeRef = doc(
    getFirestoreDb(),
    communityPostsCollection,
    postId,
    "likes",
    user.uid,
  );

  if (liked) {
    await setDoc(likeRef, {
      likerId: user.uid,
      postId,
      createdAt: serverTimestamp(),
    });
  } else {
    await deleteDoc(likeRef);
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
): Unsubscribe {
  return onSnapshot(
    collection(getFirestoreDb(), communityPostsCollection, postId, "likes"),
    (snapshot) => {
      callback({
        count: snapshot.size,
        likerIds: snapshot.docs.map((document) => document.id),
      });
    },
    onError,
  );
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
 * Reads each doc individually by its known uid (a `get`, not a `list`) so it
 * only ever touches members the caller already legitimately knows — the current
 * user plus authors of posts/comments in a course the viewer is enrolled in.
 * The collection deliberately forbids `list` (firestore.rules memberStats) so
 * the full member roster can never be enumerated; this scoped fetch is the
 * read path that respects that. A per-uid failure (or missing doc) simply omits
 * that badge — it never rejects the whole map or breaks the feed.
 */
export async function fetchMemberStatsForUids(
  uids: string[],
): Promise<Map<string, MemberStats>> {
  const unique = [...new Set(uids.filter((uid) => uid))];
  const statsByUid = new Map<string, MemberStats>();

  await Promise.all(
    unique.map(async (uid) => {
      try {
        const snapshot = await getDoc(doc(getFirestoreDb(), "memberStats", uid));
        if (snapshot.exists()) {
          statsByUid.set(
            uid,
            normalizeMemberStats(uid, snapshot.data() as Partial<MemberStats>),
          );
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
): Unsubscribe {
  return onSnapshot(
    doc(getFirestoreDb(), "leaderboards", window),
    (snapshot) => {
      callback(snapshot.exists() ? (snapshot.data() as Leaderboard) : null);
    },
    onError,
  );
}
