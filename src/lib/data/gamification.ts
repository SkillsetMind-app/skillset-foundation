"use client";

import {
  collection,
  deleteDoc,
  doc,
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

/**
 * Live map of every member's gamification stats (uid -> stats), used to render
 * level badges next to post/comment authors. memberStats docs are tiny; for the
 * current scale a single collection listener is the simplest correct choice (a
 * per-author fetch is the scale-up path).
 */
export function subscribeToMemberStatsMap(
  callback: (statsByUid: Map<string, MemberStats>) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getFirestoreDb(), "memberStats"),
    (snapshot) => {
      const statsByUid = new Map<string, MemberStats>();
      for (const document of snapshot.docs) {
        const data = document.data() as Partial<MemberStats>;
        const points = typeof data.points === "number" ? data.points : 0;
        statsByUid.set(document.id, {
          uid: document.id,
          displayName:
            typeof data.displayName === "string" && data.displayName.trim()
              ? data.displayName
              : "Member",
          points,
          level:
            typeof data.level === "number"
              ? data.level
              : levelForPoints(points),
          totalLikesReceived:
            typeof data.totalLikesReceived === "number"
              ? data.totalLikesReceived
              : 0,
        });
      }
      callback(statsByUid);
    },
    onError,
  );
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
