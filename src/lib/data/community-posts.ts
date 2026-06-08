"use client";

import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import type { SkillsetUser } from "@/domain/auth";
import type {
  CommunityComment,
  CommunityPost,
  CommunityPostCategory,
} from "@/domain/community-post";
import type {
  CommunityReport,
  CommunityReportReason,
  CommunityReportStatus,
  CommunityReportTargetType,
} from "@/domain/community-report";
import { getFirestoreDb } from "@/lib/firebase/client";

const communityPostsCollection = "communityPosts";
const communityReportsCollection = "communityReports";

function getCreatedAtValue(item: { createdAt?: unknown }): number {
  const value = item.createdAt as { seconds?: number } | undefined;
  return value?.seconds ?? 0;
}

// Pinned posts float above the rest; within each group newest-first. Sorting
// client-side keeps the query a single courseSlug filter (no composite index)
// and stays correct for legacy posts that predate the `pinned` field.
function compareFeedPosts(left: CommunityPost, right: CommunityPost): number {
  const leftPinned = left.pinned === true ? 1 : 0;
  const rightPinned = right.pinned === true ? 1 : 0;
  if (leftPinned !== rightPinned) {
    return rightPinned - leftPinned;
  }
  return getCreatedAtValue(right) - getCreatedAtValue(left);
}

export async function createCommunityPost(input: {
  courseSlug: string;
  category: CommunityPostCategory;
  body: string;
  user: SkillsetUser;
}) {
  await addDoc(collection(getFirestoreDb(), communityPostsCollection), {
    courseSlug: input.courseSlug,
    authorId: input.user.uid,
    authorName: input.user.displayName?.trim() || input.user.email || "Skillset member",
    authorRole: input.user.roles[0] ?? "student",
    category: input.category,
    body: input.body.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function subscribeToCommunityPosts(
  courseSlug: string,
  callback: (posts: CommunityPost[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const postsQuery = query(
    collection(getFirestoreDb(), communityPostsCollection),
    where("courseSlug", "==", courseSlug),
  );

  return onSnapshot(
    postsQuery,
    (snapshot) => {
      callback(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...(document.data() as Omit<CommunityPost, "id">),
          }))
          .sort(compareFeedPosts),
      );
    },
    onError,
  );
}

// Teacher/admin moderation: toggle a post's pinned state. The write touches only
// `pinned` + `updatedAt`, which is exactly what the security rule's
// teacher-pin path allows (any other changed key would be rejected).
export async function setCommunityPostPinned(postId: string, pinned: boolean) {
  await updateDoc(doc(getFirestoreDb(), communityPostsCollection, postId), {
    pinned,
    updatedAt: serverTimestamp(),
  });
}

export async function createCommunityComment(input: {
  postId: string;
  courseSlug: string;
  body: string;
  user: SkillsetUser;
  // null/undefined = top-level comment; a string = the top-level comment this
  // reply attaches to. Always sent explicitly so the rule shape is satisfied.
  parentId?: string | null;
}) {
  await addDoc(
    collection(getFirestoreDb(), communityPostsCollection, input.postId, "comments"),
    {
      postId: input.postId,
      courseSlug: input.courseSlug,
      authorId: input.user.uid,
      authorName: input.user.displayName?.trim() || input.user.email || "Skillset member",
      authorRole: input.user.roles[0] ?? "student",
      body: input.body.trim(),
      parentId: input.parentId ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );
}

export function subscribeToCommunityComments(
  postId: string,
  callback: (comments: CommunityComment[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getFirestoreDb(), communityPostsCollection, postId, "comments"),
    (snapshot) => {
      callback(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...(document.data() as Omit<CommunityComment, "id">),
          }))
          .sort((left, right) => getCreatedAtValue(left) - getCreatedAtValue(right)),
      );
    },
    onError,
  );
}

export async function createCommunityReport(input: {
  courseSlug: string;
  postId: string;
  commentId: string | null;
  targetType: CommunityReportTargetType;
  targetAuthorId: string;
  targetAuthorName: string;
  reason: CommunityReportReason;
  detail: string | null;
  user: SkillsetUser;
}) {
  await addDoc(collection(getFirestoreDb(), communityReportsCollection), {
    courseSlug: input.courseSlug,
    postId: input.postId,
    commentId: input.commentId,
    targetType: input.targetType,
    targetAuthorId: input.targetAuthorId,
    targetAuthorName: input.targetAuthorName,
    reporterId: input.user.uid,
    reporterName: input.user.displayName?.trim() || input.user.email || "Skillset member",
    reporterEmail: input.user.email ?? null,
    reason: input.reason,
    detail: input.detail?.trim() || null,
    status: "open",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function subscribeToCommunityReports(
  callback: (reports: CommunityReport[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(getFirestoreDb(), communityReportsCollection),
    (snapshot) => {
      callback(
        snapshot.docs
          .map((document) => ({
            id: document.id,
            ...(document.data() as Omit<CommunityReport, "id">),
          }))
          .sort((left, right) => getCreatedAtValue(right) - getCreatedAtValue(left)),
      );
    },
    onError,
  );
}

export async function updateCommunityReportStatus(
  report: CommunityReport,
  status: CommunityReportStatus,
) {
  await updateDoc(doc(getFirestoreDb(), communityReportsCollection, report.id), {
    status,
    updatedAt: serverTimestamp(),
  });
}
