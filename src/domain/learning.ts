import type { DripStrategy } from "@/domain/drip-policy";
import type { MembersTheme } from "@/domain/teacher-course";

export type CourseStatus = "draft" | "opening_soon" | "pilot" | "waitlist" | "published";

export type LessonType =
  | "video"
  | "text"
  | "quiz"
  | "assignment"
  | "live_recording"
  | "download"
  | "external_embed";

export type CourseModule = {
  id: string;
  title: string;
  summary: string;
  lessons: Lesson[];
};

export type Lesson = {
  id: string;
  title: string;
  type: LessonType;
  duration: string;
  isPreview: boolean;
  description?: string | null;
  contentText?: string | null;
  externalUrl?: string | null;
  dripDelayDays?: number | null;
};

export type Course = {
  id: string;
  slug: string;
  title: string;
  category: string;
  durationLabel: string;
  status: CourseStatus;
  statusLabel: string;
  summary: string;
  detail: string;
  image: string;
  level: "Foundation" | "Professional" | "Advanced";
  priceLabel: string;
  priceAmountMinor: number | null;
  currency: string;
  platformFeeBps: number;
  dripStrategy?: DripStrategy;
  dripIntervalDays?: number | null;
  freePreviewLabel: string;
  outcomes: string[];
  modules: CourseModule[];
  communityEnabled: boolean;
  // Per-course members-area hero customization (enrolled-student surface).
  // null theme → the hero defaults to "dark" (the members-area design default).
  // membersCoverAssetId is a CourseAsset id the hero resolves to an image URL.
  membersTheme?: MembersTheme | null;
  membersCoverAssetId?: string | null;
  membersTitle?: string | null;
  membersSubtitle?: string | null;
  membersDescription?: string | null;
};

export type ProductSurface = {
  title: string;
  href: string;
  label: string;
  summary: string;
  modules: string[];
};

export type CommunitySpace = {
  id: string;
  courseSlug: string;
  name: string;
  description: string;
  visibility: "public_preview" | "enrolled_only" | "private_invite";
  categories: Array<"announcement" | "discussion" | "question" | "resource">;
};

export type LiveEvent = {
  id: string;
  courseSlug: string;
  title: string;
  type: "live_class" | "mentorship" | "office_hours" | "webinar";
  timingLabel: string;
  delivery: "external_link" | "recording_upload";
};
