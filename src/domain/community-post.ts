export type CommunityPostCategory =
  | "announcement"
  | "discussion"
  | "question"
  | "resource";

export type CommunityPost = {
  id: string;
  courseSlug: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  category: CommunityPostCategory;
  body: string;
  // Teacher/admin-curated. Pinned posts float to the top of the feed. Only the
  // course owner or an admin can toggle this (rules enforce it); the author
  // cannot self-pin. Absent on legacy posts, treated as false.
  pinned?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CommunityComment = {
  id: string;
  postId: string;
  courseSlug: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string;
  // Null (or absent) = top-level comment. A string = the id of the top-level
  // comment this is a reply to. The feed renders a single level of nesting;
  // replies-to-replies attach to the same top-level parent.
  parentId?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const communityPostCategoryLabels: Record<CommunityPostCategory, string> = {
  announcement: "Announcement",
  discussion: "Discussion",
  question: "Question",
  resource: "Resource",
};
