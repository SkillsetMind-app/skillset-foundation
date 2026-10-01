export type CommunityReportTargetType = "post" | "comment";

export type CommunityReportStatus = "open" | "reviewed" | "resolved" | "dismissed";

export type CommunityReportReason =
  | "spam"
  | "harassment"
  | "unsafe_content"
  | "off_topic"
  | "other";

export type CommunityReport = {
  id: string;
  courseSlug: string;
  postId: string;
  commentId: string | null;
  targetType: CommunityReportTargetType;
  targetAuthorId: string;
  targetAuthorName: string;
  reporterId: string;
  reporterName: string;
  reporterEmail: string | null;
  reason: CommunityReportReason;
  detail: string | null;
  status: CommunityReportStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const communityReportReasonLabels: Record<CommunityReportReason, string> = {
  spam: "Spam or promotion",
  harassment: "Harassment or abuse",
  unsafe_content: "Unsafe content",
  off_topic: "Off-topic or low quality",
  other: "Other trust issue",
};
