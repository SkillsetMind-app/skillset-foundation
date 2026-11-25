"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CloudOff,
  CreditCard,
  ExternalLink,
  Film,
  Gift,
  Image as ImageIcon,
  Loader2,
  Moon,
  MoreHorizontal,
  Plus,
  Repeat,
  Send,
  Sun,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlanSelectorCards, planGridColumns } from "@/components/shared/plan-selector-cards";
import { InlineHelp } from "@/components/shared/inline-help";
import { StatusChip } from "@/components/shared/status-chip";
import { MembersAreaHero } from "@/components/learn/members-area-hero";
import { BuilderSkeleton } from "@/components/teacher/builder-skeleton";
import { RetryAlert } from "@/components/teacher/save-status-line";
import { CourseAssetUploader } from "@/components/teacher/course-asset-uploader";
import { CourseCategorySelect } from "@/components/teacher/course-category-select";
import { CourseShareLink } from "@/components/teacher/course-share-link";
import { LessonContentModal } from "@/components/teacher/lesson-content-modal";
import { useLessonUpload } from "@/components/teacher/lesson-upload-provider";
import { clearLessonVideoSelection, reconcileLessonVideoSelections } from "@/lib/data/course-write-queue";
import type { DripStrategy } from "@/domain/drip-policy";
import { DEFAULT_PLATFORM_FEE_BPS } from "@/lib/payments/rules";
import type {
  MembersTheme,
  TeacherCourse,
  TeacherLesson,
  TeacherCourseModule,
  TeacherCoursePaymentType,
} from "@/domain/teacher-course";
import {
  countCourseLessons,
  MAX_LEARNING_OUTCOMES,
  normalizeCourseCategories,
  normalizeInstallmentsMax,
  normalizeLearningOutcomes,
  normalizeTeacherCourseModules,
  paymentTypeFitsFormat,
  skillsetCourseCategories,
  teacherCanEditCourse,
  teacherCanPublishCourse,
} from "@/domain/teacher-course";
import { buildInstallmentPlan, canSplitPayments } from "@/domain/installments";
import {
  paymentChoiceOf,
  paymentChoicesFor,
  paymentTypeOfChoice,
  resolveCoursePrice,
  yearlySavingMinor,
  type PaymentChoice,
  type ProductOffer,
} from "@/domain/product-pricing";
import {
  subscribeToTeacherCourse,
  publishTeacherCourse,
  updateTeacherCourseBuilder,
} from "@/lib/data/teacher-courses";
import {
  courseAssetAcceptTypes,
  formatCourseAssetSize,
  getCourseAssetUploadErrorMessage,
  getModuleCoverAsset,
  isAllowedCourseAssetFile,
  supabaseUploadLimitBytes,
} from "@/domain/course-asset";
import {
  fetchCourseAssets,
  subscribeToCourseAssets,
  syncLessonPreviewAssets,
  uploadCourseAsset,
  type UploadCourseAssetProgress,
} from "@/lib/data/course-assets";
import { compressImage, MAX_SOURCE_IMAGE_BYTES } from "@/lib/media/compress-image";
import { ReadinessGroups } from "@/components/teacher/readiness-groups";
import { ImageUploadField } from "@/components/teacher/image-upload-field";
import { Button, buttonClasses, EmptyState, InlineAlert, ProgressBar } from "@/components/ui";
import { DrawnCheck, MilestoneSeal, useJustDone } from "@/components/ui/drawn-check";
import { SpotArt } from "@/components/ui/spot-art";
import type { CourseAsset } from "@/domain/course-asset";
import { isActivationRequiredError } from "@/domain/creator-verification";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import { getSafeExternalUrl, getSafeMediaUrl } from "@/domain/external-url";
import { isPublicFeatureEnabled } from "@/lib/feature-flags";
import { countLabel } from "@/lib/i18n/count-label";
import { track } from "@/lib/posthog/events";
import { defaultSkillsetCurrency } from "@/lib/payments/currencies";
import { CurrencySelect } from "@/components/teacher/currency-select";
import { usePublishGates } from "@/components/teacher/use-publish-gates";
import { useConfirm } from "@/components/teacher/use-confirm";
import { VerifiedBadgeOffer } from "@/components/teacher/verified-badge-offer";
import {
  countLessonFiles,
  formatZeroPrice,
  getCourseReadiness,
  getLessonIdsWithMedia,
  upcomingSessionsOf,
} from "@/domain/course-readiness";
import { formatEventDateTime, type CourseEvent } from "@/domain/course-event";
import { subscribeToTeacherCourseEvents } from "@/lib/data/course-events";
import { moveLessonTo } from "@/domain/curriculum-move";
import { AiSuggest } from "@/components/teacher/ai-suggest";
import { isTeacherAiEnabled } from "@/lib/ai/config";

const builderTabs = [
  { value: "details", label: "creatorEditor.builder.steps.details.tab", sub: "creatorEditor.builder.steps.details.tabHelp" },
  { value: "pricing", label: "creatorEditor.builder.steps.pricing.tab", sub: "creatorEditor.builder.steps.pricing.tabHelp" },
  { value: "content", label: "creatorEditor.builder.steps.content.tab", sub: "creatorEditor.builder.steps.content.tabHelp" },
  { value: "members", label: "Members Area", sub: "Theme, cover, title" },
  { value: "review", label: "creatorEditor.builder.steps.review.tab", sub: "creatorEditor.builder.steps.review.tabHelp" },
] as const;

type BuilderTab = (typeof builderTabs)[number]["value"];

function isBuilderTab(value: string | null): value is BuilderTab {
  return builderTabs.some((tab) => tab.value === value);
}

const builderStages: Array<{
  id: string;
  label: string;
  sub: string;
  target: BuilderTab;
  anchor: string;
}> = [
  { id: "basics", label: "creatorEditor.builder.steps.details.stage", sub: "creatorEditor.builder.steps.details.stageHelp", target: "details", anchor: "builder-sec-cover" },
  { id: "pricing", label: "creatorEditor.builder.steps.pricing.tab", sub: "creatorEditor.builder.steps.pricing.stageHelp", target: "pricing", anchor: "builder-sec-pricing" },
  { id: "content", label: "creatorEditor.builder.steps.content.tab", sub: "creatorEditor.builder.steps.content.stageHelp", target: "content", anchor: "builder-sec-modules" },
  { id: "members", label: "Members area", sub: "Learner experience", target: "members", anchor: "builder-sec-members" },
  { id: "publish", label: "creatorEditor.builder.steps.review.tab", sub: "creatorEditor.builder.steps.review.stageHelp", target: "review", anchor: "builder-sec-review" },
];
type ActiveLessonStudio = {
  moduleId: string;
  lessonId: string;
} | null;

const dripStrategies: { value: DripStrategy; label: string; detail: string }[] = [
  {
    value: "instant",
    label: "creatorEditor.builder.drip.instant.label",
    detail: "creatorEditor.builder.drip.instant.detail",
  },
  {
    value: "sequential_progress",
    label: "creatorEditor.builder.drip.sequential_progress.label",
    detail: "creatorEditor.builder.drip.sequential_progress.detail",
  },
  {
    value: "time_drip_lesson",
    label: "creatorEditor.builder.drip.time_drip_lesson.label",
    detail: "creatorEditor.builder.drip.time_drip_lesson.detail",
  },
  {
    value: "time_drip_module",
    label: "creatorEditor.builder.drip.time_drip_module.label",
    detail: "creatorEditor.builder.drip.time_drip_module.detail",
  },
  {
    value: "time_drip_custom",
    label: "creatorEditor.builder.drip.time_drip_custom.label",
    detail: "creatorEditor.builder.drip.time_drip_custom.detail",
  },
];

// "How will people pay?": three cards, each with an example in numbers in the
// chosen currency. For a live event the one-time payment is called Ticket
// (Ingresso).
const paymentChoiceIcons = {
  free: Gift,
  one_payment: CreditCard,
  ticket: Ticket,
  membership: Repeat,
} as const;
const paymentChoiceExamples: Record<PaymentChoice, number> = {
  free: 0,
  one_payment: 300,
  membership: 29,
};
// Up to how many installments: 2 to 12, plus the saved value if it is another one.
const splitPaymentCounts = Array.from({ length: 11 }, (_, index) => index + 2);

// Ctrl/Cmd/Shift/Alt or a button that is not the left one: the browser opens
// another tab and this one does not navigate. Nothing that depends on "the person left here" may run.
function isPlainLeftClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return (
    event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
  );
}

// Own type on drag: dropping any random text on a module row does not
// move anything.
const lessonDragType = "application/x-skillset-lesson";

// Release that recalculates the lesson's position on every read (lesson_is_released
// in the database and getLessonUnlockState): moving changes when the lesson opens and can
// lock out again someone who already had access. time_drip_custom uses each lesson's own day.
const positionalDripStrategies: ReadonlySet<DripStrategy> = new Set<DripStrategy>([
  "sequential_progress",
  "time_drip_module",
  "time_drip_lesson",
]);

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parsePriceAmountMinor(value: string): number | null {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const parsedValue = Number(trimmedValue.replace(",", "."));

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Math.round(parsedValue * 100);
}

function hasInvalidPriceAmount(value: string): boolean {
  return value.trim().length > 0 && parsePriceAmountMinor(value) === null;
}

function parseInstallmentsMax(value: string): number | null {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const parsedValue = Number(trimmedValue);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return null;
  }

  return normalizeInstallmentsMax(parsedValue);
}

function normalizeDripDelayDays(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Math.round(parsedValue);
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function sanitizeModules(modules: TeacherCourseModule[]): TeacherCourseModule[] {
  // B1: the client always sends the real lesson content to the Cloud Function.
  // The function is the single authoritative writer of the gated
  // courses/{id}/lessonContent subcollection (capped + rules-bypassed) and
  // decides — via its own WRITE_LESSON_CONTENT_INLINE flag — whether to also
  // mirror the content inline on the world-readable course doc. Nulling content
  // client-side would starve that subcollection mirror, so we never do it here.
  return normalizeTeacherCourseModules(modules);
}

type BuilderError = {
  code: "notFound" | "load" | "chooseModule" | "lessonTitle" | "moduleTitleMissing"
    | "lessonTitleMissing" | "price" | "livePrice" | "installmentsSave" | "category" | "paidPrice"
    | "installmentsPublish" | "duplicateTitle" | "activation" | "plan" | "save" | "preview"
    | "setup" | "verification" | "payouts" | "payment" | "lessonContent" | "publish"
    | "session" | "file" | "community";
  moduleIndex?: number;
  lessonIndex?: number;
};

function getCourseStructureError(modules: TeacherCourseModule[]): BuilderError | null {
  for (const [moduleIndex, module] of modules.entries()) {
    if (!module.title.trim()) {
      return { code: "moduleTitleMissing", moduleIndex: moduleIndex + 1 };
    }

    for (const [lessonIndex, lesson] of module.lessons.entries()) {
      if (!lesson.title.trim()) {
        return { code: "lessonTitleMissing", moduleIndex: moduleIndex + 1, lessonIndex: lessonIndex + 1 };
      }
    }
  }

  return null;
}

type BuilderDraftFields = {
  title: string;
  summary: string;
  category: string;
  selectedCategories: string[];
  learningOutcomes: string[];
  modules: TeacherCourseModule[];
  priceAmount: string;
  currency: string;
  paymentType: TeacherCoursePaymentType;
  installmentsEnabled: boolean;
  installmentsMax: string;
  dripStrategy: DripStrategy;
  dripIntervalDays: string;
  freePreviewLessonId: string;
  platformFeeBps: number;
  membersTheme: MembersTheme;
  membersCoverAssetId: string | null;
  membersTitle: string;
  membersSubtitle: string;
  membersDescription: string;
  communityEnabled: boolean;
};

// Single normalization pipeline used by manual save, autosave, and the
// change-signature. Keeping one function guarantees the live payload and the
// hydration baseline can never disagree (which would otherwise loop autosave).
function buildBuilderDraftPayload(input: BuilderDraftFields) {
  const nextPriceAmountMinor =
    input.paymentType === "free" ? 0 : parsePriceAmountMinor(input.priceAmount);
  const nextInstallmentsEnabled =
    input.paymentType === "one_time" && input.installmentsEnabled;
  const nextInstallmentsMax = nextInstallmentsEnabled
    ? parseInstallmentsMax(input.installmentsMax)
    : null;
  const nextDripIntervalDays = Math.max(
    1,
    normalizeDripDelayDays(input.dripIntervalDays) ?? 1,
  );
  const nextModules = sanitizeModules(input.modules);
  const nextCategories = normalizeCourseCategories([
    ...input.selectedCategories,
    input.category,
  ]);
  const nextCategory = nextCategories[0] ?? "";

  return {
    title: input.title.trim(),
    summary: input.summary.trim(),
    category: nextCategory,
    categories: nextCategories,
    learningOutcomes: normalizeLearningOutcomes(input.learningOutcomes),
    modules: nextModules,
    priceAmountMinor: nextPriceAmountMinor,
    currency: input.currency,
    paymentType: input.paymentType,
    installmentsEnabled: nextInstallmentsEnabled,
    installmentsMax: nextInstallmentsMax,
    platformFeeBps: input.platformFeeBps,
    dripStrategy: input.dripStrategy,
    dripIntervalDays: nextDripIntervalDays,
    freePreviewLessonId: input.freePreviewLessonId || null,
    membersTheme: input.membersTheme,
    membersCoverAssetId: input.membersCoverAssetId,
    membersTitle: input.membersTitle.trim() || null,
    membersSubtitle: input.membersSubtitle.trim() || null,
    membersDescription: input.membersDescription.trim() || null,
    communityEnabled: input.communityEnabled,
  };
}

// Mirrors the snapshot hydration setters exactly, so the baseline equals what
// the builder state will serialize to right after loading the course.
function builderDraftSignatureFromCourse(course: TeacherCourse): string {
  return JSON.stringify(
    buildBuilderDraftPayload({
      title: course.title,
      summary: course.summary,
      category: course.category,
      selectedCategories: normalizeCourseCategories([
        ...(course.categories ?? []),
        course.category,
      ]),
      learningOutcomes: course.learningOutcomes ?? [],
      modules: course.modules ?? [],
      priceAmount:
        typeof course.priceAmountMinor === "number"
          ? String(course.priceAmountMinor / 100)
          : "",
      currency: course.currency ?? defaultSkillsetCurrency,
      // No saved form, no value, and free: that is how checkout and the database read it.
      paymentType:
        course.paymentType ?? (course.priceAmountMinor ? "one_time" : "free"),
      installmentsEnabled: Boolean(course.installmentsEnabled),
      installmentsMax: String(course.installmentsMax ?? 12),
      dripStrategy: course.dripStrategy ?? "instant",
      dripIntervalDays: String(course.dripIntervalDays ?? 1),
      freePreviewLessonId: course.freePreviewLessonId ?? "",
      platformFeeBps: course.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS,
      membersTheme: course.membersTheme ?? "light",
      membersCoverAssetId: course.membersCoverAssetId ?? null,
      membersTitle: course.membersTitle ?? "",
      membersSubtitle: course.membersSubtitle ?? "",
      membersDescription: course.membersDescription ?? "",
      communityEnabled: course.communityEnabled ?? false,
    }),
  );
}

export function CourseBuilderStudio() {
  const { locale, t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const courseId = searchParams.get("courseId");
  const uploadManager = useLessonUpload();
  const requestedTab = searchParams.get("tab");
  // Lesson with an upload in progress: its page stays on screen (same instance,
  // progress bar intact) and the content tab stays active until the upload
  // finishes, even if the URL changes (browser back). Then it follows the URL again.
  const [uploadingLesson, setUploadingLesson] = useState<
    { moduleId: string; lessonId: string; failed?: boolean } | null
  >(null);
  // History can switch courses without remounting this builder. The root
  // upload remains alive, but must not lock the next course's navigation.
  if (uploadingLesson && uploadManager && uploadManager.job?.courseId !== courseId) {
    setUploadingLesson(null);
  }
  const activeTab: BuilderTab = uploadingLesson
    ? "content"
    : isBuilderTab(requestedTab)
      ? requestedTab
      : "details";
  const selectTab = useCallback(
    (nextTab: BuilderTab) => {
      // Switching tabs in the middle of an upload would unmount the studio and leave the
      // upload without an owner.
      if (uploadingLesson) {
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", nextTab);
      // Outside the content tab the lesson is not open: without ?lesson, the course's
      // file list is fetched again and the Publish readiness sees what changed.
      if (nextTab !== "content") {
        params.delete("lesson");
      }
      router.push(`/teach/builder?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, uploadingLesson],
  );
  // Module page: only the URL changes (?module=M), as with the tabs. No new route,
  // the module shares the draft, the autosave and the Save button with the rest.
  const requestedModuleId = searchParams.get("module");
  // Lesson page (?lesson=L next to ?module=M): the same idea as the module.
  const requestedLessonId = searchParams.get("lesson");
  function builderModuleHref(moduleId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "content");
    params.delete("lesson");
    if (moduleId) {
      params.set("module", moduleId);
    } else {
      params.delete("module");
    }
    return `/teach/builder?${params.toString()}`;
  }
  function builderLessonHref(moduleId: string, lessonId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "content");
    params.set("module", moduleId);
    params.set("lesson", lessonId);
    return `/teach/builder?${params.toString()}`;
  }
  const { user } = useAuth();
  // Payouts and verification: only Manage knew about them; here the person clicked
  // Publish and found out from the server error.
  const {
    account: publishGates,
    planId,
    loaded: gatesLoaded,
    verificationStatus,
    stripeConnectCountry,
  } = usePublishGates(user);
  // "Not now" on the verified badge offer returns focus to the title of the "Published!" panel.
  const successNoticeRef = useRef<HTMLHeadingElement>(null);
  // Deleting a module/lesson, moving with position-based release, and leaving with a
  // dirty draft ask in the platform dialog (it used to be window.confirm).
  const { ask, dialog: confirmDialog } = useConfirm();
  // Exit already confirmed: the repeated click on the same link goes through the guard.
  const leaveConfirmedRef = useRef(false);
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  // What the product delivers (courses.product_format): it changes the content tab
  // and what publishing checks, as in publish_teacher_course.
  const productFormat = course?.productFormat ?? "course";
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<string>(skillsetCourseCategories[0]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    skillsetCourseCategories[0],
  ]);
  const [learningOutcomes, setLearningOutcomes] = useState<string[]>([]);
  const [modules, setModules] = useState<TeacherCourseModule[]>([]);
  const [priceAmount, setPriceAmount] = useState("");
  const [currency, setCurrency] = useState(defaultSkillsetCurrency);
  const [paymentType, setPaymentType] =
    useState<TeacherCoursePaymentType>("one_time");
  const [installmentsEnabled, setInstallmentsEnabled] = useState(false);
  const [installmentsMax, setInstallmentsMax] = useState("12");
  // "Also offer an annual plan": the yearly value only serves for the savings
  // calculation and to lead to "Add another price" (Offers); the price step
  // does not save a hidden second price.
  const [yearlyPlanOpen, setYearlyPlanOpen] = useState(false);
  const [yearlyAmount, setYearlyAmount] = useState("");
  const [dripStrategy, setDripStrategy] = useState<DripStrategy>("instant");
  const [dripIntervalDays, setDripIntervalDays] = useState("1");
  const [freePreviewLessonId, setFreePreviewLessonId] = useState("");
  const [membersTheme, setMembersTheme] = useState<MembersTheme>("light");
  const [membersCoverAssetId, setMembersCoverAssetId] = useState<string | null>(
    null,
  );
  const [membersTitle, setMembersTitle] = useState("");
  const [membersSubtitle, setMembersSubtitle] = useState("");
  const [membersDescription, setMembersDescription] = useState("");
  const [communityEnabled, setCommunityEnabled] = useState(false);
  // ?welcome=1 comes from the Agenda shortcut ("Add a short welcome lesson"): the
  // first module is born with a name.
  const [moduleTitle, setModuleTitle] = useState(() =>
    searchParams.get("welcome") === "1" ? t("creatorEditor.builder.curriculum.welcomeModule") : "",
  );
  // The name is already in the form: the parameter leaves the URL so a reload
  // (or a tab switch, which copies the parameters) does not open another "Welcome".
  useEffect(() => {
    if (searchParams.get("welcome") !== "1") {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("welcome");
    router.replace(`/teach/builder?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);
  const [moduleSummary, setModuleSummary] = useState("");
  const [moduleError, setModuleError] = useState(false);
  const [lessonModuleId, setLessonModuleId] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonIsFreePreview, setLessonIsFreePreview] = useState(false);
  // The two forms are now requests, not scenery: the module list is
  // what opens the tab. Each module is one row; clicking opens its page.
  const [isModuleFormRequested, setIsModuleFormOpen] = useState(false);
  const [lessonFormModuleId, setLessonFormModuleId] = useState("");
  // "Move to module…" selector per lesson: choosing only marks the destination and the
  // Move button applies it (in Chrome/Edge the keyboard arrows fire change right away).
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [moveStatus, setMoveStatus] = useState<{ moduleId: string; text: string } | null>(null);
  // Module where the lesson landed: "Lesson added" only on its page. Moving clears
  // `success`, so the row always shows the newest notice.
  const [lessonAddedIn, setLessonAddedIn] = useState<string | null>(null);
  // Module list: the Up/Down announcement and the row that receives the dragged lesson.
  const [reorderStatus, setReorderStatus] = useState("");
  const [dragOverModuleId, setDragOverModuleId] = useState<string | null>(null);
  // "More actions" open (one lesson at a time) on the module page.
  const [lessonMenuId, setLessonMenuId] = useState<string | null>(null);
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false);
  const [error, setError] = useState<BuilderError | null>(null);
  // Where the error appears: near the button that caused it. In a single card at the
  // end of the page, the top "Save draft" seemed to do nothing. The footer is gone:
  // whatever does not come from Publish or the media library goes to the top.
  const [errorSlot, setErrorSlot] = useState<"hero" | "publish" | "media">("hero");
  const [success, setSuccess] = useState<"lessonAdded" | "draftSaved" | "published" | null>(null);
  const errorMessage = error
    ? t(`creatorEditor.builder.errors.${error.code}`)
      .replace("{module}", () => String(error.moduleIndex ?? ""))
      .replace("{lesson}", () => String(error.lessonIndex ?? ""))
      .replace("{zero}", () => formatZeroPrice(currency))
    : null;
  const [isLoading, setIsLoading] = useState(true);
  // ?created=1 comes from the create screen (motion catalog, item 7): the strip
  // "Draft saved. Next: ..." appears once, when the course finishes
  // loading. The parameter leaves the URL at that moment, so a reload or a tab
  // switch (which copies the parameters) does not repeat the milestone. It goes away after 4s or on the X
  // (the clock lives in CreatedStrip).
  const [createdStripOpen, setCreatedStripOpen] = useState(
    () => searchParams.get("created") === "1",
  );
  const closeCreatedStrip = useCallback(() => setCreatedStripOpen(false), []);
  useEffect(() => {
    if (isLoading || searchParams.get("created") !== "1") {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("created");
    router.replace(`/teach/builder?${params.toString()}`, { scroll: false });
  }, [isLoading, router, searchParams]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The open lesson comes from the URL (?module=M&lesson=L), like the module: the browser
  // back button works. A lesson that does not (any longer) exist in that module falls to the
  // module page, never to an empty screen.
  const urlLessonStudio: ActiveLessonStudio =
    requestedModuleId
    && requestedLessonId
    && modules.some(
      (module) =>
        module.id === requestedModuleId
        && module.lessons.some((lesson) => lesson.id === requestedLessonId),
    )
      ? { moduleId: requestedModuleId, lessonId: requestedLessonId }
      : null;
  // With an upload in progress, the upload's lesson wins (the URL may have changed).
  const activeLessonStudio: ActiveLessonStudio =
    uploadingLesson
    && modules.some(
      (module) =>
        module.id === uploadingLesson.moduleId
        && module.lessons.some((lesson) => lesson.id === uploadingLesson.lessonId),
    )
      ? uploadingLesson
      : urlLessonStudio;
  // Upload that failed with the URL somewhere else: the lesson page stays until the URL
  // goes back to it (router.replace) and only then lets go, without remounting, with the error
  // on screen.
  if (
    uploadingLesson?.failed
    && requestedTab === "content"
    && urlLessonStudio?.lessonId === uploadingLesson.lessonId
  ) {
    setUploadingLesson(null);
  }
  const activeLessonId = activeLessonStudio?.lessonId ?? null;
  // The "next: your first lesson" strip goes away when a lesson opens, by
  // any path (it has done its job by then), and outside the content tab:
  // stuck at the bottom of the screen, it covered "Continue to…" and the footer buttons.
  if (createdStripOpen && (activeLessonId || activeTab !== "content")) {
    setCreatedStripOpen(false);
  }
  // Opens the page of the newly created lesson when the echo confirms the save. Redone on
  // every render to see the current URL.
  const openPendingLessonRef = useRef<(target: { moduleId: string; lessonId: string }) => void>(
    () => {},
  );
  const [courseAssets, setCourseAssets] = useState<CourseAsset[]>([]);
  // Only with the file list in hand does readiness require content in every lesson:
  // before that (or if the fetch fails) the item is left out, as in Manage, instead of
  // accusing a lesson of being empty when it only has an upload or a PDF.
  const [courseAssetsLoaded, setCourseAssetsLoaded] = useState(false);
  const [autosaveState, setAutosaveState] =
    useState<"idle" | "saving" | "saved" | "error">("idle");
  // Signature of the last state we know the server has. Lives in state (not a
  // ref) so the "Unsaved changes" indicator can be derived purely in render
  // without reading a ref. Updated only in async callbacks (save success and
  // the snapshot hydration), so it never causes a synchronous setState in an
  // effect body.
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const isAutosavingRef = useRef(false);
  // Lesson just added through the form, waiting for autosave to persist it so
  // the lesson studio (Video tab) can open automatically. A ref (not state):
  // it is read/cleared only inside async callbacks (course hydration, autosave
  // failure) and never drives a render by itself — the "Saving lesson…"
  // spinner derives from savedLessonIds/autosaveState.
  const pendingLessonStudioRef = useRef<ActiveLessonStudio>(null);
  // Stepper "jump to section" target. A ref (not state) so setting it never
  // triggers a render, and it is read/cleared only inside an event handler or
  // an effect — never during render — to stay clear of react-hooks/refs.
  const pendingScrollRef = useRef<string | null>(null);
  // Module navigation requested by the person (row, breadcrumb or new module).
  // Null on the first hydration: opening the builder already in a module does not steal focus.
  const moduleNavigationRef = useRef<{ returnTo: string | null } | null>(null);
  // Mirror of `draftIsDirty` for the realtime callback, which does not see the render.
  const draftDirtyRef = useRef(false);
  // Last snapshot that arrived while the draft was dirty and was left out. It applies if the
  // draft becomes clean again without a save of ours; a save of ours discards it.
  const skippedSnapshotRef = useRef<TeacherCourse | null>(null);
  // Local draft for the realtime callback: it only opens the studio of a lesson that
  // still exists here.
  const localModulesRef = useRef<TeacherCourseModule[]>([]);
  // Saves of ours in flight (autosave, Save, Publish). Up here because the
  // skipped-snapshot effect also reads it.
  const inFlightSavesRef = useRef(0);
  // Autosave debounce timer, so the flush on exit can cancel it.
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  // Open studio: saves (without a prompt) the typed link that has not blurred yet.
  const studioLeaveFlushRef = useRef<(() => void) | null>(null);
  // Flush on exit, redone on every render to see the current state.
  const flushOnLeaveRef = useRef<(withStudio: boolean) => void>(() => {});
  // Fetches of the course file list: only the latest counts. A counter,
  // and not "cancel on dependency change": opening the lesson right after (direct
  // link, when the modules arrive) used to discard the first fetch forever.
  const assetsRequestRef = useRef(0);
  // Fetches the course again without waiting for Realtime. The builder only knows that a
  // module/lesson was saved from the course snapshot; with the Realtime echo as the
  // only source, the module cover upload and the new lesson's video button
  // stayed stuck while Realtime refused the channel (Oct 6).
  const courseReloadRef = useRef<(() => Promise<void>) | null>(null);

  // Copies the server snapshot into the draft. Only setters (stable), so it
  // serves the realtime callback and the effect that applies the skipped snapshot.
  const applyServerDraft = useCallback((nextCourse: TeacherCourse) => {
    setTitle(nextCourse.title);
    setSummary(nextCourse.summary);
    setCategory(nextCourse.category);
    setSelectedCategories(
      normalizeCourseCategories([
        ...(nextCourse.categories ?? []),
        nextCourse.category,
      ]),
    );
    setLearningOutcomes(nextCourse.learningOutcomes ?? []);
    setModules(nextCourse.modules ?? []);
    setPriceAmount(
      typeof nextCourse.priceAmountMinor === "number"
        ? String(nextCourse.priceAmountMinor / 100)
        : "",
    );
    setCurrency(nextCourse.currency ?? defaultSkillsetCurrency);
    setPaymentType(
      nextCourse.paymentType ?? (nextCourse.priceAmountMinor ? "one_time" : "free"),
    );
    setInstallmentsEnabled(Boolean(nextCourse.installmentsEnabled));
    setInstallmentsMax(String(nextCourse.installmentsMax ?? 12));
    setDripStrategy(nextCourse.dripStrategy ?? "instant");
    setDripIntervalDays(String(nextCourse.dripIntervalDays ?? 1));
    setFreePreviewLessonId(nextCourse.freePreviewLessonId ?? "");
    setMembersTheme(nextCourse.membersTheme ?? "light");
    setMembersCoverAssetId(nextCourse.membersCoverAssetId ?? null);
    setMembersTitle(nextCourse.membersTitle ?? "");
    setMembersSubtitle(nextCourse.membersSubtitle ?? "");
    setMembersDescription(nextCourse.membersDescription ?? "");
    setCommunityEnabled(nextCourse.communityEnabled ?? false);
    // Every snapshot comes through here, including the echo of our autosave. Always
    // going back to the 1st module sent the next lesson to the wrong module.
    setLessonModuleId((current) =>
      nextCourse.modules?.some((module) => module.id === current)
        ? current
        : nextCourse.modules?.[0]?.id ?? "",
    );
    // Baseline mirrors exactly what the state setters above produce, so a
    // fresh hydration (or our own write echoing back) is never seen as a
    // user edit.
    setSavedSignature(builderDraftSignatureFromCourse(nextCourse));
  }, []);

  useEffect(() => {
    if (!courseId) {
      return;
    }

    const subscription = subscribeToTeacherCourse(
      courseId,
      (nextCourse) => {
        setIsLoading(false);

        if (!nextCourse) {
          setError({ code: "notFound" });
          return;
        }

        setCourse(nextCourse);
        setError(null);

        // Video-first flow: a lesson added through the form auto-opens its
        // studio (Video tab) as soon as hydration confirms autosave persisted
        // it — uploads need the saved lesson id.
        const pendingStudio = pendingLessonStudioRef.current;
        if (
          pendingStudio &&
          nextCourse.modules?.some(
            (module) =>
              module.id === pendingStudio.moduleId &&
              module.lessons.some(
                (lesson) => lesson.id === pendingStudio.lessonId,
              ),
          )
        ) {
          pendingLessonStudioRef.current = null;
          // A lesson that no longer exists in the draft (deleted before the echo): opening
          // its studio left a "ghost" studio, without a modal, which blocked
          // opening the next lesson and reloading the course files.
          const stillInDraft = localModulesRef.current.some(
            (module) =>
              module.id === pendingStudio.moduleId &&
              module.lessons.some((lesson) => lesson.id === pendingStudio.lessonId),
          );
          if (stillInDraft) {
            // Never swaps an already open lesson: the studio is per lesson id, and swapping
            // in the middle of an upload would lose the progress bar and the leave lock.
            openPendingLessonRef.current(pendingStudio);
            setSuccess(null);
          }
        }

        // The snapshot may arrive behind the draft: echo of an earlier save with an
        // autosave in flight, a debounce running, or a newly created lesson/module. Before,
        // overwriting erased the local edit and the autosave never saved it again.
        // With a dirty draft, the local one wins and the next autosave writes over it.
        // ponytail: local wins while there is a pending edit, even over a
        // change from another tab; resolve conflicts between tabs if it becomes a real case.
        if (draftDirtyRef.current) {
          skippedSnapshotRef.current = nextCourse;
          return;
        }

        skippedSnapshotRef.current = null;
        applyServerDraft(nextCourse);
      },
      () => {
        setIsLoading(false);
        setErrorSlot("hero");
        setError({ code: "load" });
      },
    );
    courseReloadRef.current = subscription.reload;
    return () => {
      courseReloadRef.current = null;
      subscription();
    };
  }, [courseId, applyServerDraft]);

  // One-shot (re)load instead of a realtime channel: the lesson studio modal
  // already owns the `course_assets:{id}` realtime topic while it is open, and
  // Phoenix allows one join per topic per socket — so the builder refreshes on
  // mount and whenever the studio closes (the only place lesson videos change).
  useEffect(() => {
    // With the lesson open on the content tab, the studio takes care of the files (and
    // notifies through onAssetsChanged). On any other tab the list is fetched.
    if (!courseId || (activeTab === "content" && activeLessonId)) {
      return;
    }

    const request = ++assetsRequestRef.current;
    fetchCourseAssets(courseId)
      .then((nextAssets) => {
        if (request === assetsRequestRef.current) {
          setCourseAssets(nextAssets);
          setCourseAssetsLoaded(true);
        }
      })
      .catch(() => {
        // Non-critical: only the "Add video"/"Edit content" hint degrades.
      });
  }, [courseId, activeTab, activeLessonId]);

  // Live event: the scheduled session is the content. Same read as the Agenda,
  // only this product's sessions that are still standing and upcoming: one that has already passed is not
  // sold (publish_teacher_course checks the same).
  const [courseSessions, setCourseSessions] = useState<CourseEvent[] | null>(null);
  const ownerUid = user?.uid;
  useEffect(() => {
    if (!ownerUid || !courseId || productFormat !== "live_event") {
      return;
    }
    return subscribeToTeacherCourseEvents(
      ownerUid,
      (events) => setCourseSessions(upcomingSessionsOf(events, courseId, Date.now())),
      // Without the list, the item disappears from readiness and the server keeps checking.
      () => {},
    );
  }, [ownerUid, courseId, productFormat]);

  useEffect(() => {
    openPendingLessonRef.current = (target) => {
      if (activeLessonStudio) {
        return;
      }
      router.push(builderLessonHref(target.moduleId, target.lessonId), { scroll: false });
    };
  });

  const lessonIdsWithVideo = useMemo(() => {
    const ids = new Set<string>();
    for (const asset of courseAssets) {
      if (
        (asset.kind === "lesson_video" || asset.kind === "live_recording") &&
        asset.lessonId
      ) {
        ids.add(asset.lessonId);
      }
    }
    return ids;
  }, [courseAssets]);

  const isOwner = course && user?.uid === course.ownerId;
  // Someone opening another person's course (platform staff) does not read the prices:
  // the route only answers the owner. Without this the step said "Couldn't load your
  // prices." with a "Try again" that would never work.
  const viewingOthersCourse = Boolean(course && user && user.uid !== course.ownerId);
  const isEditable = Boolean(isOwner && course && teacherCanEditCourse(course.status));
  const canPublish = Boolean(
    isOwner && course && teacherCanPublishCourse(course.status),
  );
  // Installments only appear where they work, by the same rule as checkout: flag
  // on, sale in MXN, and a Mexican Stripe account. Outside that the option does not
  // exist on screen (the saved value stays as it is).
  const showSplitPayments =
    paymentType === "one_time"
    && canSplitPayments({
      featureEnabled: isPublicFeatureEnabled("payments.cardInstallments"),
      currency,
      stripeAccountCountry: stripeConnectCountry,
    });
  // With a price in Other prices, checkout charges the main offer
  // (resolveCoursePrice), not these fields: the price step only shows what the
  // page charges and leads there. null = does not know yet: without knowing the main
  // price, the cards do not appear (they would only change the builder). Re-reads on
  // returning to the tab: another tab may have created the main price.
  const [checkoutOffers, setCheckoutOffers] = useState<ProductOffer[] | null>(null);
  const [offersFailed, setOffersFailed] = useState(false);
  // The failure's "Try again": the same read, again (before, only by reloading the page).
  const [offersAttempt, setOffersAttempt] = useState(0);
  // Which course the list on screen belongs to: a re-read that fails does not erase the good
  // list of the SAME course (the rule for every list); for another course, it erases.
  const offersCourseRef = useRef<string | null>(null);
  // With the list on screen, "Try again" does not remove the notice while it reads: it stays,
  // with the button waiting, until the response. Without a list, the skeleton returns.
  const [offersRetrying, setOffersRetrying] = useState(false);
  const retryOffers = () => {
    if (checkoutOffers) {
      setOffersRetrying(true);
    } else {
      setOffersFailed(false);
    }
    setOffersAttempt((current) => current + 1);
  };
  useEffect(() => {
    if (!courseId || viewingOthersCourse) {
      return;
    }
    let alive = true;
    let latest = 0;
    const load = () => {
      const request = ++latest;
      fetch(`/api/teach/offers?courseId=${encodeURIComponent(courseId)}`, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { offers?: Omit<ProductOffer, "courseId">[]; warning?: string } | null) => {
          // The route returns 200 with a warning when the read fails: that is not "no offers".
          if (!data || data.warning || !Array.isArray(data.offers)) {
            throw new Error("offers unavailable");
          }
          if (alive && request === latest) {
            offersCourseRef.current = courseId;
            setCheckoutOffers(data.offers.map((offer) => ({ ...offer, courseId })));
            setOffersFailed(false);
            setOffersRetrying(false);
          }
        })
        .catch(() => {
          if (alive && request === latest) {
            // The focus re-read used to fail and erase the cards that were
            // right on screen. Only the screen changes: checkout reads the price on the server.
            if (offersCourseRef.current !== courseId) setCheckoutOffers(null);
            setOffersFailed(true);
            setOffersRetrying(false);
          }
        });
    };
    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") {
        load();
      }
    };
    load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", loadWhenVisible);
    };
  }, [courseId, offersAttempt, viewingOthersCourse]);
  // On another person's course the list is never read: a list left over from the
  // course opened before cannot apply to this one.
  const offerPrice = course && checkoutOffers && !viewingOthersCourse ? resolveCoursePrice(course, checkoutOffers) : null;
  const chargedByOffer = offerPrice?.source === "offer" ? offerPrice : null;
  const paymentChoice = paymentChoiceOf(paymentType);
  const paymentChoices = paymentChoicesFor(productFormat, paymentChoice);
  const paymentChoiceFits = paymentTypeFitsFormat(productFormat, paymentType);
  const lessonCount = countCourseLessons(modules);
  // "1 module", "2 modules": the screen used to say "1 modules, 1 lessons" (visual QA in
  // production, Sept 8). The singular has its own key, as in the course hub.
  const modulesLabel = countLabel(
    t,
    "creatorEditor.builder.summary.modulesOne",
    "creatorEditor.builder.summary.modules",
    modules.length,
  );
  const lessonsLabel = countLabel(
    t,
    "creatorEditor.builder.summary.lessonsOne",
    "creatorEditor.builder.summary.lessons",
    lessonCount,
  );
  // A course with no module opens already with the form: there is no list to look at.
  const isModuleFormOpen = isModuleFormRequested || modules.length === 0;
  // An unknown id, or one of a deleted module, falls to the list, never to an empty screen.
  const activeModuleIndex = requestedModuleId
    ? modules.findIndex((module) => module.id === requestedModuleId)
    : -1;
  const activeModule = activeModuleIndex >= 0 ? modules[activeModuleIndex] : null;
  const activeModuleId = activeModule?.id ?? null;
  // Switched module (click, back, forward): the "moved" notice belonged to the
  // previous module and goes away. Adjustment during render, React's pattern for state that
  // depends on the previous value, instead of setState in an effect.
  const [moveStatusScope, setMoveStatusScope] = useState(activeModuleId);
  if (moveStatusScope !== activeModuleId) {
    setMoveStatusScope(activeModuleId);
    setMoveStatus(null);
  }

  // The links use scroll={false}; without this, focus fell on <body> and the top of the
  // module page was off screen. Opening: scrolls to the card and focuses the
  // title. Going back: focuses the row of the module the person came from.
  useEffect(() => {
    const navigation = moduleNavigationRef.current;
    if (!navigation || typeof document === "undefined") {
      return;
    }
    moduleNavigationRef.current = null;

    if (activeModuleId) {
      document.getElementById("builder-sec-modules")?.scrollIntoView?.({ block: "start" });
      document.getElementById("builder-module-heading")?.focus({ preventScroll: true });
      return;
    }

    Array.from(document.querySelectorAll<HTMLElement>("[data-module-row]"))
      .find((row) => row.dataset.moduleRow === navigation.returnTo)
      ?.focus();
  }, [activeModuleId]);

  // The same rule (#373) for the lesson page. Entering: scrolls to the card and
  // focuses the lesson title. Leaving (Done, breadcrumb, back): focuses the button of the lesson the
  // person came from. Never on the first load: a direct link or a reload does not
  // steal focus.
  const lessonFocusRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (isLoading || typeof document === "undefined") {
      return;
    }
    const previous = lessonFocusRef.current;
    lessonFocusRef.current = activeLessonId;
    if (previous === undefined || previous === activeLessonId) {
      return;
    }

    if (activeLessonId) {
      document.getElementById("builder-sec-modules")?.scrollIntoView?.({ block: "start" });
      document.getElementById("lesson-modal-title")?.focus({ preventScroll: true });
      return;
    }

    Array.from(document.querySelectorAll<HTMLElement>("[data-lesson-open]"))
      .find((button) => button.dataset.lessonOpen === previous)
      ?.focus();
  }, [activeLessonId, isLoading]);
  const allLessons = modules.flatMap((module) =>
    module.lessons.map((lesson) => ({
      ...lesson,
      moduleTitle: module.title,
    })),
  );
  const parsedPriceAmountMinor = parsePriceAmountMinor(priceAmount);
  // Live product, charged, and with no value: saving that opened free enrollment
  // (create_free_course_enrollment reads a null price as zero). It does not save until it has a
  // value or becomes Free. With a charging offer, the field does not even appear and
  // free enrollment is already refused because of the paid price.
  const liveWithoutPrice =
    !chargedByOffer
    && course?.status === "published"
    && paymentType !== "free"
    && !(parsedPriceAmountMinor && parsedPriceAmountMinor > 0);
  const priceFieldIsValid =
    paymentType === "free" || (!hasInvalidPriceAmount(priceAmount) && !liveWithoutPrice);
  // Free is always ready; every paid model (one_time, subscription_monthly,
  // subscription_yearly) needs a positive price — priceAmountMinor is the
  // one-time charge or the per-cycle subscription amount.
  const pricingModelIsReady =
    paymentType === "free"
    || (
      typeof parsedPriceAmountMinor === "number"
      && parsedPriceAmountMinor > 0
    );
  const installmentsAreValid =
    paymentType !== "one_time" ||
    !installmentsEnabled ||
    parseInstallmentsMax(installmentsMax) !== null;
  // Single source of truth for what gets persisted. Manual save, submit, and
  // autosave all serialize from here so their payloads (and the autosave
  // change-signature) stay identical and never disagree.
  const builderDraftPayload = useMemo(
    () =>
      buildBuilderDraftPayload({
        title,
        summary,
        category,
        selectedCategories,
        learningOutcomes,
        modules,
        priceAmount,
        currency,
        paymentType,
        installmentsEnabled,
        installmentsMax,
        dripStrategy,
        dripIntervalDays,
        freePreviewLessonId,
        platformFeeBps: course?.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS,
        membersTheme,
        membersCoverAssetId,
        membersTitle,
        membersSubtitle,
        membersDescription,
        communityEnabled,
      }),
    [
      title,
      summary,
      category,
      selectedCategories,
      learningOutcomes,
      modules,
      priceAmount,
      currency,
      paymentType,
      installmentsEnabled,
      installmentsMax,
      dripStrategy,
      dripIntervalDays,
      freePreviewLessonId,
      course?.platformFeeBps,
      membersTheme,
      membersCoverAssetId,
      membersTitle,
      membersSubtitle,
      membersDescription,
      communityEnabled,
    ],
  );
  // A single list of "what is missing to publish", the same as the Publish tab and
  // Manage. Before, the builder assembled two lists of its own and the header
  // bar measured something else (stages): three numbers for a single course.
  // Reads from the normalized payload, so a wrongly typed price counts as
  // a missing price, same as what the server would save.
  // A lesson with no video, text or file blocks Publish. The server checks the
  // same rule in publish_teacher_course (20260927020000); here the person sees
  // before clicking which lessons are missing.
  const lessonIdsWithMedia = useMemo(
    () => (courseAssetsLoaded ? getLessonIdsWithMedia(builderDraftPayload.modules, courseAssets) : undefined),
    [courseAssetsLoaded, builderDraftPayload.modules, courseAssets],
  );
  const readiness = getCourseReadiness(
    {
      ...builderDraftPayload,
      coverImageUrl: course?.coverImageUrl ?? null,
      lessonIdsWithMedia,
      productFormat,
      scheduledSessionCount: productFormat === "live_event" ? courseSessions?.length : undefined,
      lessonFileCount:
        productFormat === "ebook" && courseAssetsLoaded
          ? countLessonFiles(builderDraftPayload.modules, courseAssets)
          : undefined,
    },
    publishGates,
    t,
  );
  // The line "4 of 7 checks · 57%" is the name of the bar that goes with it.
  const readinessText = t("creatorEditor.builder.summary.checks")
    .replace("{done}", () => String(readiness.doneCount))
    .replace("{total}", () => String(readiness.total))
    .replace("{percent}", () => String(readiness.percent));
  // Only the fee is missing: the main button becomes "Activate and publish" and leads to
  // checkout with this course, so the return lands back here.
  const needsActivation = readiness.pending.some((item) => item.id === "activation");
  const readyToPublish = readiness.pending.every((item) => item.id === "activation");
  const activateHref = `/teach/activate?courseId=${encodeURIComponent(courseId ?? "")}`;
  const starterLesson = modules[0]?.lessons[0];
  // Payments ready, the wallet offers the way back to this Publish tab.
  const payoutsHref = `/account/payments?returnTo=${encodeURIComponent(
    `/teach/builder?courseId=${encodeURIComponent(courseId ?? "")}&tab=review`,
  )}#stripe-connect`;
  // A live product does not publish again (teacherCanPublishCourse): in place of
  // a disabled, mute "Publish product", the sentence that says why.
  const isLive = course?.status === "published";
  // Someone who never subscribed goes to the plans (the free trial lives there), as on the
  // teacher Home; "Manage plan" opened the receipts. Someone who already had a plan manages it.
  const planLink = planId === "free"
    ? { href: "/account/plans", label: t("billingCheckout.seePlans") }
    : { href: "/account/billing?tab=subscriptions", label: t("creatorEditor.builder.publish.managePlan") };
  // A price or installments error appears on the field itself when it is on screen
  // (aria-invalid + the sentence linked by aria-describedby); outside the
  // price tab, in the alert near the clicked button.
  const priceFieldShown = activeTab === "pricing" && Boolean(checkoutOffers) && !chargedByOffer && paymentChoice !== "free";
  const priceFieldError = priceFieldShown
    && (error?.code === "price" || error?.code === "livePrice" || error?.code === "paidPrice");
  const installmentsFieldError = priceFieldShown && showSplitPayments && installmentsEnabled
    && (error?.code === "installmentsSave" || error?.code === "installmentsPublish");
  const activeLessonStudioModule = activeLessonStudio
    ? modules.find((module) => module.id === activeLessonStudio.moduleId) ?? null
    : null;
  // The e-book's lesson: the first one that exists (the product is born with one).
  const ebookModule = productFormat === "ebook"
    ? modules.find((module) => module.lessons.length > 0)
    : undefined;
  const ebookLesson = ebookModule?.lessons[0];
  const activeLessonStudioLesson =
    activeLessonStudio && activeLessonStudioModule
      ? activeLessonStudioModule.lessons.find(
          (lesson) => lesson.id === activeLessonStudio.lessonId,
        ) ?? null
      : null;
  const activeLessonStudioModuleIndex = activeLessonStudioModule
    ? modules.findIndex((module) => module.id === activeLessonStudioModule.id)
    : -1;
  // Same condition that picks renderLessonPage() on the Curriculum tab.
  const isLessonPage = activeTab === "content" && !(ebookLesson && ebookModule) && Boolean(activeLessonStudioLesson);
  const activeLessonStudioLessonIndex =
    activeLessonStudioModule && activeLessonStudioLesson
      ? activeLessonStudioModule.lessons.findIndex(
          (lesson) => lesson.id === activeLessonStudioLesson.id,
        )
      : -1;
  const selectedTabIndex = builderTabs.findIndex(
    (tab) => tab.value === activeTab,
  );
  const savedLessonIds = new Set(
    course?.modules.flatMap((module) =>
      module.lessons.map((lesson) => lesson.id),
    ) ?? [],
  );
  // The summary says what the page charges: with a main price, that one; without knowing
  // yet, no price.
  const summaryPrice = chargedByOffer
    ? { type: chargedByOffer.paymentType, amountMinor: chargedByOffer.amountMinor, currency: chargedByOffer.currency }
    : { type: paymentType, amountMinor: parsedPriceAmountMinor, currency };
  const priceIntervalSuffix =
    summaryPrice.type === "subscription_monthly"
      ? t("creatorEditor.builder.summary.month")
      : summaryPrice.type === "subscription_yearly"
        ? t("creatorEditor.builder.summary.year")
        : "";
  const formattedPrice =
    !checkoutOffers || viewingOthersCourse
      ? null
      : summaryPrice.type === "free"
      ? t("publicCourses.free")
      : summaryPrice.amountMinor
        ? `${new Intl.NumberFormat(locale, {
            style: "currency",
            currency: summaryPrice.currency.toUpperCase(),
            maximumFractionDigits: 0,
          }).format(summaryPrice.amountMinor / 100)}${priceIntervalSuffix}`
        : t("creatorEditor.builder.summary.setPrice");
  // Value in the chosen currency: the card examples, the installments preview
  // and the annual savings. Cents only when they exist ("3x of $100").
  const formatMoney = (amountMinor: number, moneyCurrency = currency) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: moneyCurrency.toUpperCase(),
      minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  // With no lesson yet the selector is dimmed: the line below says why (F-12).
  const previewNeedsLesson = isEditable && allLessons.length === 0;
  const previewLessonField = (
    <div className="mt-4 grid gap-2">
    <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
      {t("creatorEditor.builder.pricing.preview")}
      <select
        value={freePreviewLessonId}
        onChange={(event) => chooseFreePreviewLesson(event.target.value)}
        disabled={!isEditable || allLessons.length === 0}
        aria-describedby={previewNeedsLesson ? "builder-preview-needs-lesson" : undefined}
        className="field-input disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{t("creatorEditor.builder.pricing.noPreview")}</option>
        {allLessons.map((lesson) => (
          <option key={lesson.id} value={lesson.id}>
            {lesson.moduleTitle} - {lesson.title}
          </option>
        ))}
      </select>
    </label>
    {/* Outside the <label>: inside, the sentence would enter the field's name. */}
    {previewNeedsLesson ? (
      <p id="builder-preview-needs-lesson" className="text-xs text-[var(--color-ink-soft)]">
        {t("creatorEditor.builder.pricing.previewNeedsLesson")}
      </p>
    ) : null}
    </div>
  );
  const splitCountOptions = [...new Set([...splitPaymentCounts, Number(installmentsMax)])]
    .filter((count) => Number.isInteger(count) && count >= 1)
    .sort((left, right) => left - right);
  // The same calculation as checkout (buildInstallmentPlan): the largest number of
  // installments and how much each one comes to.
  const lastSplit = parsedPriceAmountMinor
    ? buildInstallmentPlan({
        amountMinor: parsedPriceAmountMinor,
        installmentsEnabled: true,
        installmentsMax: Number(installmentsMax),
        currency,
      }).options.at(-1)
    : undefined;
  const splitPreview = lastSplit
    ? t("creatorEditor.builder.pricing.splitPreview")
        .replace("{count}", () => String(lastSplit.count))
        .replace("{amount}", () => formatMoney(lastSplit.amountMinor))
    : null;
  const yearlyAmountMinor = parsePriceAmountMinor(yearlyAmount);
  const yearlySaving =
    parsedPriceAmountMinor && yearlyAmountMinor
      ? yearlySavingMinor(parsedPriceAmountMinor, yearlyAmountMinor)
      : null;
  const tabCompletion: Record<BuilderTab, boolean> = {
    details: Boolean(
      title.trim()
      && summary.trim().length >= 20
      && selectedCategories.length > 0
    ),
    // Members-area customization is optional; the learner workspace falls back
    // to the course title, cover, and light theme.
    members: true,
    // Course: module and lesson. The other types: what readiness checks for them.
    content: productFormat === "course"
      ? modules.length > 0 && lessonCount > 0
      : readiness.items.every((item) => item.group !== "content" || item.optional || item.done),
    pricing:
      pricingModelIsReady &&
      priceFieldIsValid &&
      installmentsAreValid,
    review: readiness.ready,
  };
  const stageCompletion: Record<string, boolean> = {
    basics: tabCompletion.details,
    pricing: tabCompletion.pricing,
    content: tabCompletion.content,
    members: tabCompletion.members,
    publish: tabCompletion.review,
  };
  const activeStageId =
    builderStages.find((stage) => stage.target === activeTab)?.id ??
    builderStages[0].id;
  // "Just became ready" only counts after all the reads have come back:
  // payouts and verification, the course files, and, for the event, the sessions.
  // Before that the initial falses would turn into a celebration on arrival (opening
  // ?tab=review lit up "Stripe payouts" with nobody having done anything).
  const readinessLoaded =
    gatesLoaded &&
    courseAssetsLoaded &&
    (productFormat !== "live_event" || courseSessions !== null);
  const justDoneStages = useJustDone(
    builderStages.filter((stage) => stageCompletion[stage.id]).map((stage) => stage.id),
    readinessLoaded,
  );
  const justDoneReadiness = useJustDone(
    readiness.items.filter((item) => item.done).map((item) => item.id),
    readinessLoaded,
  );
  // The opening tab is the baseline: only SWITCHING tabs animates the panel. The
  // first load enters still (no opacity 0 on what becomes LCP).
  const panelIn = useJustDone([activeTab]).has(activeTab) ? "motion-panel-in" : "";
  const totalDurationMinutes = allLessons.reduce(
    (sum, lesson) => sum + (lesson.durationMinutes ?? 0),
    0,
  );
  const formattedDuration =
    totalDurationMinutes >= 60
      ? `${Math.floor(totalDurationMinutes / 60)}h ${totalDurationMinutes % 60}m`
      : `${totalDurationMinutes}m`;

  const builderDraftSignature = useMemo(
    () => JSON.stringify(builderDraftPayload),
    [builderDraftPayload],
  );
  const draftStructureError = getCourseStructureError(
    builderDraftPayload.modules,
  );
  const autosaveBlockedReason = getAutosaveBlockedReason({
    isEditable,
    priceFieldIsValid,
    installmentsAreValid,
    draftStructureError: Boolean(draftStructureError),
  });
  const canAutosaveDraft = isEditable && autosaveBlockedReason === null;
  const draftIsDirty =
    savedSignature !== null && builderDraftSignature !== savedSignature;
  useEffect(() => {
    draftDirtyRef.current = draftIsDirty;
    const skipped = skippedSnapshotRef.current;
    // With a save of ours in flight, the stored one may be its own echo: applying it
    // revived the save and swallowed an exact return to the previous state. Success
    // discards the stored one; failure applies it (in persistDraft).
    if (draftIsDirty || !skipped || inFlightSavesRef.current > 0) {
      return;
    }
    // The draft became clean again without a save of ours (the edit was undone, or the
    // autosave was blocked/failed and the person went back). The server may have
    // something newer, from another tab or from the sales page in Manage, which
    // uses the same full-replace RPC. Without this, the next edit of any kind
    // would write the whole old copy over it.
    skippedSnapshotRef.current = null;
    // Asynchronous: setState directly in the effect body is forbidden (react-hooks).
    // The microtask checks again: between scheduling and running, an edit may have
    // committed (React flushes pending effects before the render of a
    // keystroke). Applying blindly swapped that edit for the old snapshot and
    // marked it as saved. Dirty, or with a save in flight, the snapshot goes back to the
    // stored one (without replacing a newer one): the next successful save
    // discards it, and a save that fails applies it (in persistDraft).
    queueMicrotask(() => {
      if (draftDirtyRef.current || inFlightSavesRef.current > 0) {
        skippedSnapshotRef.current ??= skipped;
        return;
      }
      applyServerDraft(skipped);
    });
  }, [draftIsDirty, applyServerDraft]);
  useEffect(() => {
    localModulesRef.current = modules;
  }, [modules]);
  if (courseId && uploadManager?.job?.courseId === courseId && uploadManager.job.status === "success") {
    const reconciled = reconcileLessonVideoSelections(courseId, modules);
    if (JSON.stringify(reconciled) !== JSON.stringify(modules)) setModules(reconciled);
  }
  // Price and installments only become invalid through typing (hydration always
  // produces a valid value or an empty one). An invalid price that normalizes to the same
  // value as the base ("invalid" and empty both become null) does not change the signature, and the
  // studio said "All changes saved" with the wrong field on screen. The block on
  // these fields is visible even without a difference in the signature; structure still
  // requires a dirty draft, because it can come that way from the database.
  const typedFieldBlocksSave =
    savedSignature !== null
    && (autosaveBlockedReason === "price" || autosaveBlockedReason === "installments");
  const displayedSaveStatus: "pending" | "saving" | "saved" | "error" | "blocked" =
    autosaveState === "saving"
      ? "saving"
      : autosaveState === "error"
        ? "error"
        : autosaveBlockedReason && (draftIsDirty || typedFieldBlocksSave)
          ? "blocked"
          : draftIsDirty
            ? "pending"
            : "saved";

  // Clicking the already chosen card changes nothing: an old product that charges
  // yearly stays yearly inside "Membership".
  function handlePaymentChoiceChange(nextChoice: PaymentChoice) {
    if (nextChoice !== paymentChoice) {
      handlePaymentTypeChange(paymentTypeOfChoice(nextChoice));
    }
  }

  function handlePaymentTypeChange(nextPaymentType: TeacherCoursePaymentType) {
    if (!isEditable) {
      return;
    }

    setPaymentType(nextPaymentType);

    // Leaving Free, the field used to start with "0"; empty shows the example.
    if (paymentType === "free" && nextPaymentType !== "free" && priceAmount.trim() === "0") {
      setPriceAmount("");
    }

    if (nextPaymentType === "free") {
      setPriceAmount("0");
      setInstallmentsEnabled(false);
    }

    if (nextPaymentType !== "one_time") {
      setInstallmentsEnabled(false);
    }

    setSuccess(null);
  }

  function toggleCategory(nextCategory: string) {
    if (!isEditable) {
      return;
    }

    setSelectedCategories((current) => {
      const nextCategories = current.includes(nextCategory)
        ? current.filter((categoryItem) => categoryItem !== nextCategory)
        : [...current, nextCategory];
      const normalizedCategories = normalizeCourseCategories(nextCategories);

      setCategory(normalizedCategories[0] ?? "");
      return normalizedCategories;
    });
    setSuccess(null);
  }

  function handleAddModule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable) {
      return;
    }

    const nextTitle = moduleTitle.trim();

    if (!nextTitle) {
      // LOCAL form error, not the studio's shared `error`: that one
      // is rendered ~600 lines below here, three screens of scrolling away from the
      // button. Clicking "Add module" without a title seemed to do nothing, and the
      // explanation was off screen.
      setModuleError(true);
      return;
    }

    setModuleError(false);

    const nextModule = {
      id: createLocalId("module"),
      title: nextTitle,
      summary: moduleSummary.trim() || null,
      coverAssetId: null,
      lessons: [],
    };

    setModules((current) => [...current, nextModule]);
    setLessonModuleId(nextModule.id);
    setModuleTitle("");
    setModuleSummary("");
    // The newly created module opens on its page: that is where the next lesson goes.
    moduleNavigationRef.current = { returnTo: null };
    router.push(builderModuleHref(nextModule.id), { scroll: false });
    setIsModuleFormOpen(false);
    setError(null);
    setSuccess(null);
  }

  // The single door for choosing the sample lesson: lesson page, Pricing
  // tab selector, row menu and new lesson box. Only the lesson page
  // synced the videos; on the other three the storefront answered "Video
  // unavailable" for the sample, and when switching from A to B the videos of A
  // stayed marked as sample (is_preview) and those of B did not. "" = none.
  function chooseFreePreviewLesson(next: string) {
    if (next === freePreviewLessonId) {
      return;
    }
    setFreePreviewLessonId(next);
    if (!course) {
      return;
    }
    // The course flag alone does not open the video for someone who has not
    // bought yet: the anonymous fetch filters by is_preview on the asset. Without this
    // step, marking the preview after the upload left the storefront with
    // "Video unavailable" and no notice in the studio.
    void syncLessonPreviewAssets(course.id, next).catch(() => {
      // A failure here must not take the builder down. Nothing else redoes this
      // sync (publish does not call it): the sample stays at "Video
      // unavailable" until the teacher chooses it again, and nothing else depends on it.
    });
  }

  function openLessonForm(moduleId: string) {
    // `lessonModuleId` used to be the "Choose module" select; now the module row
    // answers for it, and `handleAddLesson` stays the same.
    setLessonFormModuleId(moduleId);
    setLessonModuleId(moduleId);
  }

  function handleAddLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable) {
      return;
    }

    // The open form's module wins; `lessonModuleId` stays as a fallback.
    const targetModuleId = lessonFormModuleId || lessonModuleId;

    if (!targetModuleId) {
      setError({ code: "chooseModule" });
      return;
    }

    const nextTitle = lessonTitle.trim();

    if (!nextTitle) {
      setError({ code: "lessonTitle" });
      return;
    }

    const nextLessonId = createLocalId("lesson");

    // A new lesson is born with only the title: type, drip, note, text and link left
    // the form (decision of Sept 14). The content goes in "Edit content".
    setModules((current) =>
      current.map((module) =>
        module.id === targetModuleId
          ? {
              ...module,
              lessons: [
                ...module.lessons,
                {
                  id: nextLessonId,
                  title: nextTitle,
                  type: "video",
                  description: "",
                  durationMinutes: null,
                  dripDelayDays: null,
                  contentText: null,
                  externalUrl: null,
                },
              ],
            }
          : module,
      ),
    );
    if (lessonIsFreePreview) {
      // The new lesson has no video yet, but the sync closes out the previous one's.
      chooseFreePreviewLesson(nextLessonId);
    }
    setLessonTitle("");
    setLessonIsFreePreview(false);
    setError(null);
    // Video-first flow: the lesson studio (Video tab) opens automatically as
    // soon as autosave persists the lesson — no hunting for the studio button.
    pendingLessonStudioRef.current = {
      moduleId: targetModuleId,
      lessonId: nextLessonId,
    };
    setLessonAddedIn(targetModuleId);
    setSuccess("lessonAdded");
  }

  function updateModuleTitle(moduleId: string, nextTitle: string) {
    if (!isEditable) {
      return;
    }

    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === moduleId ? { ...module, title: nextTitle } : module,
      ),
    );
    setSuccess(null);
  }

  function updateModuleSummary(moduleId: string, nextSummary: string) {
    if (!isEditable) {
      return;
    }

    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === moduleId ? { ...module, summary: nextSummary } : module,
      ),
    );
    setSuccess(null);
  }

  function updateModuleCover(moduleId: string, assetId: string, slot: "hero" | "media" = "hero") {
    if (!isEditable || !courseId) return;
    setModules((current) => current.map((module) => module.id === moduleId
      ? { ...module, coverAssetId: assetId } : module));
    refreshCourseAssets(slot);
  }

  // The media library asks for "media": the failure shows below it, where the file
  // was deleted or uploaded. Lesson and module cover go to the top.
  function refreshCourseAssets(slot: "hero" | "media" = "hero") {
    if (!courseId) return;
    const request = ++assetsRequestRef.current;
    void fetchCourseAssets(courseId)
      .then((nextAssets) => {
        if (request === assetsRequestRef.current) {
          setCourseAssets(nextAssets);
          setCourseAssetsLoaded(true);
        }
      })
      .catch(() => {
        setErrorSlot(slot);
        setError({ code: "load" });
      });
  }

  // "Moved X to position N": Up/Down used to swap the rows without motion and without an
  // announcement (only moving to another module announced).
  function movedTo(title: string, position: number) {
    return t("creatorEditor.builder.curriculum.movedTo")
      .replace("{title}", () => title)
      .replace("{position}", () => String(position));
  }

  function moveModule(moduleId: string, direction: "up" | "down") {
    if (!isEditable) {
      return;
    }

    const index = modules.findIndex((module) => module.id === moduleId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index >= 0 && target >= 0 && target < modules.length) {
      setReorderStatus(movedTo(modules[index].title || t("creatorEditor.builder.curriculum.untitledModule"), target + 1));
    }
    setModules((currentModules) => {
      const currentIndex = currentModules.findIndex((module) => module.id === moduleId);
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      return moveArrayItem(currentModules, currentIndex, nextIndex);
    });
    setSuccess(null);
  }

  function deleteModule(moduleId: string) {
    if (!isEditable) {
      return;
    }

    // The 1.8s autosave makes this deletion permanent almost immediately, so
    // it must be confirmed — mirrors the asset-delete confirm in
    // course-asset-uploader / lesson-content-modal.
    const target = modules.find((module) => module.id === moduleId);
    const lessonCount = target?.lessons.length ?? 0;
    ask({
      title: t("creatorEditor.builder.confirm.deleteModuleTitle"),
      body: t(lessonCount === 0
        ? "creatorEditor.builder.confirm.deleteModuleEmpty"
        : lessonCount === 1
          ? "creatorEditor.builder.confirm.deleteModuleOne"
          : "creatorEditor.builder.confirm.deleteModuleMany")
        .replace(/\{title\}|\{count\}/g, (token) => token === "{title}"
          ? target?.title || t("creatorEditor.builder.curriculum.untitledModule")
          : String(lessonCount)),
      confirmLabel: t("creatorEditor.builder.confirm.deleteModuleAction"),
      danger: true,
      run: () => removeModule(moduleId),
    });
  }

  // Runs after the confirm dialog: reads the current state (functional updates),
  // not the one captured at click time.
  function removeModule(moduleId: string) {
    setModules((currentModules) => {
      const deletedModule = currentModules.find((module) => module.id === moduleId);
      const nextModules = currentModules.filter((module) => module.id !== moduleId);

      setLessonModuleId((current) => (current === moduleId ? nextModules[0]?.id ?? "" : current));
      setFreePreviewLessonId((current) =>
        deletedModule?.lessons.some((lesson) => lesson.id === current) ? "" : current,
      );

      return nextModules;
    });
    if (pendingLessonStudioRef.current?.moduleId === moduleId) {
      pendingLessonStudioRef.current = null;
    }
    setSuccess(null);
    // The row (and the button that had focus) goes away: focus goes to the tab title.
    window.setTimeout(() => document.getElementById("builder-panel-heading")?.focus(), 0);
  }

  function updateLesson(
    moduleId: string,
    lessonId: string,
    patch: Partial<TeacherLesson>,
  ) {
    if (!isEditable) {
      return;
    }

    if (courseId && Object.prototype.hasOwnProperty.call(patch, "videoSource")) {
      clearLessonVideoSelection(courseId, lessonId);
    }
    const applyPatch = (currentModules: TeacherCourseModule[]) =>
      currentModules.map((module) =>
        module.id === moduleId
          ? {
              ...module,
              lessons: module.lessons.map((lesson) =>
                lesson.id === lessonId ? { ...lesson, ...patch } : lesson,
              ),
            }
          : module,
      );
    // Already in the ref, without waiting for the render: the flush on exit (with the builder
    // unmounting) reads from here the link the studio just saved.
    localModulesRef.current = applyPatch(localModulesRef.current);
    setModules(applyPatch);
    setSuccess(null);
  }

  function moveLesson(moduleId: string, lessonId: string, direction: "up" | "down") {
    if (!isEditable) {
      return;
    }

    const lessons = modules.find((module) => module.id === moduleId)?.lessons ?? [];
    const index = lessons.findIndex((lesson) => lesson.id === lessonId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index >= 0 && target >= 0 && target < lessons.length) {
      // The region of the module page that already announces "Move to module".
      setMoveStatus({ moduleId, text: movedTo(lessons[index].title || t("creatorEditor.lesson.untitled"), target + 1) });
    }
    setModules((currentModules) =>
      currentModules.map((module) => {
        if (module.id !== moduleId) {
          return module;
        }

        const currentIndex = module.lessons.findIndex((lesson) => lesson.id === lessonId);
        const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

        return {
          ...module,
          lessons: moveArrayItem(module.lessons, currentIndex, nextIndex),
        };
      }),
    );
    setSuccess(null);
  }

  // Move to another module: goes to the end of it, as the same object (same
  // id). The studio about to open (newly created lesson) now targets the new module;
  // otherwise it would look for the lesson in the old module and be left without a lesson. (Moving only
  // exists on the module page and in the list: never with the lesson page open.)
  // `onMoved` runs only if the lesson changed module (the Move button clears the destination,
  // announces and takes the focus).
  function moveLessonToModule(lessonId: string, targetModuleId: string, onMoved?: () => void) {
    if (!isEditable) {
      return;
    }

    // A lesson that is not from this course (dragged from another tab): nothing changes, and the
    // confirmation does not even appear.
    if (!modules.some((module) => module.lessons.some((lesson) => lesson.id === lessonId))) {
      return;
    }

    const target = modules.find((module) => module.id === targetModuleId);
    // Already in that module (e.g., dropped on its own row): nothing changes.
    if (!target || target.lessons.some((lesson) => lesson.id === lessonId)) {
      return;
    }

    const move = () => {
      setModules((currentModules) => {
        const current = currentModules.find((module) => module.id === targetModuleId);
        return current
          ? moveLessonTo(currentModules, lessonId, targetModuleId, current.lessons.length)
          : currentModules;
      });
      if (pendingLessonStudioRef.current?.lessonId === lessonId) {
        pendingLessonStudioRef.current = { moduleId: targetModuleId, lessonId };
      }
      setSuccess(null);
    };

    // ponytail: with position-based release, moving can lock out again someone who already
    // had access, because the position is recalculated on every read. For now the
    // person confirms; the root fix (a completed lesson counts as released,
    // in drip-policy.ts and in lesson_is_released) needs a migration and is
    // scheduled separately.
    if (positionalDripStrategies.has(dripStrategy)) {
      ask({
        title: t("creatorEditor.builder.confirm.moveTitle"),
        body: t("creatorEditor.builder.curriculum.moveConfirm"),
        confirmLabel: t("creatorEditor.builder.confirm.moveAction"),
        run: () => {
          move();
          // With the dialog open the rest of the page is inert: the focus that
          // `onMoved` brings only lands after it closes.
          window.setTimeout(() => onMoved?.(), 0);
        },
      });
      return;
    }

    move();
    onMoved?.();
  }

  function deleteLesson(moduleId: string, lessonId: string) {
    if (!isEditable) {
      return;
    }

    // Same confirm rationale as deleteModule: autosave persists the removal
    // ~1.8s later, so an accidental click would silently destroy the lesson.
    const parentModule = modules.find((module) => module.id === moduleId);
    const targetLesson = parentModule?.lessons.find(
      (lesson) => lesson.id === lessonId,
    );
    ask({
      title: t("creatorEditor.builder.confirm.deleteLessonTitle"),
      body: t("creatorEditor.builder.confirm.deleteLesson").replace("{title}", () => targetLesson?.title || t("creatorEditor.builder.curriculum.untitledLesson")),
      confirmLabel: t("creatorEditor.builder.curriculum.deleteLesson"),
      danger: true,
      run: () => removeLesson(moduleId, lessonId),
    });
  }

  function removeLesson(moduleId: string, lessonId: string) {
    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === moduleId
          ? {
              ...module,
              lessons: module.lessons.filter((lesson) => lesson.id !== lessonId),
            }
          : module,
      ),
    );

    // After the dialog: the current state, not the one captured at click time.
    setFreePreviewLessonId((current) => (current === lessonId ? "" : current));

    // A lesson deleted before the echo of the save that carried it: the echo cannot open its
    // studio.
    if (pendingLessonStudioRef.current?.lessonId === lessonId) {
      pendingLessonStudioRef.current = null;
    }

    setSuccess(null);
    // The row (and the button that had focus) goes away: focus goes to the module title.
    window.setTimeout(() => document.getElementById("builder-module-heading")?.focus(), 0);
  }

  // Autosave and the Save button can be in flight at the same time. The badge only becomes
  // "Saved" when the LAST pending write comes back; before, the first one to come back
  // painted "Saved" with the other still in flight.
  const persistDraft = useCallback(
    async (
      signature: string,
      payload: Parameters<typeof updateTeacherCourseBuilder>[1],
    ) => {
      if (!courseId) {
        return;
      }

      inFlightSavesRef.current += 1;
      setAutosaveState("saving");

      try {
        await updateTeacherCourseBuilder(courseId, payload);
        setSavedSignature(signature);
        // The server now has our draft; the next echo brings the rest.
        skippedSnapshotRef.current = null;
        if (inFlightSavesRef.current === 1) {
          setAutosaveState("saved");
          // Last save in flight: fetches the course instead of waiting for the echo. The
          // subscribe generation counter discards a response older than the echo.
          // ponytail: with a healthy Realtime, echo and reload fetch twice;
          // remove the reload only if the cost shows up.
          void courseReloadRef.current?.();
        }
      } finally {
        inFlightSavesRef.current -= 1;
        // A save of ours failed with the draft clean: the snapshot stored during
        // the save (which the effect does not apply with a save in flight) counts now. On
        // success it was already discarded above, so nothing is left here.
        const skipped = skippedSnapshotRef.current;
        if (inFlightSavesRef.current === 0 && skipped && !draftDirtyRef.current) {
          skippedSnapshotRef.current = null;
          applyServerDraft(skipped);
        }
      }
    },
    [courseId, applyServerDraft],
  );

  // Module page (?module=M). A render function, not a component: it reads the same
  // builder state, so there is no second copy of the draft.
  // Live event: the session comes before the lessons, which become the optional
  // recording (replay). Marking and editing remain in the Agenda.
  function renderLiveSession() {
    if (productFormat !== "live_event" || !courseId) {
      return null;
    }
    const agendaHref = `/teach/events?courseId=${encodeURIComponent(courseId)}`;
    const hasSession = Boolean(courseSessions?.length);

    return (
      <>
        <section
          aria-label={t("creatorEditor.builder.productTypes.sessionTitle")}
          className="mb-6 grid gap-3 rounded-lg border fine-rule bg-white p-5"
        >
          {courseSessions === null ? null : hasSession ? (
            <ul className="grid gap-2">
              {courseSessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <CalendarDays aria-hidden="true" size={16} className="text-[var(--color-primary)]" />
                  <strong className="text-[var(--color-ink)]">
                    {formatEventDateTime(session.startsAt, locale, t("platform.events.datePending"))}
                  </strong>
                  <span className="break-all text-[var(--color-ink-soft)]">
                    {getSafeExternalUrl(session.externalUrl) ?? t("creatorEditor.builder.productTypes.sessionNoLink")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              {t("creatorEditor.builder.productTypes.sessionNone")}
            </p>
          )}
          <Link
            href={hasSession ? agendaHref : `${agendaHref}&newEvent=1`}
            className={buttonClasses({ variant: hasSession ? "outline" : "solid" }, "w-fit")}
          >
            <CalendarDays aria-hidden="true" size={15} />
            {t(hasSession
              ? "creatorEditor.builder.productTypes.sessionEdit"
              : "creatorEditor.builder.productTypes.sessionSchedule")}
          </Link>
        </section>
        <h4 className="text-sm font-semibold text-[var(--color-ink)]">
          {t("creatorEditor.builder.productTypes.replayTitle")}
        </h4>
      </>
    );
  }

  // E-book: only the file upload of the lesson that was born with the product. The
  // buyer downloads there; module, lesson and video do not appear.
  function renderEbookFiles(lessonModule: TeacherCourseModule, lesson: TeacherLesson) {
    if (!course) {
      return null;
    }

    return (
      <LessonContentModal
        key={lesson.id}
        variant="page"
        filesOnly
        course={course}
        module={lessonModule}
        moduleIndex={0}
        lesson={lesson}
        lessonIndex={0}
        isEditable={isEditable}
        isFreePreview={false}
        dripStrategy={dripStrategy}
        onClose={() => {}}
        onSetFreePreview={() => {}}
        onAssetsChanged={() => refreshCourseAssets()}
        onUpdateLesson={(patch) => updateLesson(lessonModule.id, lesson.id, patch)}
      />
    );
  }

  // Lesson page (?module=M&lesson=L): the studio body on the page itself,
  // with the Course > Module > Lesson breadcrumb in place of the modal. Same draft,
  // same autosave and same Save as the rest of the builder.
  function renderLessonPage() {
    if (!course || !activeLessonStudioModule || !activeLessonStudioLesson) {
      return null;
    }
    const lessonModule = activeLessonStudioModule;
    const lesson = activeLessonStudioLesson;

    return (
      <LessonContentModal
        // One instance per lesson: the studio state (tab, upload, whether the old
        // public note appears) does not leak from one lesson to another.
        key={lesson.id}
        variant="page"
        crumbs={{
          courseLabel: title || course.title || t("publicCourses.course"),
          courseHref: builderModuleHref(null),
          moduleLabel: lessonModule.title || t("creatorEditor.builder.curriculum.untitledModule"),
          moduleHref: builderModuleHref(lessonModule.id),
          onCourseNavigate: () => {
            moduleNavigationRef.current = { returnTo: lessonModule.id };
          },
        }}
        leaveFlushRef={studioLeaveFlushRef}
        course={course}
        module={lessonModule}
        moduleIndex={activeLessonStudioModuleIndex}
        lesson={lesson}
        lessonIndex={activeLessonStudioLessonIndex}
        isEditable={isEditable}
        isFreePreview={freePreviewLessonId === lesson.id}
        dripStrategy={dripStrategy}
        // Done replaces the history entry: module > lesson > module does not pile up.
        onClose={() => router.replace(builderModuleHref(lessonModule.id), { scroll: false })}
        onUploadingChange={(uploading, failed) => {
          if (uploading) {
            setUploadingLesson({ moduleId: lessonModule.id, lessonId: lesson.id });
            return;
          }
          // Failed with the URL somewhere else (e.g., browser back): the URL
          // goes back to the lesson before letting go; otherwise the page with the error vanished
          // before it appeared.
          const urlPointsHere = requestedTab === "content" && urlLessonStudio?.lessonId === lesson.id;
          if (failed && !urlPointsHere) {
            setUploadingLesson({ moduleId: lessonModule.id, lessonId: lesson.id, failed: true });
            router.replace(builderLessonHref(lessonModule.id, lesson.id), { scroll: false });
            return;
          }
          setUploadingLesson(null);
        }}
        onAssetsChanged={() => refreshCourseAssets()}
        onSetFreePreview={() => chooseFreePreviewLesson(freePreviewLessonId === lesson.id ? "" : lesson.id)}
        onUpdateLesson={(patch) => updateLesson(lessonModule.id, lesson.id, patch)}
      />
    );
  }

  function renderModulePage(module: TeacherCourseModule, moduleIndex: number) {
    const isLessonFormOpen = lessonFormModuleId === module.id;
    const moduleName = module.title || t("creatorEditor.builder.curriculum.untitledModule");
    // First ALREADY SAVED lesson of the module: the AI route checks the owner through it.
    const savedCourseId = course?.id;
    const savedFirstLessonId = course?.modules.find((saved) => saved.id === module.id)?.lessons[0]?.id;

    return (
      <div className="grid gap-4">
        <nav aria-label={t("creatorEditor.builder.curriculum.breadcrumb")}>
          <ol className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[var(--color-ink-soft)]">
            <li>
              <Link
                href={builderModuleHref(null)}
                scroll={false}
                onClick={(event) => {
                  if (isPlainLeftClick(event)) {
                    moduleNavigationRef.current = { returnTo: module.id };
                  }
                }}
                className="inline-flex min-h-11 items-center text-[var(--color-primary)] underline-offset-2 hover:underline"
              >
                {title || course?.title || t("publicCourses.course")}
              </Link>
            </li>
            <li aria-current="page" className="inline-flex min-w-0 items-center gap-1.5 text-[var(--color-ink)]">
              <ChevronRight aria-hidden="true" size={13} strokeWidth={2} />
              <span className="truncate">{moduleName}</span>
            </li>
          </ol>
        </nav>

        <div className="grid gap-4 border-b border-[var(--color-line)] pb-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          {course ? (
            <MembersCoverField
              course={course}
              moduleId={module.id}
              // The upload needs the module id already saved on the server.
              isEditable={isEditable && course.modules.some((saved) => saved.id === module.id)}
              coverUrl={getSafeMediaUrl(getModuleCoverAsset(module, courseAssets)?.downloadUrl)}
              onUploaded={(assetId) => updateModuleCover(module.id, assetId)}
            />
          ) : null}
          <div className="grid min-w-0 content-start gap-3">
            <h4
              id="builder-module-heading"
              tabIndex={-1}
              className="display-title text-2xl text-[var(--color-ink)] outline-none"
            >
              {moduleName}
            </h4>
            <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
              {t("creatorEditor.builder.curriculum.moduleNumber").replace("{index}", () => String(moduleIndex + 1))}
              <input
                value={module.title}
                onChange={(event) => updateModuleTitle(module.id, event.target.value)}
                disabled={!isEditable}
                className="field-input disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <label className="grid content-start gap-2 text-sm font-semibold text-[var(--color-ink)]">
              {t("creatorEditor.builder.curriculum.moduleDescription")}
              <textarea
                value={module.summary ?? ""}
                onChange={(event) => updateModuleSummary(module.id, event.target.value)}
                disabled={!isEditable}
                rows={3}
                aria-label={t("creatorEditor.builder.curriculum.moduleDescriptionNumber").replace("{index}", () => String(moduleIndex + 1))}
                placeholder={t("creatorEditor.builder.curriculum.moduleDescriptionPlaceholder")}
                className="field-input w-full resize-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            {/* The route checks the owner through an ALREADY SAVED lesson of the module. */}
            {isTeacherAiEnabled && isEditable && savedCourseId && savedFirstLessonId ? (
              <AiSuggest
                courseId={savedCourseId}
                lessonId={savedFirstLessonId}
                moduleId={module.id}
                target="module"
                currentDescription={module.summary}
                onUseTitle={(title) => updateModuleTitle(module.id, title)}
                onUseDescription={(summary) => updateModuleSummary(module.id, summary)}
              />
            ) : null}
          </div>
        </div>

        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {t(module.lessons.length === 1
            ? "creatorEditor.builder.curriculum.lessonOne"
            : "creatorEditor.builder.curriculum.lessonMany")
            .replace("{count}", () => String(module.lessons.length))}
        </p>

        {/* Position-based release (sequence, per module, per lesson): moving changes
            when the lesson opens and which one comes before. It warns beforehand, and the move asks for
            confirmation. With a custom day per lesson (custom), nothing changes. */}
        {positionalDripStrategies.has(dripStrategy) && modules.length > 1 && module.lessons.length > 0 ? (
          <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.curriculum.moveDripWarning")}
          </p>
        ) : null}

        {module.lessons.length === 0 ? (
          productFormat === "course" ? (
            <EmptyState
              as="h4"
              art={<SpotArt scene="firstLesson" />}
              title={t("creatorEditor.builder.curriculum.firstLessonTitle")}
              description={t("creatorEditor.builder.curriculum.firstLessonDetail")}
            />
          ) : (
            <p className="rounded-md border fine-rule bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.curriculum.moduleEmpty")}
            </p>
          )
        ) : (
          // One row per lesson (it used to be a 3-line card with 8 to 9 controls
          // and a filled button on each): number, title, the main action as an
          // outline, up/down, and the rest in "More actions", which opens right
          // below the row (nothing floats off screen).
          <ol className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)] bg-white">
          {module.lessons.map((lesson, lessonIndex) => {
            const lessonName = lesson.title || t("creatorEditor.builder.curriculum.untitledLesson");
            const menuOpen = lessonMenuId === lesson.id;
            return (
            <li key={lesson.id} className="grid gap-2 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className="w-6 shrink-0 text-xs font-bold tabular-nums text-[var(--color-ink-muted)]">
                  {String(lessonIndex + 1).padStart(2, "0")}
                </span>
                {/* The row shows only the title: type, wait days, note,
                    text and link left the screen (decision of Sept 14), but
                    stay in the data — updateLesson only applies the patch. */}
                <input
                  value={lesson.title}
                  onChange={(event) =>
                    updateLesson(module.id, lesson.id, {
                      title: event.target.value,
                    })
                  }
                  disabled={!isEditable}
                  aria-label={t("creatorEditor.builder.curriculum.lessonTitle")}
                  // Light border at rest: without it the title looked like loose
                  // text, not a field you edit right there.
                  className="min-h-11 min-w-0 flex-1 basis-48 rounded-md border border-[var(--color-line)] bg-white px-2 text-sm font-semibold text-[var(--color-ink)] outline-none hover:border-[var(--color-field-border)] focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
                {freePreviewLessonId === lesson.id ? (
                  <span className="rounded-md bg-[rgba(26,54,93,0.08)] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-primary)]">
                    {t("creatorEditor.builder.curriculum.previewChip")}
                  </span>
                ) : null}
                {savedLessonIds.has(lesson.id) ? (
                  <button
                    type="button"
                    onClick={() =>
                      router.push(builderLessonHref(module.id, lesson.id), { scroll: false })
                    }
                    data-lesson-open={lesson.id}
                    className="button-outline inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                    title={
                      lessonIdsWithVideo.has(lesson.id) ||
                      getTrustedLessonEmbed(lesson.externalUrl)
                        ? t("creatorEditor.builder.curriculum.editTitle")
                        : t("creatorEditor.builder.curriculum.addVideoTitle")
                    }
                  >
                    {lessonIdsWithVideo.has(lesson.id) ||
                    getTrustedLessonEmbed(lesson.externalUrl) ? (
                      t("creatorEditor.builder.curriculum.editContent")
                    ) : (
                      <>
                        <Film aria-hidden="true" size={13} strokeWidth={1.9} />
                        {t("creatorEditor.builder.curriculum.addVideo")}
                      </>
                    )}
                  </button>
                ) : autosaveState === "error" ? (
                  <button
                    type="button"
                    disabled
                    className="button-outline px-3 py-2 text-xs"
                    title={t("creatorEditor.builder.curriculum.saveErrorTitle")}
                  >
                    {t("creatorEditor.builder.curriculum.saveToUpload")}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
                    <Loader2
                      aria-hidden="true"
                      size={13}
                      strokeWidth={2.2}
                      className="motion-safe:animate-spin"
                    />
                    {t("creatorEditor.builder.curriculum.savingLesson")}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => moveLesson(module.id, lesson.id, "up")}
                  disabled={!isEditable || lessonIndex === 0}
                  aria-label={t("creatorEditor.builder.curriculum.up")}
                  title={t("creatorEditor.builder.curriculum.up")}
                  className="grid size-11 shrink-0 place-items-center rounded-md text-[var(--color-ink-soft)] enabled:hover:bg-[var(--color-surface-soft)] disabled:opacity-60"
                >
                  <ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => moveLesson(module.id, lesson.id, "down")}
                  disabled={
                    !isEditable ||
                    lessonIndex === module.lessons.length - 1
                  }
                  aria-label={t("creatorEditor.builder.curriculum.down")}
                  title={t("creatorEditor.builder.curriculum.down")}
                  className="grid size-11 shrink-0 place-items-center rounded-md text-[var(--color-ink-soft)] enabled:hover:bg-[var(--color-surface-soft)] disabled:opacity-60"
                >
                  <ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => setLessonMenuId(menuOpen ? null : lesson.id)}
                  aria-expanded={menuOpen}
                  aria-controls={menuOpen ? `lesson-more-${lesson.id}` : undefined}
                  aria-label={t("creatorEditor.builder.curriculum.moreActions").replace("{title}", () => lessonName)}
                  className="grid size-11 shrink-0 place-items-center rounded-md text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)]"
                >
                  <MoreHorizontal aria-hidden="true" size={18} strokeWidth={1.9} />
                </button>
              </div>
              {menuOpen ? (
                <div id={`lesson-more-${lesson.id}`} className="flex flex-wrap items-center gap-2 pb-1 sm:pl-8">
                  <button
                    type="button"
                    onClick={() =>
                      chooseFreePreviewLesson(freePreviewLessonId === lesson.id ? "" : lesson.id)
                    }
                    disabled={!isEditable}
                    className={`min-h-11 rounded-md border px-3 py-2 text-xs font-semibold disabled:opacity-60 ${
                      freePreviewLessonId === lesson.id
                        ? "border-[var(--color-primary)] bg-[rgba(26,54,93,0.08)] text-[var(--color-primary)]"
                        : "border-[var(--color-line)] bg-white text-[var(--color-ink-soft)]"
                    }`}
                  >
                    {freePreviewLessonId === lesson.id
                      ? t("creatorEditor.builder.curriculum.previewSelected")
                      : t("creatorEditor.builder.curriculum.markPreview")}
                  </button>
                  {/* Keyboard path (and the accessible one) to change module:
                      the selector only marks the destination and the Move button applies it. */}
                  {modules.length > 1 ? (
                    <>
                      <select
                        value={moveTargets[lesson.id] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setMoveTargets((current) => ({ ...current, [lesson.id]: value }));
                        }}
                        disabled={!isEditable}
                        aria-label={t("creatorEditor.builder.curriculum.moveLessonTo").replace(
                          "{title}",
                          () => lessonName,
                        )}
                        className="min-h-11 rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-xs text-[var(--color-ink-soft)] disabled:opacity-60"
                      >
                        <option value="">{t("creatorEditor.builder.curriculum.moveToModule")}</option>
                        {modules.map((other, otherIndex) =>
                          other.id === module.id ? null : (
                            <option key={other.id} value={other.id}>
                              {t("creatorEditor.builder.curriculum.moduleOption")
                                .replace("{index}", () => String(otherIndex + 1))
                                .replace("{title}", () => other.title || t("creatorEditor.builder.curriculum.untitledModule"))}
                            </option>
                          ),
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const targetId = moveTargets[lesson.id];
                          const target = modules.find((item) => item.id === targetId);
                          if (!target) {
                            return;
                          }
                          moveLessonToModule(lesson.id, target.id, () => {
                            setMoveTargets((current) => {
                              const next = { ...current };
                              delete next[lesson.id];
                              return next;
                            });
                            setMoveStatus({
                              moduleId: module.id,
                              text: t("creatorEditor.builder.curriculum.moveDone")
                                .replace("{title}", () => lessonName)
                                .replace("{module}", () => target.title || t("creatorEditor.builder.curriculum.untitledModule")),
                            });
                            // The row leaves this page: focus goes to the module title.
                            document.getElementById("builder-module-heading")?.focus();
                          });
                        }}
                        // Only with a destination that still exists and is not the module
                        // itself (the marked destination may have been deleted).
                        disabled={
                          !isEditable
                          || !modules.some((item) => item.id === moveTargets[lesson.id] && item.id !== module.id)
                        }
                        aria-label={t("creatorEditor.builder.curriculum.moveLessonButton").replace(
                          "{title}",
                          () => lessonName,
                        )}
                        className="button-outline px-3 py-2 text-xs"
                      >
                        {t("creatorEditor.builder.curriculum.moveButton")}
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => deleteLesson(module.id, lesson.id)}
                    disabled={!isEditable}
                    className="button-danger px-3 py-2 text-xs"
                  >
                    {t("creatorEditor.builder.curriculum.deleteLesson")}
                  </button>
                </div>
              ) : null}
            </li>
            );
          })}
          </ol>
        )}

        {/* "Add lesson" lives at the end of the list, where the new lesson goes in. The
            form used to open above the list and "Lesson added" came out in the
            footer, screens below. The notice row is the list's row (move, up,
            down, new lesson) and always stays on screen: the screen reader only
            announces a text change in a region that already existed. */}
        <div className="grid gap-2">
          <p role="status" className="text-xs font-semibold text-[var(--color-primary)]">
            {success === "lessonAdded" && lessonAddedIn === module.id
              ? t("creatorEditor.builder.success.lessonAdded")
              : moveStatus?.moduleId === module.id ? moveStatus.text : ""}
          </p>
        {isLessonFormOpen ? (
          <form
            className="grid gap-3 rounded-lg border fine-rule bg-white p-4"
            onSubmit={handleAddLesson}
          >
            <h5 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
              {t("creatorEditor.builder.curriculum.addLesson")}
              <InlineHelp
                topic={t("creatorEditor.builder.curriculum.helpTopic")}
                href="/help#drip-release"
              >
                {t("creatorEditor.builder.curriculum.help")}
              </InlineHelp>
            </h5>
            <input
              value={lessonTitle}
              onChange={(event) => {
                setLessonTitle(event.target.value);
                // The notice goes away as soon as there is a title, without waiting for another click.
                if (error?.code === "lessonTitle" && event.target.value.trim()) {
                  setError(null);
                }
              }}
              disabled={!isEditable}
              aria-label={t("creatorEditor.builder.curriculum.lessonTitle")}
              aria-invalid={error?.code === "lessonTitle" || undefined}
              aria-describedby={error?.code === "lessonTitle" ? `lesson-title-error-${module.id}` : undefined}
              placeholder={t("creatorEditor.builder.curriculum.lessonTitle")}
              className="field-input min-w-0 disabled:cursor-not-allowed disabled:opacity-60"
            />
            {/* As in the module form: the notice appears here, not in the footer. */}
            {error?.code === "lessonTitle" ? (
              <p id={`lesson-title-error-${module.id}`} role="alert" className="text-xs font-semibold text-[var(--color-danger-fg)]">
                {errorMessage}
              </p>
            ) : null}
            {/* A free preview is the minority of cases: it stays one click away from here. */}
            <details className="rounded-md border fine-rule bg-[var(--color-surface-soft)] px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--color-ink-soft)]">
                {t("creatorEditor.builder.curriculum.moreOptions")}
              </summary>
              <label className="mt-3 flex items-start gap-3 rounded-md border fine-rule bg-white p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                <input
                  type="checkbox"
                  checked={lessonIsFreePreview}
                  disabled={!isEditable}
                  onChange={(event) => setLessonIsFreePreview(event.target.checked)}
                  className="mt-1"
                />
                {t("creatorEditor.builder.curriculum.makePreview")}
              </label>
            </details>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={!isEditable}
                className="button-solid px-4 py-2.5 text-sm"
              >
                {t("creatorEditor.builder.curriculum.addLesson")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLessonFormModuleId("");
                  if (error?.code === "lessonTitle") {
                    setError(null);
                  }
                }}
                className="button-outline px-4 py-2.5 text-sm"
              >
                {t("creatorEditor.builder.curriculum.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => openLessonForm(module.id)}
            disabled={!isEditable}
            aria-label={t("creatorEditor.builder.curriculum.addLessonToModule").replace("{index}", () => String(moduleIndex + 1))}
            className="button-outline inline-flex w-fit items-center gap-1.5 px-3 py-2 text-xs"
          >
            <Plus aria-hidden="true" size={13} strokeWidth={2} />
            {t("creatorEditor.builder.curriculum.addLesson")}
          </button>
        )}
        </div>
      </div>
    );
  }

  async function saveDraft() {
    if (!courseId || !isEditable) {
      return;
    }

    setError(null);
    setSuccess(null);

    // With the field on screen, focus goes to it: on the phone the field's notice
    // was below the fold and Save seemed to do nothing.
    if (!priceFieldIsValid) {
      setError({ code: liveWithoutPrice ? "livePrice" : "price" });
      if (priceFieldShown) {
        document.getElementById("builder-price")?.focus();
      }
      return;
    }

    if (!installmentsAreValid) {
      setError({ code: "installmentsSave" });
      if (priceFieldShown && showSplitPayments && installmentsEnabled) {
        document.getElementById("builder-installments")?.focus();
      }
      return;
    }

    if (draftStructureError) {
      setError(draftStructureError);
      return;
    }

    const signatureAtSave = builderDraftSignature;
    setIsSaving(true);

    try {
      await persistDraft(signatureAtSave, builderDraftPayload);
      setSuccess("draftSaved");
    } catch (caughtError) {
      // Surface the duplicate-title block on rename the same way the create
      // screen does — otherwise a colliding title is swallowed by the generic
      // save error and the teacher can't tell why the save failed.
      const message =
        caughtError instanceof Error ? caughtError.message.toLowerCase() : "";
      pendingLessonStudioRef.current = null;
      setAutosaveState("error");
      setError({ code: message.includes("already")
        ? "duplicateTitle"
        : isActivationRequiredError(message)
          ? "activation"
          : "save" });
    } finally {
      setIsSaving(false);
    }
  }

  async function publishCourse() {
    if (!courseId || !canPublish) {
      return;
    }

    setError(null);
    setSuccess(null);

    if (!priceFieldIsValid) {
      setError({ code: "price" });
      return;
    }

    if (selectedCategories.length === 0) {
      setError({ code: "category" });
      return;
    }

    if (!pricingModelIsReady) {
      setError({ code: "paidPrice" });
      return;
    }

    if (!installmentsAreValid) {
      setError({ code: "installmentsPublish" });
      return;
    }

    if (draftStructureError) {
      setError(draftStructureError);
      return;
    }

    const signatureAtSubmit = builderDraftSignature;
    setIsSubmitting(true);
    let draftSaved = false;

    try {
      await persistDraft(signatureAtSubmit, builderDraftPayload);
      draftSaved = true;
      if (needsActivation) {
        track.coursePublishBlocked({ course_id: courseId, reason: "activation" });
        router.push(activateHref);
        return;
      }
      await publishTeacherCourse(courseId);
      track.coursePublished({
        course_id: courseId,
        teacher_id: user?.uid ?? "",
        modules_count: modules.length,
        lessons_count: modules.reduce((total, item) => total + item.lessons.length, 0),
      });
      setSuccess("published");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "";
      // What each type checks (publish_teacher_course) has its own message: the
      // event's session, the e-book's file, the linked community.
      const code = message.includes("creator_plan_required")
        ? "plan"
        : message.toLowerCase().includes("every lesson needs")
        ? "lessonContent"
        : message.toLowerCase().includes("schedule the live session")
        ? "session"
        : message.toLowerCase().includes("upload at least one file")
        ? "file"
        : message.toLowerCase().includes("turn on the community")
        ? "community"
        : message.toLowerCase().includes("preview")
        ? "preview"
        : message.toLowerCase().includes("teacher setup")
          ? "setup"
          : message.toLowerCase().includes("verification")
            ? "verification"
            : isActivationRequiredError(message)
              ? "activation"
              : message.toLowerCase().includes("payout") || message.toLowerCase().includes("onboarding")
                ? "payouts"
                : message.toLowerCase().includes("payment") || message.toLowerCase().includes("price")
                  ? "payment"
                  : "publish";
      setError({ code });
      // A failed save or a dropped connection is not a refusal: keep them out
      // of the generic "publish" bucket so the funnel shows what blocks people.
      // ponytail: network = fetch's TypeError or its message; add codes if the
      // data layer ever wraps them differently.
      const network = caughtError instanceof TypeError
        || /failed to fetch|networkerror|load failed/i.test(message);
      track.coursePublishBlocked({
        course_id: courseId,
        reason: network ? "network" : code !== "publish" ? code : draftSaved ? "publish" : "save",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const runAutosave = useCallback(
    async (
      signature: string,
      payload: Parameters<typeof updateTeacherCourseBuilder>[1],
    ) => {
      if (!courseId || isAutosavingRef.current) {
        return;
      }

      isAutosavingRef.current = true;

      try {
        await persistDraft(signature, payload);
      } catch {
        // A failed autosave also cancels any pending auto-open of the lesson
        // studio — the lesson row falls back to "Save draft to upload".
        pendingLessonStudioRef.current = null;
        setAutosaveState("error");
      } finally {
        isAutosavingRef.current = false;
      }
    },
    [courseId, persistDraft],
  );

  useEffect(() => {
    if (!courseId || isLoading) {
      return;
    }

    // Not hydrated yet, or nothing changed since the last persisted state.
    // (Hydration sets savedSignature from the course, so an initial load or
    // our own write echoing back is never seen as a user edit -> loop-safe.)
    if (savedSignature === null || builderDraftSignature === savedSignature) {
      return;
    }

    // Genuinely changed but not safe to persist yet (invalid field, or a
    // manual save/submit in flight). The "Unsaved changes" pill is derived in
    // render, so just wait — no setState in this effect body.
    if (!canAutosaveDraft || isSaving || isSubmitting) {
      return;
    }

    const payloadAtSchedule = builderDraftPayload;
    const signatureAtSchedule = builderDraftSignature;
    const handle = window.setTimeout(() => {
      void runAutosave(signatureAtSchedule, payloadAtSchedule);
    }, 1800);
    autosaveTimerRef.current = handle;

    return () => window.clearTimeout(handle);
  }, [
    courseId,
    isLoading,
    isSaving,
    isSubmitting,
    canAutosaveDraft,
    savedSignature,
    builderDraftSignature,
    builderDraftPayload,
    modules,
    runAutosave,
  ]);

  // Leaving through the browser's back/forward, a trackpad gesture or Alt+Left
  // unmounts the builder without a link click: the 1.8 s timer died with it and the
  // edit went with it (beforeunload does not fire in the App Router). The flush sends
  // the pending draft right away, through the same persistDraft as the autosave.
  useEffect(() => {
    flushOnLeaveRef.current = (withStudio) => {
      try {
        // A link typed in the studio and not yet blurred goes first, without a prompt.
        // Only when actually leaving: with the tab merely hidden, the person returns to the
        // field and decides for themselves.
        if (withStudio) {
          studioLeaveFlushRef.current?.();
        }
        // Save, autosave or Publish in flight: do not start a second full replace
        // (Publish pauses the autosave on purpose between saving and publishing).
        // The in-flight path and the normal autosave carry the rest.
        // ponytail: truly unmounting with a save in flight skips the flush, and what
        // was edited after it is lost; queue it if it becomes a real case.
        if (isAutosavingRef.current || inFlightSavesRef.current > 0 || isSaving || isSubmitting) {
          return;
        }
        if (!courseId || !canAutosaveDraft || savedSignature === null) {
          return;
        }
        // Modules from the ref: they already carry the link that was just saved above.
        const payload = {
          ...builderDraftPayload,
          modules: sanitizeModules(localModulesRef.current),
        };
        const signature = JSON.stringify(payload);
        if (signature === savedSignature) {
          return;
        }
        window.clearTimeout(autosaveTimerRef.current);
        // Through runAutosave (which calls persistDraft): the save is marked as
        // the autosave in flight, and a new timer with the same payload does not resend it.
        // It already handles the error, so nothing escapes from here.
        void runAutosave(signature, payload);
      } catch {
        // Leaving must never break the unmount.
      }
    };
  });

  // pagehide covers closing/reloading and the bfcache; visibilitychange('hidden')
  // arrives earlier, and is the only reliable signal on the phone. A hidden tab does not touch
  // the studio: switching apps and coming back must not erase the typed link.
  // ponytail: really closing the tab can cut the fetch short; fetch with
  // keepalive in the Supabase client if that shows up in production.
  useEffect(() => {
    const flush = () => flushOnLeaveRef.current(true);
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        flushOnLeaveRef.current(false);
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, []);

  // Layout, not passive: on unmount React cleans up the parent before the children,
  // so the studio's link handle (the child's layout effect) still exists
  // here. In a passive cleanup it would already have been released.
  useLayoutEffect(() => {
    const flushRef = flushOnLeaveRef;
    return () => flushRef.current(true);
  }, []);

  // Browser-level guard for the gap autosave can't cover: the debounce window
  // and a *failed* autosave both leave edits unpersisted. Warn before the tab
  // closes/reloads while the draft is dirty. Keyed on draftIsDirty so the
  // listener attaches only when there is something to lose and the closure
  // always sees current state (no ref, no setState in body -> loop-safe).
  useEffect(() => {
    if (!draftIsDirty && !uploadingLesson) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [draftIsDirty, uploadingLesson]);

  // The `beforeunload` above only exists for the browser: closing the tab, reloading,
  // going back. It does NOT fire on client-side navigation in the App Router, and that is
  // how people actually leave here, by clicking "Courses", "Sales" or the logo in the
  // sidebar. The component unmounted, the 1.8s timer died with it and the
  // draft went along, without a word.
  //
  // Capture on the document, before Next's Link handles the click. It only intercepts a
  // link that leaves this page; an internal anchor (#builder-sec-…), target=_blank
  // and a modified click (ctrl/cmd/middle, which opens in another tab and unmounts
  // nothing) go straight through.
  useEffect(() => {
    // Dirty draft or upload in progress: without the old modal's layer, the sidebar
    // and the brand links stay clickable in the middle of an upload.
    if ((!draftIsDirty && !uploadingLesson) || typeof document === "undefined") {
      return;
    }

    const handleClickCapture = (event: MouseEvent) => {
      // The click that the leave dialog repeats after "Leave anyway": goes on
      // to the Link as it did when confirm() returned true.
      if (leaveConfirmedRef.current) {
        leaveConfirmedRef.current = false;
        return;
      }
      if (event.defaultPrevented || !isPlainLeftClick(event)) {
        return;
      }

      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) {
        return;
      }
      // Upload in progress: leaving would unmount the builder and the upload would go on ownerless
      // (success with nowhere to save, error with nowhere to show). Blocks and warns.
      if (uploadingLesson) {
        event.preventDefault();
        event.stopPropagation();
        // Only warns, with a button: the exit stays blocked and the upload goes on.
        ask({
          title: t("creatorEditor.builder.confirm.uploadTitle"),
          body: t("creatorEditor.builder.confirm.uploadInProgress"),
          confirmLabel: t("creatorEditor.builder.confirm.uploadOk"),
          acknowledge: true,
          run: () => undefined,
        });
        return;
      }

      if (destination.pathname === window.location.pathname) {
        return;
      }

      // The dialog does not hold the click the way confirm() held it: the click stops
      // here and, once confirmed, is repeated on the same link (Next's Link navigates
      // as it would have). A link that vanished from the screen: goes by the address.
      event.preventDefault();
      event.stopPropagation();
      ask({
        title: t("creatorEditor.builder.confirm.leaveTitle"),
        body: t("creatorEditor.builder.confirm.leave"),
        confirmLabel: t("creatorEditor.builder.confirm.leaveAction"),
        cancelLabel: t("creatorEditor.builder.confirm.stay"),
        danger: true,
        run: () => {
          // After the dialog closes: with it open the page is inert.
          window.setTimeout(() => {
            if (anchor.isConnected) {
              leaveConfirmedRef.current = true;
              anchor.click();
              leaveConfirmedRef.current = false;
            } else {
              router.push(destination.pathname + destination.search + destination.hash);
            }
          }, 0);
        },
      });
    };

    document.addEventListener("click", handleClickCapture, true);
    return () =>
      document.removeEventListener("click", handleClickCapture, true);
  }, [ask, draftIsDirty, router, uploadingLesson, t]);

  // Stepper -> section scroll. The ref is read/cleared only here and in the
  // stepper click handler (never during render). useCallback keeps the effect
  // dependency stable.
  const scrollPendingSectionIntoView = useCallback(() => {
    const anchor = pendingScrollRef.current;
    if (!anchor || typeof document === "undefined") {
      return;
    }
    pendingScrollRef.current = null;
    window.requestAnimationFrame(() => {
      // The CSS reduced-motion block does not reach the scroll requested from JS.
      document.getElementById(anchor)?.scrollIntoView({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }, []);

  // After a stepper click switches tabs, the target section mounts on the next
  // render; scroll once activeTab settles. No-op for normal tab nav (ref null).
  useEffect(() => {
    scrollPendingSectionIntoView();
  }, [activeTab, scrollPendingSectionIntoView]);

  // On the phone the five steps become a strip that scrolls sideways (globals.css):
  // the open step comes to the middle and the right edge fades while there is a
  // hidden step, as in the classroom tabs (classroom-tabs.tsx). It only touches
  // the strip's own scrollLeft, never the page scroll. isLoading: the strip
  // only exists after loading.
  const stepsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = stepsRef.current;
    if (!row) return;
    const current = row.querySelector<HTMLElement>('[aria-current="step"]');
    if (current && row.scrollWidth > row.clientWidth) {
      const bar = row.getBoundingClientRect();
      const step = current.getBoundingClientRect();
      row.scrollLeft += step.left - bar.left - (bar.width - step.width) / 2;
    }
    const mark = () => {
      row.dataset.more = String(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
    };
    mark();
    row.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("resize", mark);
    return () => {
      row.removeEventListener("scroll", mark);
      window.removeEventListener("resize", mark);
    };
  }, [activeStageId, isLoading]);
  // The step's help, on the phone, sits behind "More about this step".
  const [stepHelpOpen, setStepHelpOpen] = useState(false);

  if (!courseId) {
    return (
      <section className="settings-section-card">
        <InlineAlert tone="error">{t("creatorEditor.builder.shell.chooseCourse")}</InlineAlert>
        <Link href="/teach" className="button-outline mt-5 px-4 py-2.5 text-sm">
          {t("creatorEditor.builder.navigation.studio")}
        </Link>
      </section>
    );
  }

  if (isLoading) {
    return <BuilderSkeleton label={t("creatorEditor.builder.shell.loading")} />;
  }

  if (error && !course) {
    return (
      <section className="settings-section-card">
        <InlineAlert tone="error">{errorMessage}</InlineAlert>
        <Link href="/teach" className="button-outline mt-5 px-4 py-2.5 text-sm">
          {t("creatorEditor.builder.navigation.studio")}
        </Link>
      </section>
    );
  }

  // The journey milestone: brass, with an icon, and the loading state inside the button. It lives
  // only at the end of the Publish tab, where the person finishes (the footer repeated it).
  // Each Publish pending item leads to the place to resolve it: the tab and the field (the
  // same anchor as the stepper), or the first lesson still without content. Plan and
  // payments have their own link; verification and activation do not (null).
  function readinessFix(itemId: string): { label: string; go: () => void } | null {
    const anchors: Record<string, [BuilderTab, string]> = {
      title: ["details", "builder-sec-basics"],
      category: ["details", "builder-sec-basics"],
      summary: ["details", "builder-sec-about"],
      cover: ["details", "builder-sec-cover"],
      outcomes: ["details", "builder-sec-outcomes"],
      pricing: ["pricing", "builder-sec-pricing"],
      installments: ["pricing", "builder-sec-pricing"],
      module: ["content", "builder-sec-modules"],
      lesson: ["content", "builder-sec-modules"],
      community: ["content", "builder-sec-modules"],
      session: ["content", "builder-sec-modules"],
      file: ["content", "builder-sec-modules"],
    };
    if (itemId === "lessonMedia") {
      const emptyModule = modules.find((candidate) =>
        candidate.lessons.some((lesson) => !lessonIdsWithMedia?.has(lesson.id)),
      );
      const lesson = emptyModule?.lessons.find((candidate) => !lessonIdsWithMedia?.has(candidate.id));
      if (!emptyModule || !lesson) {
        return null;
      }
      return {
        label: t("creatorEditor.builder.publish.openLesson"),
        // A lesson still without an echo of the save has no page: opens its module.
        go: () => router.push(
          savedLessonIds.has(lesson.id) ? builderLessonHref(emptyModule.id, lesson.id) : builderModuleHref(emptyModule.id),
          { scroll: false },
        ),
      };
    }
    const target = anchors[itemId];
    if (!target) {
      return null;
    }
    const [tab, anchor] = target;
    return {
      label: t("creatorEditor.builder.publish.fixIn").replace(
        "{step}",
        () => t(builderTabs.find((item) => item.value === tab)?.label ?? ""),
      ),
      go: () => {
        pendingScrollRef.current = anchor;
        selectTab(tab);
      },
    };
  }

  // The disabled button always says why. Before, the sentence depended only on
  // readiness: with an invalid typed price, or when opening another
  // person's course, the button went disabled in silence.
  // From the most specific to the most general: someone who is not the owner has nothing to finish;
  // the invalid typed price also fails readiness, and "fix the price"
  // says what to do better than "finish the items".
  const publishReasonKey = isLive || success === "published"
    ? null
    : viewingOthersCourse
      ? "creatorEditor.builder.publish.ownerOnly"
      : !priceFieldIsValid
        ? "creatorEditor.builder.publish.fixPrice"
        : !readyToPublish
          ? "creatorEditor.builder.publish.finish"
          : null;
  const showPublishReason = publishReasonKey !== null;
  const publishButton = isLive ? (
    <p className="text-sm font-semibold text-[var(--color-ink-soft)]">
      {t("creatorEditor.builder.publish.live")}
    </p>
  ) : (
    <Button
      variant="accent"
      size="lg"
      icon={<Send aria-hidden="true" size={16} strokeWidth={2} />}
      loading={isSubmitting}
      busyLabel={t("creatorEditor.builder.publish.publishing")}
      onClick={() => {
        setErrorSlot("publish");
        void publishCourse();
      }}
      disabled={!canPublish || !readyToPublish || !priceFieldIsValid}
      // The disabled button says why: the sentence next to it.
      aria-describedby={showPublishReason ? "builder-publish-reason" : undefined}
      className="w-full sm:w-auto"
    >
      {needsActivation
        ? t("creatorEditor.builder.publish.activateAndPublish")
        : t("creatorEditor.builder.publish.submit")}
    </Button>
  );

  // A single alert, rendered in place of errorSlot. The empty title of the new
  // lesson stays in its own form; price and installments, on the field, when
  // the field is on screen.
  const builderErrorAlert = error && error.code !== "lessonTitle" && !priceFieldError && !installmentsFieldError ? (
    <InlineAlert tone="error">
      <p>{errorMessage}</p>
      {error.code === "plan" ? (
        <Link href={planLink.href} className="button-solid mt-3 px-4 py-2 text-xs">
          {planLink.label}
        </Link>
      ) : error.code === "activation" ? (
        <Link
          href={activateHref}
          className="button-solid mt-3 px-4 py-2 text-xs"
        >
          {t("creatorEditor.builder.publish.activate")}
        </Link>
      ) : error.code === "payouts" ? (
        <Link
          href={payoutsHref}
          className="button-solid mt-3 px-4 py-2 text-xs"
        >
          {t("creatorPanel.hub.pricing.finishOnboarding")}
        </Link>
      ) : null}
    </InlineAlert>
  ) : null;
  // Published: the peak of the journey. The link to share appears right here, without going
  // to Manage. It lives on the Publish tab, in place of the button; if the person switched
  // tabs while publishing, it appears at the top of the tab they are on, instead of
  // switching the tab under someone who is typing. The brass copy button only takes
  // focus when nothing is focused (CourseShareLink), so it does not steal keys.
  const publishedPanel = success === "published" ? (
    <>
      {courseId ? (
        <PublishedPanel
          courseId={courseId}
          courseTitle={title.trim() || t("creatorPanel.hub.header.courseFallback")}
          headingRef={successNoticeRef}
        />
      ) : null}
      {/* After publishing, and only then: the verified badge offer, blocking nothing.
          Status null (the read failed or has not arrived) does not offer it. */}
      {user ? (
        <VerifiedBadgeOffer
          uid={user.uid}
          name={user.displayName}
          photoURL={user.photoURL}
          verificationStatus={verificationStatus}
          onDismiss={() => successNoticeRef.current?.focus()}
        />
      ) : null}
    </>
  ) : null;
  // A place off screen (Publish on another tab, library closed): the top.
  const heroShowsError = errorSlot === "hero"
    || (errorSlot === "publish" && activeTab !== "review")
    || (errorSlot === "media" && !isMediaLibraryOpen);

  return (
    <div className="course-builder-shell">
      <section className="course-builder-hero">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={course?.status ?? "draft"} />
            {/* Each state once: the blue strip repeated the badge's "Draft" and the
                "% ready" repeated the stepper. What stays is the short sentence next to the badge.
                Draft and "changes requested" never reached the marketplace;
                "inactive" may have an enrolled learner and stays out. */}
            {course?.status === "draft" || course?.status === "needs_changes" ? (
              <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
                {t("creatorEditor.builder.shell.unpublished")}
              </span>
            ) : null}
            {isEditable ? (
              <BuilderSaveStatus
                state={displayedSaveStatus}
                blockedReason={autosaveBlockedReason}
                // When opening the course the chip already says "Saved" with nobody having
                // saved: the green only lights up after a real write.
                justSaved={autosaveState === "saved"}
              />
            ) : null}
          </div>
          {/* On the phone the label goes away: the first field was ~800px below
              the top, and the title right below already says where you are. */}
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)] max-sm:hidden">
            {t("creatorEditor.builder.shell.title")}
          </p>
          {/* h1, not h2: this is the builder's only page and the course title is
              its subject. While it was h2, /teach/builder had no h1
              at all — someone navigating by heading (screen reader, navigation
              shortcut) entered a page without an announced title, and the heading
              tree started right at level 2. */}
          <h1 className="mt-3 break-words text-2xl font-semibold leading-tight text-[var(--color-ink)] sm:text-3xl">
            {title.trim() || t("creatorEditor.members.untitled")}
          </h1>
        </div>
        <div className="course-builder-hero__actions">
          <Link
            href={`/teach/courses/${encodeURIComponent(courseId ?? "")}/manage`}
            className="button-outline px-4 py-2.5 text-sm"
          >
            {t("creatorEditor.builder.navigation.manage")}
          </Link>
          {/* rel="opener": the preview knows it came from here, and "Exit preview"
              closes the tab instead of opening a second builder in it
              (course-preview-shell.tsx). The preview keeps this tab and zeroes
              window.opener on mount: a page from another origin opened later
              in that tab cannot reach this one. */}
          <Link
            href={`/teach/builder/${courseId}/preview`}
            target="_blank"
            rel="opener"
            className="button-outline px-4 py-2.5 text-sm"
          >
            <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
            {t("creatorEditor.preview.open")}
            <span className="sr-only"> {t("account.opensNewTab")}</span>
          </Link>
          {/* Outline, not navy: the course already saves on its own and the badge next to it says
              the state. The label does not become "Saving..." (the badge already says it): the
              waiting face repeats "Save draft" with the ring, and the ring's place
              is reserved, so the button does not push Manage and Preview. */}
          <Button
            variant="outline"
            loading={isSaving}
            busyLabel={t("creatorEditor.builder.navigation.save")}
            onClick={() => {
              setErrorSlot("hero");
              void saveDraft();
            }}
            disabled={!isEditable}
          >
            {t("creatorEditor.builder.navigation.save")}
          </Button>
        </div>
      </section>
      {heroShowsError ? builderErrorAlert : null}
      {/* There is a single "Save draft", up here: the confirmation appears below it. */}
      {success === "draftSaved" ? (
        <p className="motion-rise-in info-notice">
          {t("creatorEditor.builder.success.draftSaved")}
        </p>
      ) : null}
      {activeTab === "review" ? null : publishedPanel}

      <nav className="course-builder-stepper" aria-label={t("creatorEditor.builder.navigation.steps")}>
        <div className="course-builder-stepper__head">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)] max-sm:hidden">
              {t("creatorEditor.builder.navigation.creation")}
            </p>
            {/* Two lines, not an ellipsis: the only hint for the next step came out
                cut off ("Upload a cover — it fronts the pro..."). */}
            <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.navigation.next")}{" "}
              <span className="text-[var(--color-primary)]">
                {readiness.next?.hint ?? t("creatorEditor.builder.publish.ready")}
              </span>
            </p>
          </div>
          <div className="course-builder-stepper__meter">
            {/* Readiness lives only here, on one line: the "71%" appeared three
                times (top chip, this line and the footer card). */}
            {/* aria-hidden: the bar right below already says this sentence (it is its
                name) and the value; without this the screen reader read everything twice. */}
            <p aria-hidden="true" className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
              {readinessText}
            </p>
            {/* The bar measured stages (5) and the chip measured checks (7): 40% and
                71% in the same header for the same course. Now all three read
                the same number. */}
            {/* The shared bar (brass text, track that follows the theme),
                the same as the course panel and the learner area. */}
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar value={readiness.percent} label={readinessText} className="flex-1" />
              {readiness.percent === 100 ? <MilestoneSeal animate={justDoneReadiness.size > 0} /> : null}
            </div>
          </div>
        </div>
        <div ref={stepsRef} className="course-builder-steps">
          {builderStages.map((stage, index) => {
            const isActive = activeStageId === stage.id;
            const isDone = stageCompletion[stage.id];

            return (
              <button
                key={stage.id}
                type="button"
                aria-current={isActive ? "step" : undefined}
                onClick={() => {
                  pendingScrollRef.current = stage.anchor;
                  if (activeTab === stage.target) {
                    scrollPendingSectionIntoView();
                  } else {
                    selectTab(stage.target);
                  }
                }}
                className={`course-builder-step ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}`}
              >
                <span className="course-builder-step__num">
                  {isDone ? (
                    <DrawnCheck size={13} strokeWidth={2.6} animate={justDoneStages.has(stage.id)} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span className="min-w-0">
                  <span className="course-builder-step__label">{stage.id === "members" ? t("creatorEditor.members.step") : t(stage.label)}</span>
                  <span className="course-builder-step__sub">{stage.id === "members" ? t("creatorEditor.members.stepHelp") : t(stage.sub)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <section className="course-builder-panel">
          {/* key: switching tabs remounts the header and the animation runs again.
              On the lesson page it goes away: "Build the curriculum." and the counts
              sat between the builder and the lesson, and the breadcrumb already says where you are. */}
          {isLessonPage ? null : (
          <div key={activeTab} className={`${panelIn} flex flex-wrap items-start justify-between gap-4 pb-4`}>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                {activeTab === "members" ? t("creatorEditor.members.step") : t(builderTabs[selectedTabIndex]?.label ?? "creatorEditor.builder.shell.shortTitle")}
              </p>
              {/* Focus target when the row that had it goes away (deleted module). */}
              <h3 id="builder-panel-heading" tabIndex={-1} className="mt-2 text-xl font-semibold leading-tight text-[var(--color-ink)] outline-none">
                {activeTab === "details"
                  ? t("creatorEditor.builder.steps.details.heading")
                  : activeTab === "members"
                    ? t("creatorEditor.members.heading")
                    : activeTab === "content"
                      ? t(productFormat === "live_event"
                        ? "creatorEditor.builder.productTypes.sessionTitle"
                        : productFormat === "ebook"
                          ? "creatorEditor.builder.productTypes.ebookTitle"
                          : "creatorEditor.builder.steps.content.heading")
                      : activeTab === "pricing"
                        ? t("creatorEditor.builder.steps.pricing.heading")
                        : t("creatorEditor.builder.steps.review.heading")}
              </h3>
              {/* On the phone the step's help stays closed behind this button: the
                  paragraph pushed the first field one more screen down.
                  From sm up the button goes away and the help stays open. */}
              <button
                type="button"
                aria-expanded={stepHelpOpen}
                aria-controls="builder-step-help"
                onClick={() => setStepHelpOpen((open) => !open)}
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] sm:hidden"
              >
                {t("creatorEditor.builder.navigation.stepHelp")}
                <ChevronDown aria-hidden="true" size={16} className={stepHelpOpen ? "rotate-180" : ""} />
              </button>
              <div id="builder-step-help" data-open={stepHelpOpen} className="course-builder-step-help">
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
                {activeTab === "details"
                  ? t("creatorEditor.builder.steps.details.help")
                  : activeTab === "members"
                    ? t("creatorEditor.members.help")
                    : activeTab === "content"
                      ? t(productFormat === "live_event"
                        ? "creatorEditor.builder.productTypes.sessionHelp"
                        : productFormat === "ebook"
                          ? "creatorEditor.builder.productTypes.ebookHelp"
                          : productFormat === "community"
                            ? "creatorEditor.builder.productTypes.communityOptional"
                            : "creatorEditor.builder.steps.content.help")
                      : activeTab === "pricing"
                        ? t("creatorEditor.builder.steps.pricing.help")
                        : t("creatorEditor.builder.steps.review.help")}
              </p>
              {activeTab === "members" ? (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
                  {t("creatorEditor.members.creatorAreaNote")}{" "}
                  <Link href="/teach/member-area" className="font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline">
                    {t("creatorEditor.members.creatorAreaLink")}
                  </Link>
                </p>
              ) : null}
              </div>
            </div>
            <div className="grid gap-2 text-right text-xs font-semibold text-[var(--color-ink-soft)]">
              {/* The e-book shows no module or lesson. */}
              {productFormat === "ebook" ? null : (
                <>
                  <span>{modulesLabel}</span>
                  <span>{lessonsLabel}</span>
                </>
              )}
              {totalDurationMinutes > 0 ? (
                <span>{t("creatorEditor.builder.summary.duration").replace("{duration}", () => formattedDuration)}</span>
              ) : null}
              <span>{formattedPrice}</span>
            </div>
          </div>
          )}

        {course?.status === "in_review" ? (
          <p className="mt-5 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.shell.legacy")}
          </p>
        ) : course?.status === "published" ? (
          <p className="mt-5 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.shell.published")}
          </p>
        ) : null}
        {course?.reviewNote ? (
          <div className="mt-5 rounded-lg border border-[rgba(178,34,52,0.18)] bg-[rgba(178,34,52,0.04)] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {t("creatorEditor.builder.shell.reviewNote")}
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
              {course.reviewNote}
            </p>
          </div>
        ) : null}

        {activeTab === "details" ? (
        <div className={`${panelIn} mt-6 grid gap-4`}>
          <div id="builder-sec-cover" className="scroll-mt-24">
            {course ? (
              <CourseCoverField
                course={course}
                isEditable={isEditable}
                onUploaded={() => void courseReloadRef.current?.()}
              />
            ) : null}
          </div>
          <label
            id="builder-sec-basics"
            className="grid gap-2 scroll-mt-24 text-sm font-semibold text-[var(--color-ink)]"
          >
            {t("creatorEditor.builder.details.title")}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={!isEditable}
              className="field-input disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <div className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t("creatorEditor.builder.details.categories")}
            <p className="text-xs font-normal leading-5 text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.details.categoriesHelp")}
            </p>
                  <CourseCategorySelect
              options={skillsetCourseCategories}
              selected={selectedCategories}
              onToggle={toggleCategory}
              disabled={!isEditable}
            />
          </div>
          <label
            id="builder-sec-about"
            className="grid gap-2 scroll-mt-24 text-sm font-semibold text-[var(--color-ink)]"
          >
            {t("creatorEditor.builder.details.summary")}
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              disabled={!isEditable}
              rows={4}
              className="field-input resize-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                summary.trim().length >= 20
                  ? "text-[var(--color-ink-soft)]"
                  : "text-[var(--color-warning-fg)]"
              }`}
            >
              {summary.trim().length >= 20 ? null : (
                <AlertTriangle aria-hidden="true" size={13} strokeWidth={2} />
              )}
              {summary.trim().length >= 20
                ? t("creatorEditor.builder.details.characters").replace("{count}", () => String(summary.trim().length))
                : t("creatorEditor.builder.details.minimumCharacters").replace("{count}", () => String(summary.trim().length))}
            </span>
          </label>
          <div id="builder-sec-outcomes" className="scroll-mt-24 grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="grid gap-1">
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  {t("creatorEditor.builder.details.outcomes")}
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">
                  {t("creatorEditor.builder.details.outcomesHelp")}
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-[var(--color-ink-soft)]">
                {normalizeLearningOutcomes(learningOutcomes).length}/
                {MAX_LEARNING_OUTCOMES}
              </span>
            </div>

            {learningOutcomes.length > 0 ? (
              <ul className="grid gap-2">
                {learningOutcomes.map((outcome, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <input
                      value={outcome}
                      onChange={(event) =>
                        setLearningOutcomes((previous) =>
                          previous.map((item, itemIndex) =>
                            itemIndex === index ? event.target.value : item,
                          ),
                        )
                      }
                      disabled={!isEditable}
                      maxLength={120}
                      aria-label={t("creatorEditor.builder.details.outcomeLabel").replace("{index}", () => String(index + 1))}
                      placeholder={t("creatorEditor.builder.details.outcomePlaceholder")}
                      className="field-input min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    {isEditable ? (
                      <button
                        type="button"
                        onClick={() =>
                          setLearningOutcomes((previous) =>
                            previous.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                        aria-label={t("creatorEditor.builder.details.removeOutcome").replace("{index}", () => String(index + 1))}
                        className="grid size-11 shrink-0 place-items-center rounded-md border border-[var(--color-line)] text-[var(--color-ink-soft)] transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)] hover:border-[var(--color-danger-fg)] hover:text-[var(--color-danger-fg)]"
                      >
                        <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                {t("creatorEditor.builder.details.noOutcomes")}
              </p>
            )}

            {isEditable ? (
              <button
                type="button"
                onClick={() =>
                  setLearningOutcomes((previous) =>
                    previous.length >= MAX_LEARNING_OUTCOMES
                      ? previous
                      : [...previous, ""],
                  )
                }
                disabled={learningOutcomes.length >= MAX_LEARNING_OUTCOMES}
                aria-describedby={learningOutcomes.length >= MAX_LEARNING_OUTCOMES ? "builder-outcomes-max" : undefined}
                className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md border border-[var(--color-line)] px-3 py-2 text-xs font-semibold text-[var(--color-primary)] transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)] enabled:hover:border-[var(--color-primary-light)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus aria-hidden="true" size={14} strokeWidth={2} />
                {t("creatorEditor.builder.details.addOutcome")}
              </button>
            ) : null}
            {/* At the cap, "Add" dims: the sentence says why (F-12). */}
            {isEditable && learningOutcomes.length >= MAX_LEARNING_OUTCOMES ? (
              <p id="builder-outcomes-max" className="text-xs text-[var(--color-ink-soft)]">
                {t("creatorEditor.builder.details.outcomesMax").replace("{max}", () => String(MAX_LEARNING_OUTCOMES))}
              </p>
            ) : null}
          </div>
          <p className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.details.help")}
          </p>
        </div>
        ) : null}

        {activeTab === "members" && course ? (
          <div className={panelIn || undefined}>
          <MembersAreaTab
            courseId={courseId}
            course={course}
            isEditable={isEditable}
            theme={membersTheme}
            onThemeChange={(next) => {
              setMembersTheme(next);
              setSuccess(null);
            }}
            coverAssetId={membersCoverAssetId}
            onCoverAssetIdChange={(next) => {
              setMembersCoverAssetId(next);
              setSuccess(null);
            }}
            title={membersTitle}
            onTitleChange={(next) => {
              setMembersTitle(next);
              setSuccess(null);
            }}
            subtitle={membersSubtitle}
            onSubtitleChange={(next) => {
              setMembersSubtitle(next);
              setSuccess(null);
            }}
            description={membersDescription}
            onDescriptionChange={(next) => {
              setMembersDescription(next);
              setSuccess(null);
            }}
          />
          </div>
        ) : null}

        {activeTab === "members" && course ? (
          <div className={`${panelIn} rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4`}>
            {/* The whole row is the switch, as in Account and in the lesson studio:
                before, only the 44px target around the track responded and the text
                next to it did not. The track is the app's standard .settings-toggle. */}
            <button
              type="button"
              role="switch"
              aria-checked={communityEnabled}
              aria-label={t("creatorEditor.builder.community.enable")}
              aria-describedby="builder-community-help"
              disabled={!isEditable}
              onClick={() => {
                setCommunityEnabled((previous) => !previous);
                setSuccess(null);
              }}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="grid min-w-0 gap-1">
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  {t("creatorEditor.builder.community.title")}
                </span>
                <span id="builder-community-help" className="text-xs leading-5 text-[var(--color-ink-soft)]">
                  {t("creatorEditor.builder.community.help")}
                </span>
              </span>
              <span aria-hidden="true" className={`settings-toggle shrink-0 ${communityEnabled ? "settings-toggle--on" : ""}`}>
                <span />
              </span>
            </button>
            <p className="mt-3 text-xs font-semibold text-[var(--color-ink-soft)]">
              {communityEnabled
                ? t("creatorEditor.builder.community.on")
                : t("creatorEditor.builder.community.off")}
            </p>
          </div>
        ) : null}

        {activeTab === "pricing" ? (
          <div
            id="builder-sec-pricing"
            className={`${panelIn} scroll-mt-24 rounded-lg border fine-rule bg-white p-4`}
          >
            {checkoutOffers && offersFailed ? (
              <RetryAlert
                className="mb-4"
                text={t("creatorEditor.builder.pricing.offersRefreshFailed")}
                onRetry={retryOffers}
                busy={offersRetrying}
              />
            ) : null}
            {viewingOthersCourse ? (
              <InlineAlert tone="info">{t("creatorEditor.builder.pricing.ownerOnly")}</InlineAlert>
            ) : !checkoutOffers ? (
              // Without the price list, the main price is unknown: no
              // cards on top of it. While it arrives, blocks the size of the
              // cards hold the place (before, the panel had only the footnote
              // and the cards came in pushing everything).
              offersFailed ? (
                <RetryAlert
                  text={t("creatorEditor.builder.pricing.offersFailed")}
                  onRetry={retryOffers}
                />
              ) : (
                <div role="status" className="grid gap-4">
                  <span className="sr-only">{t("creatorPanel.offers.loading")}</span>
                  <div aria-hidden="true" className="h-5 w-48 animate-pulse rounded-sm bg-[var(--color-surface-strong)]" />
                  <div aria-hidden="true" className={`grid animate-pulse gap-4 ${planGridColumns(paymentChoices.length)}`}>
                    {paymentChoices.map((choice) => (
                      <div key={choice} className="h-28 rounded-lg bg-[var(--color-surface-strong)]" />
                    ))}
                  </div>
                </div>
              )
            ) : chargedByOffer ? (
              // The page charges the main offer: cards and fields here
              // would only change the builder, and checkout would keep charging it.
              <>
                <p className="text-base font-semibold text-[var(--color-ink)]">
                  {t("creatorEditor.builder.pricing.question")}
                </p>
                <p className="mt-2 text-sm text-[var(--color-ink)]">
                  {t("creatorEditor.builder.pricing.offerCharges")
                    .replace("{price}", () => formatMoney(chargedByOffer.amountMinor, chargedByOffer.currency))
                    .replace("{model}", () => t(`creatorPanel.paymentType.${chargedByOffer.paymentType}`))}{" "}
                  <Link
                    href={`/teach/courses/${encodeURIComponent(courseId ?? "")}/manage?section=pricing`}
                    className="font-semibold text-[var(--color-primary)] underline"
                  >
                    {t("creatorEditor.builder.pricing.offerChange")}
                  </Link>
                </p>
                {chargedByOffer.paymentType === "free" ? null : previewLessonField}
              </>
            ) : (
            <>
            {/* A single question, asked once. The fields of each card only
                appear after the choice; the cards stay mounted and focus
                stays on the clicked card. */}
            <PlanSelectorCards
              label={
                <span className="flex items-center gap-2 text-base">
                  {t("creatorEditor.builder.pricing.question")}
                  <InlineHelp
                    topic={t("creatorEditor.builder.pricing.helpTopic")}
                    href="/help#course-pricing"
                  >
                    {t("creatorEditor.builder.pricing.help")}
                  </InlineHelp>
                </span>
              }
              options={paymentChoices.map((choice) => {
                const copy = choice === "one_payment" && productFormat === "live_event" ? "ticket" : choice;
                return {
                  value: choice,
                  title: t(`creatorEditor.builder.pricing.choices.${copy}.title`),
                  description: t(`creatorEditor.builder.pricing.choices.${copy}.description`).replace(
                    "{amount}",
                    () => formatMoney(paymentChoiceExamples[choice] * 100),
                  ),
                  features: [],
                  icon: paymentChoiceIcons[copy],
                };
              })}
              value={paymentChoice}
              onChange={handlePaymentChoiceChange}
              disabled={!isEditable}
            />
            {paymentChoiceFits ? null : (
              <InlineAlert tone="error" className="mt-3">
                {t("creatorEditor.builder.pricing.notForType")}
              </InlineAlert>
            )}
            {paymentChoice === "free" ? (
              <p className="mt-4 text-sm font-semibold text-[var(--color-ink)]">
                {t("creatorEditor.builder.pricing.freeLine")}
              </p>
            ) : (
              <>
                {/* The currency column used to be a fixed 140px. A <select> never gets narrower
                    than its widest option ("BRL - Brazilian Real"),
                    so it pushed the edge and left the card on medium and
                    large screens. minmax(0, …) on both columns lets the grid shrink, and the
                    select's own min-w-0 (in CurrencySelect) lets the control
                    follow the column instead of the column following the control. */}
                <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,200px)]">
                  <div className="grid min-w-0 content-start gap-2">
                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-[var(--color-ink)]">
                    {t(
                      paymentType === "subscription_monthly"
                        ? "creatorEditor.builder.pricing.pricePerMonth"
                        : paymentType === "subscription_yearly"
                          ? "creatorEditor.builder.pricing.pricePerYear"
                          : "creatorEditor.builder.pricing.price",
                    )}
                    <input
                      id="builder-price"
                      value={priceAmount}
                      onChange={(event) => {
                        setPriceAmount(event.target.value);
                        // The field's notice goes away on correction, without waiting for another Save.
                        if (priceFieldError) {
                          setError(null);
                        }
                      }}
                      disabled={!isEditable}
                      inputMode="decimal"
                      aria-invalid={priceFieldError || undefined}
                      aria-describedby={priceFieldError ? "builder-price-error" : undefined}
                      placeholder={t("creatorEditor.builder.pricing.pricePlaceholder")}
                      className="field-input min-w-0 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                  {/* Outside the label: inside it the sentence would enter the field's name. */}
                  {priceFieldError ? (
                    <p id="builder-price-error" role="alert" className="text-xs font-semibold text-[var(--color-danger-fg)]">
                      {errorMessage}
                    </p>
                  ) : null}
                  </div>
                  <label className="grid min-w-0 gap-2 text-sm font-semibold text-[var(--color-ink)]">
                    {t("creatorEditor.builder.pricing.currency")}
                    <CurrencySelect
                      value={currency}
                      onChange={(nextCurrency) => {
                        setCurrency(nextCurrency);
                        if (nextCurrency !== "MXN") {
                          setInstallmentsEnabled(false);
                        }
                      }}
                      disabled={!isEditable}
                    />
                  </label>
                </div>
                {paymentType === "subscription_yearly" ? (
                  // An old product that charges once a year: stays that way.
                  // Switching to monthly clears the value, which was the yearly one.
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-[var(--color-ink)]">
                      {t("creatorEditor.builder.pricing.yearlyOnly")}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!isEditable}
                      onClick={() => {
                        handlePaymentTypeChange("subscription_monthly");
                        setPriceAmount("");
                      }}
                    >
                      {t("creatorEditor.builder.pricing.switchToMonthly")}
                    </Button>
                  </div>
                ) : null}
                {showSplitPayments ? (
                  <div className="mt-4 grid gap-3 rounded-lg border border-[var(--color-line)] bg-white p-4">
                    <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                      <input
                        type="checkbox"
                        checked={installmentsEnabled}
                        onChange={(event) => setInstallmentsEnabled(event.target.checked)}
                        disabled={!isEditable}
                      />
                      {t("creatorEditor.builder.pricing.split")}
                    </label>
                    {installmentsEnabled ? (
                      <div className="flex flex-wrap items-end gap-4">
                        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                          {t("creatorEditor.builder.pricing.splitMax")}
                          <select
                            id="builder-installments"
                            value={installmentsMax}
                            onChange={(event) => {
                              setInstallmentsMax(event.target.value);
                              if (installmentsFieldError) {
                                setError(null);
                              }
                            }}
                            disabled={!isEditable}
                            aria-invalid={installmentsFieldError || undefined}
                            aria-describedby={installmentsFieldError ? "builder-installments-error" : undefined}
                            className="field-input disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {splitCountOptions.map((count) => (
                              <option key={count} value={String(count)}>
                                {count}
                              </option>
                            ))}
                          </select>
                        </label>
                        {splitPreview ? (
                          <p aria-live="polite" className="pb-3 text-sm font-semibold text-[var(--color-ink)]">
                            {splitPreview}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {installmentsFieldError ? (
                      <p id="builder-installments-error" role="alert" className="text-xs font-semibold text-[var(--color-danger-fg)]">
                        {errorMessage}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {paymentType === "subscription_monthly" ? (
                  <div className="mt-4 grid gap-3 rounded-lg border border-[var(--color-line)] bg-white p-4">
                    <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                      <input
                        type="checkbox"
                        checked={yearlyPlanOpen}
                        onChange={(event) => setYearlyPlanOpen(event.target.checked)}
                        disabled={!isEditable}
                      />
                      {t("creatorEditor.builder.pricing.yearly")}
                    </label>
                    {yearlyPlanOpen ? (
                      <>
                        <label className="grid max-w-xs gap-2 text-sm font-semibold text-[var(--color-ink)]">
                          {t("creatorEditor.builder.pricing.pricePerYear")}
                          <input
                            value={yearlyAmount}
                            onChange={(event) => setYearlyAmount(event.target.value)}
                            disabled={!isEditable}
                            inputMode="decimal"
                            placeholder={t("creatorEditor.builder.pricing.pricePlaceholder")}
                            className="field-input min-w-0 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </label>
                        {yearlySaving !== null ? (
                          <p aria-live="polite" className="text-sm font-semibold text-[var(--color-ink)]">
                            {yearlySaving > 0
                              ? t("creatorEditor.builder.pricing.yearlySaving").replace(
                                  "{amount}",
                                  () => formatMoney(yearlySaving),
                                )
                              : t("creatorEditor.builder.pricing.yearlyNoSaving")}
                          </p>
                        ) : null}
                        <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                          {t("creatorEditor.builder.pricing.yearlyWhere")}
                        </p>
                        {/* Only with the monthly already saved: Manage reads the saved course and,
                            with the old value, opened another main price. */}
                        {courseId && yearlyAmountMinor && displayedSaveStatus === "saved" ? (
                          <Link
                            href={`/teach/courses/${encodeURIComponent(courseId)}/manage?section=pricing&addPrice=yearly&amount=${yearlyAmountMinor}`}
                            className={buttonClasses({ variant: "outline", size: "sm" }, "w-fit")}
                          >
                            {t("creatorEditor.builder.pricing.yearlyAdd")}
                          </Link>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
                {previewLessonField}
                <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
                  {t("creatorEditor.builder.pricing.listingHelp")}
                </p>
              </>
            )}
            </>
            )}
            {/* A frase fixa que separa parcelar de mensalidade. */}
            <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.pricing.rule")}
            </p>
          </div>
        ) : null}

        {activeTab === "content" ? (
        <div className={`${panelIn} mt-6 grid gap-4`}>
          {/* The list comes first. Before, the course structure was the last
              thing on the tab: two large always-open forms ("Add
              module" and "Add lesson", with a "Choose module" select) sat
              above it. */}
          <div
            id="builder-sec-modules"
            className="scroll-mt-24"
          >
            {/* The e-book comes before the lesson page: the upload's "Open" link
                leads to ?module&lesson, and its lesson has no page of its own. */}
            {ebookLesson && ebookModule ? renderEbookFiles(ebookModule, ebookLesson) : activeLessonStudioLesson ? renderLessonPage() : activeModule ? renderModulePage(activeModule, activeModuleIndex) : (
            <>
            {renderLiveSession()}
            {/* Only on the course: community, event and e-book have their own action.
                With no module, the only action is the "Add your first module" form
                right below (opened on its own): the empty state says the same. */}
            {modules.length === 0 && productFormat === "course" ? (
              <EmptyState
                as="h4"
                art={<SpotArt scene="firstLesson" />}
                title={t("creatorEditor.builder.curriculum.firstModuleTitle")}
                description={t("creatorEditor.builder.curriculum.firstModuleDetail")}
                className="mb-4"
              />
            ) : null}
            <div className="flex justify-end">
              {isModuleFormOpen ? null : (
                <button
                  type="button"
                  onClick={() => setIsModuleFormOpen(true)}
                  disabled={!isEditable}
                  className="button-outline inline-flex items-center gap-2 px-4 py-2.5 text-sm"
                >
                  <Plus aria-hidden="true" size={14} strokeWidth={2} />
                  {t("creatorEditor.builder.curriculum.addModule")}
                </button>
              )}
            </div>

            {isModuleFormOpen ? (
              <form
                className="mt-4 grid gap-3 rounded-lg border fine-rule bg-white p-4"
                onSubmit={handleAddModule}
              >
                <h5 className="text-sm font-semibold text-[var(--color-ink)]">
                  {t(modules.length === 0
                    ? "creatorEditor.builder.curriculum.addFirstModule"
                    : "creatorEditor.builder.curriculum.addModule")}
                </h5>
                <input
                  value={moduleTitle}
                  onChange={(event) => {
                    setModuleTitle(event.target.value);
                    setModuleError(false);
                  }}
                  disabled={!isEditable}
                  aria-label={t("creatorEditor.builder.curriculum.moduleTitle")}
                  placeholder={t("creatorEditor.builder.curriculum.moduleTitlePlaceholder")}
                  className="field-input min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t("creatorEditor.builder.curriculum.moduleDescription")}
                  <textarea
                    value={moduleSummary}
                    onChange={(event) => setModuleSummary(event.target.value)}
                    disabled={!isEditable}
                    rows={2}
                    aria-label={t("creatorEditor.builder.curriculum.moduleDescription")}
                    placeholder={t("creatorEditor.builder.curriculum.moduleDescriptionExample")}
                    className="field-input mt-3 w-full resize-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                {moduleError ? (
                  <p
                    role="alert"
                    className="text-xs font-semibold text-[var(--color-danger-fg)]"
                  >
                    {t("creatorEditor.builder.errors.moduleTitle")}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={!isEditable}
                    className="button-solid px-4 py-2.5 text-sm"
                  >
                    {t("creatorEditor.builder.curriculum.createModule")}
                  </button>
                  {modules.length === 0 ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsModuleFormOpen(false);
                        setModuleError(false);
                      }}
                      className="button-outline px-4 py-2.5 text-sm"
                    >
                      {t("creatorEditor.builder.curriculum.cancel")}
                    </button>
                  )}
                </div>
              </form>
            ) : null}

            {/* Always mounted: the screen reader only announces a change in a region
                that already existed. */}
            <p role="status" className="sr-only">{reorderStatus}</p>
            <div className="mt-4 grid gap-2">
              {modules.map((module, moduleIndex) => {
                const coverUrl = getSafeMediaUrl(getModuleCoverAsset(module, courseAssets)?.downloadUrl);
                return (
                  <article
                    key={module.id}
                    // Dropping a dragged lesson here takes it to the end of this module.
                    onDragOver={(event) => {
                      // Only accepts dragging a lesson; text or a file does not.
                      if (isEditable && Array.from(event.dataTransfer.types).includes(lessonDragType)) {
                        event.preventDefault();
                        setDragOverModuleId(module.id);
                      }
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDragOverModuleId((current) => (current === module.id ? null : current));
                      }
                    }}
                    onDrop={(event) => {
                      setDragOverModuleId(null);
                      const lessonId = event.dataTransfer.getData(lessonDragType);
                      if (lessonId) {
                        event.preventDefault();
                        moveLessonToModule(lessonId, module.id);
                      }
                    }}
                    // The row that is going to receive the lesson is marked (before, nothing changed).
                    className={`flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] p-3 ${
                      dragOverModuleId === module.id
                        ? "bg-white outline-2 outline-offset-2 outline-dashed outline-[color:var(--color-brass)]"
                        : "bg-[var(--color-surface-soft)]"
                    }`}
                  >
                    <Link
                      href={builderModuleHref(module.id)}
                      scroll={false}
                      data-module-row={module.id}
                      onClick={(event) => {
                        if (isPlainLeftClick(event)) {
                          moduleNavigationRef.current = { returnTo: null };
                        }
                      }}
                      // basis-48 like the lesson title field: at 375px the module
                      // name was left with 31px ("Fo…") squeezed by the three
                      // buttons; now it takes the row and the buttons drop below.
                      className="flex min-h-11 min-w-0 flex-1 basis-48 items-center gap-3 rounded-md"
                    >
                      {/* The 2:3 vertical cover in miniature (32x48), with the corner
                          of the other covers: it was a circle here and a rectangle
                          on the module page. */}
                      <span className="flex h-12 w-8 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-[var(--color-line)] bg-white text-[var(--color-ink-soft)]">
                        {coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- module cover is an arbitrary CourseAsset URL
                          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <ImageIcon aria-hidden="true" size={16} strokeWidth={1.9} />
                        )}
                      </span>
                      <span className="grid min-w-0">
                        <strong className="truncate text-sm text-[var(--color-ink)]">
                          {module.title || t("creatorEditor.builder.curriculum.untitledModule")}
                        </strong>
                        <span className="text-xs text-[var(--color-ink-soft)]">
                          {t(module.lessons.length === 1
                            ? "creatorEditor.builder.curriculum.lessonOne"
                            : "creatorEditor.builder.curriculum.lessonMany")
                            .replace("{count}", () => String(module.lessons.length))}
                        </span>
                      </span>
                      <ChevronRight aria-hidden="true" size={16} strokeWidth={2} className="ml-auto shrink-0 text-[var(--color-ink-soft)]" />
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveModule(module.id, "up")}
                        disabled={!isEditable || moduleIndex === 0}
                        className="button-outline px-3 py-2 text-xs"
                      >
                        {t("creatorEditor.builder.curriculum.up")}
                      </button>
                      <button
                        type="button"
                        onClick={() => moveModule(module.id, "down")}
                        disabled={!isEditable || moduleIndex === modules.length - 1}
                        className="button-outline px-3 py-2 text-xs"
                      >
                        {t("creatorEditor.builder.curriculum.down")}
                      </button>
                      {/* Far from Down: at 8 px and the same size, missing the
                          tap deleted the module. */}
                      <button
                        type="button"
                        onClick={() => deleteModule(module.id)}
                        disabled={!isEditable}
                        className="button-danger ml-4 px-3 py-2 text-xs"
                      >
                        {t("creatorEditor.builder.curriculum.delete")}
                      </button>
                    </div>
                    {isEditable && modules.length > 1 && module.lessons.length > 0 ? (
                      // Mouse path; the accessible one is the selector on the module
                      // page. On touch dragging does not exist: the labels
                      // go away instead of seeming to respond.
                      <ul aria-hidden="true" className="flex basis-full flex-wrap gap-1.5 pointer-coarse:hidden">
                        {module.lessons.map((lesson) => (
                          <li key={lesson.id}>
                            <span
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData(lessonDragType, lesson.id);
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              // Drag canceled (Esc, dropped outside): the mark goes away.
                              onDragEnd={() => setDragOverModuleId(null)}
                              title={t("creatorEditor.builder.curriculum.dragLessonHint")}
                              className="inline-flex cursor-grab rounded-md border border-[var(--color-line)] bg-white px-2 py-1 text-xs text-[var(--color-ink-soft)]"
                            >
                              {lesson.title || t("creatorEditor.builder.curriculum.untitledLesson")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                );
              })}
            </div>
            {/* Lesson release used to live on the price tab, with "Interval
                days" next to the currency. It is lesson rhythm, not billing: it stays
                here, below the module list, with a simple label. */}
            <section
              id="builder-sec-release"
              aria-labelledby="builder-release-title"
              className="mt-6 grid gap-3 border-t border-[var(--color-line)] pt-5"
            >
              <h4 id="builder-release-title" className="text-sm font-semibold text-[var(--color-ink)]">
                {t("creatorEditor.builder.release.title")}
              </h4>
              <div className="flex flex-wrap items-end gap-4">
                <label className="grid min-w-0 flex-1 basis-60 gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t("creatorEditor.builder.release.strategy")}
                  <select
                    value={dripStrategy}
                    onChange={(event) =>
                      setDripStrategy(event.target.value as DripStrategy)
                    }
                    disabled={!isEditable}
                    className="field-input disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {dripStrategies.map((item) => (
                      <option key={item.value} value={item.value}>
                        {t(item.label)}
                      </option>
                    ))}
                  </select>
                </label>
                {dripStrategy === "time_drip_lesson" || dripStrategy === "time_drip_module" ? (
                  // "Release lessons every [1] days": with the default 1 the sentence came out
                  // wrong. A field label does not depend on the number.
                  <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                    {t("creatorEditor.builder.release.interval")}
                    <input
                      value={dripIntervalDays}
                      onChange={(event) => setDripIntervalDays(event.target.value)}
                      disabled={!isEditable}
                      inputMode="numeric"
                      className="field-input w-20! text-center disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                ) : null}
              </div>
              <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                {t(dripStrategies.find((item) => item.value === dripStrategy)?.detail ?? "")}
                {dripStrategy === "time_drip_custom"
                  ? t("creatorEditor.builder.release.customHelp")
                  : ""}
              </p>
            </section>
            </>
            )}
          </div>
        </div>
        ) : null}

        {activeTab === "review" ? (
          <div
            id="builder-sec-review"
            className={`${panelIn} mt-6 scroll-mt-24 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-5`}
          >
            {/* The panel title already says "Publish to the marketplace.": a
                second 30 px title right below repeated the same thing. */}
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {t("creatorEditor.builder.publish.title")}
              <InlineHelp
                topic={t("creatorEditor.builder.publish.helpTopic")}
                href="/help#course-publishing"
              >
                {t("creatorEditor.builder.publish.help")}
              </InlineHelp>
            </p>
            <ReadinessGroups
              readiness={readiness}
              className="mt-5 grid gap-6"
              renderItem={(item) => (
                <ChecklistRow key={item.id} id={item.id} done={item.done} ready={readinessLoaded}>
                  {(justDone) => (<>
                  {/* Pending was gold text and done was a typed "✓": the
                      brass marked a problem. Done = green check (6.51:1) with
                      "Done" for the screen reader; pending = empty circle. */}
                  <p className={`flex items-center gap-2 text-sm font-semibold ${item.done ? "text-[var(--color-success-fg)]" : "text-[var(--color-ink)]"}`}>
                    {item.done ? (
                      <>
                        <DrawnCheck size={15} animate={justDone} />
                        <span className="sr-only">{t("creatorEditor.lesson.state.done")}: </span>
                      </>
                    ) : (
                      <Circle aria-hidden="true" size={13} strokeWidth={1.8} className="shrink-0 text-[var(--color-ink-muted)]" />
                    )}
                    {item.label}
                    {item.optional ? (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                        {t("creatorEditor.builder.publish.optional")}
                      </span>
                    ) : null}
                  </p>
                  {item.done ? null : (
                    <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                      {item.hint}
                      {/* Same destination as Manage: without it the person read "finish
                          the setup" and had nowhere to click. */}
                      {item.id === "plan" ? (
                        <Link href={planLink.href} className="ml-1 font-semibold text-[var(--color-primary)] underline">
                          {planLink.label}
                        </Link>
                      ) : item.id === "payouts" ? (
                        <>
                          {" "}
                          <Link
                            href={payoutsHref}
                            className="font-semibold text-[var(--color-primary)] underline"
                          >
                            {t("creatorPanel.hub.pricing.finishOnboarding")}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  )}
                  {(() => {
                    const fix = item.done ? null : readinessFix(item.id);
                    return fix ? (
                      // Several "Fix in Details" in the list: the item's name goes
                      // along for the screen reader.
                      <button
                        type="button"
                        onClick={fix.go}
                        aria-label={`${fix.label}: ${item.label}`}
                        className="mt-1 inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary)] underline"
                      >
                        {fix.label}
                      </button>
                    ) : null;
                  })()}
                  </>)}
                </ChecklistRow>
              )}
            />
            <p className="mt-5 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.publish.checksHelp")}
            </p>
          </div>
        ) : null}

        {/* Publish tab: the Publish refusal appears right above the button. */}
        {errorSlot === "publish" && activeTab === "review" && builderErrorAlert ? (
          <div className="mt-6">{builderErrorAlert}</div>
        ) : null}

        {activeTab === "review" ? publishedPanel : null}

        {/* On the lesson page the exit is its "Back to module": the builder's Back/Continue
            stacked a third action bar. */}
        {isLessonPage ? null : (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-6">
          <button
            type="button"
            onClick={() => {
              const previousTab = builderTabs[selectedTabIndex - 1];
              if (previousTab) {
                selectTab(previousTab.value);
              }
            }}
            disabled={selectedTabIndex <= 0}
            className="button-outline button-lg w-full sm:w-auto"
          >
            <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
            {selectedTabIndex > 0
              ? builderTabs[selectedTabIndex - 1].value === "members"
                ? t("creatorEditor.members.backTo")
                : t("creatorEditor.builder.navigation.backTo").replace("{step}", () => t(builderTabs[selectedTabIndex - 1].label))
              : t("creatorEditor.builder.navigation.back")}
          </button>
          {selectedTabIndex < builderTabs.length - 1 ? (
            <button
              type="button"
              onClick={() => {
                const nextTab = builderTabs[selectedTabIndex + 1];
                if (nextTab) {
                  selectTab(nextTab.value);
                }
              }}
              className="button-solid button-lg w-full sm:w-auto"
            >
              {builderTabs[selectedTabIndex + 1].value === "members"
                ? t("creatorEditor.members.continueTo")
                : t("creatorEditor.builder.navigation.continueTo").replace("{step}", () => t(builderTabs[selectedTabIndex + 1].label))}
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
            </button>
          ) : (
            // The Publish tab ended in text; the publish button stayed in the
            // footer card, which on the phone comes after the whole summary.
            <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
              {showPublishReason ? (
                <span id="builder-publish-reason" className="text-xs font-semibold text-[var(--color-ink-soft)]">
                  {t(publishReasonKey ?? "creatorEditor.builder.publish.finish")}
                </span>
              ) : null}
              {success === "published" ? null : publishButton}
            </div>
          )}
        </div>
        )}
      </section>

      {/* The footer only leads outward and to the library. Readiness and the
          pending items live on the Publish tab (with each one's "Go to..."), the
          "Save draft" at the top and the "Publish product" on the Publish tab: here they
          repeated everything below every tab. */}
      <div className="course-builder-footer">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-4">
          <Link
            href="/teach"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)]"
          >
            <ArrowLeft aria-hidden="true" size={14} strokeWidth={2} />
            {t("creatorEditor.builder.navigation.studio")}
          </Link>
          {/* The whole library (cover upload + file list) used to come
              open below every tab and alone accounted for a good part of the
              3,138 px of the content tab. Now it is one click for whoever needs it. */}
          {course ? (
            <button
              type="button"
              onClick={() => setIsMediaLibraryOpen((current) => !current)}
              className="button-outline inline-flex w-fit items-center gap-2 px-4 py-2.5 text-sm"
            >
              <ImageIcon aria-hidden="true" size={14} strokeWidth={1.9} />
              {t(isMediaLibraryOpen
                ? "creatorEditor.builder.curriculum.closeMediaLibrary"
                : "creatorEditor.builder.curriculum.openMediaLibrary")}
            </button>
          ) : null}
        </div>
        {course && isMediaLibraryOpen ? (
          <div className="grid gap-3">
            {errorSlot === "media" ? builderErrorAlert : null}
            <CourseAssetUploader
              course={course}
              isEditable={isEditable}
              onModuleCoverUploaded={(moduleId, assetId) => updateModuleCover(moduleId, assetId, "media")}
              onAssetDeleted={() => refreshCourseAssets("media")}
            />
          </div>
        ) : null}
      </div>
      <CreatedStrip
        // Live event: waits for the sessions to arrive, otherwise the strip would say
        // "schedule your session" to someone who already did and would change the sentence in front of the
        // screen reader. If the read fails, the strip does not appear.
        message={
          createdStripOpen && course && (productFormat !== "live_event" || courseSessions !== null)
            ? t(`creatorEditor.builder.created.${
                productFormat === "live_event" && courseSessions?.length ? "live_eventScheduled" : productFormat
              }`)
            : null
        }
        // The course is born with "Module 1, Lesson 1": the strip opens that lesson.
        action={productFormat === "course" && starterLesson && savedLessonIds.has(starterLesson.id) ? {
          label: t("creatorEditor.builder.created.openLesson"),
          onClick: () => {
            closeCreatedStrip();
            router.push(builderLessonHref(modules[0].id, starterLesson.id), { scroll: false });
          },
        } : undefined}
        onClose={closeCreatedStrip}
      />
      {confirmDialog}
    </div>
  );
}

/**
 * Row of the publish checklist (motion catalog, item 5). What becomes
 * ready WITH the tab open lights up in light brass once and the check draws itself;
 * what was already ready when the tab opened does not blink, otherwise opening the tab
 * would become a party. The "ready" snapshot is only taken with `ready` (the reads of
 * payouts, verification, files and sessions are back).
 */
function ChecklistRow({
  id,
  done,
  ready,
  children,
}: {
  id: string;
  done: boolean;
  ready: boolean;
  children: (justDone: boolean) => ReactNode;
}) {
  const justDone = useJustDone(done ? [id] : [], ready).has(id);
  return (
    <li
      className={`rounded-md border border-[var(--color-line)] bg-white px-4 py-3 ${justDone ? "is-just-done" : ""}`}
    >
      {children(justDone)}
    </li>
  );
}

/**
 * The strip "Draft saved. Next: ..." (motion catalog, item 7).
 * - The `role="status"` region stays always mounted and only the content enters, one
 *   tick later: NVDA and JAWS do not announce a live region that is born
 *   already filled.
 * - It goes away in 4s, but the clock stops while the pointer or focus is on it
 *   (without that, focus on the X fell on <body> when the strip disappeared).
 * - `absolute` with no size: empty, it takes no row or gap in the builder
 *   grid. Not `fixed`: fixed creates a stacking context and would trap
 *   the strip's z-index 60 inside it.
 */
function CreatedStrip({
  message,
  action,
  onClose,
}: {
  message: string | null;
  // The next-step shortcut. With it the strip does not go away on its own: it leaves on the X or
  // on the shortcut (disappearing in 4s left the button out of reach).
  action?: { label: string; onClick: () => void };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(false);
  const sticky = Boolean(action);
  // The two clocks leave together: the tick that puts the text in the already
  // mounted region and the 4s until it disappears (which does not run while `held`).
  // Releasing the strip restarts the 4s.
  useEffect(() => {
    if (!message) {
      return;
    }
    const tick = window.setTimeout(() => setShown(true), 0);
    const timer = held || sticky ? undefined : window.setTimeout(onClose, 4000);
    return () => {
      window.clearTimeout(tick);
      window.clearTimeout(timer);
    };
  }, [message, held, sticky, onClose]);

  return (
    <div role="status" className="absolute">
      {message && shown ? (
        <div
          className="created-strip"
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setHeld(false);
            }
          }}
        >
          <MilestoneSeal animate />
          <div className="grid min-w-0 flex-1 justify-items-start gap-2">
            <p className="text-sm font-semibold leading-5">{message}</p>
            {action ? (
              <Button variant="accent" size="sm" className="min-h-11" onClick={action.onClick}>
                {action.label}
              </Button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("creatorEditor.builder.created.close")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-white/80 transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)] hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The "Published!" panel (motion catalog, item 8), in place of the gray paragraph
 * like "Draft saved.". The badge stamps, the engraving lights up and the brass
 * "Copy my page link" button receives focus. One party per product: publishing
 * the same course again shows the panel still.
 */
function PublishedPanel({
  courseId,
  courseTitle,
  headingRef,
}: {
  courseId: string;
  courseTitle: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const storageKey = `skillsetmind.publishedCelebrated.${courseId}`;
  // Only reads in the initializer; the effect is what writes. In StrictMode the
  // initializer runs twice before any effect, so the two
  // reads agree.
  const [celebrate] = useState(() => {
    try {
      return !window.localStorage.getItem(storageKey);
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Sem armazenamento (cota zero): a festa so se repete.
    }
  }, [storageKey]);

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-celebrating={celebrate ? "" : undefined}
      className={`published-panel mt-4 ${celebrate ? "is-celebrating" : ""}`}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <SpotArt scene="published" />
        <div className="min-w-0">
          <h4
            ref={headingRef}
            id={`${id}-title`}
            tabIndex={-1}
            className="text-lg font-semibold leading-snug text-[var(--color-primary)]"
          >
            {t("creatorEditor.builder.publishedPanel.title")}
          </h4>
          <p id={`${id}-detail`} className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.publishedPanel.detail")}
          </p>
        </div>
      </div>
      <CourseShareLink
        label={t("creatorPanel.hub.sections.page")}
        path={`/courses/${encodeURIComponent(courseId)}`}
        title={courseTitle}
        copyLabel={t("creatorPanel.shareLink.copyMyPage")}
        copyDescribedBy={`${id}-title ${id}-detail`}
        accent
        focusCopy
      />
    </section>
  );
}

/**
 * WHAT, exactly, is blocking the autosave — or `null` when nothing is.
 *
 * Before this was just a boolean (`canAutosaveDraft`), and so the worst failure
 * mode of this editor was silent: with a malformed price (or an invalid
 * installments limit, or a module with no lesson) the autosave simply stopped, and the
 * only sign on screen was the same gray "Unsaved changes" badge that also
 * appears during the normal 1.8s debounce. The teacher kept building
 * modules and lessons thinking everything was saved — and lost it all on reload.
 *
 * `canAutosaveDraft` now DERIVES from here, not the other way around: that way a
 * new gate does not come in without bringing the text that tells the teacher what to fix.
 */
type AutosaveBlockedReason = "price" | "installments" | "structure";

export function getAutosaveBlockedReason(input: {
  isEditable: boolean;
  priceFieldIsValid: boolean;
  installmentsAreValid: boolean;
  draftStructureError: boolean;
}): AutosaveBlockedReason | null {
  if (!input.isEditable) {
    // A course that is not editable has no draft to lose — there is no block to
    // announce, and alarming here would be noise.
    return null;
  }
  if (!input.priceFieldIsValid) {
    return "price";
  }
  if (!input.installmentsAreValid) {
    return "installments";
  }
  if (input.draftStructureError) {
    return "structure";
  }
  return null;
}

// The two failure chips of the save ("Not saving", "Save failed"): the background is the
// error token, not the hand-written 6% red, which in the dark theme vanished
// on the card (F-07).
const dangerChipClass =
  "inline-flex items-center gap-1.5 rounded-chip border border-[rgba(178,34,52,0.22)] bg-[var(--color-danger-soft)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-danger-fg)]";

function BuilderSaveStatus({
  state,
  blockedReason,
  justSaved = false,
}: {
  state: "pending" | "saving" | "saved" | "error" | "blocked";
  blockedReason?: AutosaveBlockedReason | null;
  /** A write just came back: the chip enters and the green lights up for 1.5s. */
  justSaved?: boolean;
}) {
  const { t } = useTranslation();
  // Autosave stopped by an invalid field. It must look different from the neutral
  // "Unsaved changes" — this state does not pass on its own, and continuing to
  // type only increases what will be lost.
  if (state === "blocked") {
    return (
      <span
        role="status"
        className={dangerChipClass}
      >
        <CloudOff aria-hidden="true" size={12} strokeWidth={2} />
        {t("creatorEditor.builder.save.blocked").replace("{reason}", () =>
          t(`creatorEditor.builder.save.reasons.${blockedReason ?? "field"}`),
        )}
      </span>
    );
  }

  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-chip border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
        <Loader2
          aria-hidden="true"
          size={12}
          strokeWidth={2.2}
          className="motion-safe:animate-spin"
        />
        {t("creatorEditor.builder.save.saving")}
      </span>
    );
  }

  if (state === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-chip border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
        <span className="size-1.5 rounded-full bg-[var(--color-ink-muted)]" />
        {t("creatorEditor.builder.save.pending")}
      </span>
    );
  }

  if (state === "error") {
    // Announced like the "Not saving": before, an autosave failure showed up at
    // the top without the screen reader saying anything.
    return (
      <span role="status" className={dangerChipClass}>
        <CloudOff aria-hidden="true" size={12} strokeWidth={2} />
        {t("creatorEditor.builder.save.error")}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-chip border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-primary)] ${justSaved ? "builder-save-status--saved motion-rise-in" : ""}`}>
      <CheckCircle2 aria-hidden="true" size={12} strokeWidth={2} />
      {t("creatorEditor.builder.save.saved")}
    </span>
  );
}

// Course cover lives where the builder stepper's "Course cover" stage points
// (the Details tab) with a live preview, instead of being buried as one of six
// presets in the generic upload panel. Reuses the proven uploadCourseAsset path,
// which writes course.coverImageUrl server-side and echoes back via the course
// onSnapshot — so the preview and the stepper's "cover" stage refresh on their own.
function CourseCoverField({
  course,
  isEditable,
  onUploaded,
}: {
  course: TeacherCourse;
  isEditable: boolean;
  /** The preview comes from course.coverImageUrl: the caller fetches the course again. */
  onUploaded?: () => void;
}) {
  const { t } = useTranslation();
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<UploadCourseAssetProgress | null>(null);
  const [error, setError] = useState<
    { kind: "invalid-image" } | { kind: "upload"; cause: unknown } | null
  >(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file || !isEditable) {
      return;
    }

    setError(null);
    setProgress(null);

    if (!isAllowedCourseAssetFile(file, "course_cover")) {
      setError({ kind: "invalid-image" });
      setFileInputKey((current) => current + 1);
      return;
    }

    setIsUploading(true);

    try {
      await uploadCourseAsset({
        courseId: course.id,
        ownerId: course.ownerId,
        kind: "course_cover",
        file,
        isPreview: false,
        onProgress: setProgress,
      });
      onUploaded?.();
    } catch (uploadError) {
      // The real reason (size cap, permission, connection) already comes ready from the
      // domain; the generic text told people to check "course ownership".
      setError({ kind: "upload", cause: uploadError });
    } finally {
      setIsUploading(false);
      setProgress(null);
      setFileInputKey((current) => current + 1);
    }
  }

  return (
    <ImageUploadField
      className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
      title={t("courseMedia.assetKinds.course_cover")}
      help={t("creatorEditor.builder.cover.help").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))}
      preview={{
        src: course.coverImageUrl,
        alt: t("creatorEditor.builder.cover.alt").replace("{title}", () => course.title || t("creatorEditor.builder.cover.course")),
        emptyLabel: t("creatorEditor.members.noCover"),
      }}
      triggerLabel={course.coverImageUrl ? t("creatorEditor.members.replaceCover") : t("creatorEditor.members.uploadCover")}
      input={{
        resetKey: fileInputKey,
        accept: courseAssetAcceptTypes.course_cover,
        disabled: !isEditable || isUploading,
        onChange: handleFile,
      }}
      progress={progress}
      error={
        error === null
          ? undefined
          : error.kind === "invalid-image"
            ? t("creatorEditor.members.invalidImage").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))
            : getCourseAssetUploadErrorMessage(error.cause, supabaseUploadLimitBytes, t)
      }
      note={course.coverImageUrl ? undefined : t("creatorEditor.builder.cover.emptyHelp")}
    />
  );
}

// Per-course "Members Area" customization tab. Hosts the theme/cover/title/
// subtitle/description controls plus a LIVE mini-preview that reuses the same
// MembersAreaHero the enrolled student sees, fed from in-tab state so it
// updates as the teacher types/switches theme/uploads. Studio name + cover are
// REAL values only (the owner's own display name and an uploaded CourseAsset);
// no progress bar in the builder since there is no real enrollment to measure.
function MembersAreaTab({
  courseId,
  course,
  isEditable,
  theme,
  onThemeChange,
  coverAssetId,
  onCoverAssetIdChange,
  title,
  onTitleChange,
  subtitle,
  onSubtitleChange,
  description,
  onDescriptionChange,
}: {
  courseId: string;
  course: TeacherCourse;
  isEditable: boolean;
  theme: MembersTheme;
  onThemeChange: (theme: MembersTheme) => void;
  coverAssetId: string | null;
  onCoverAssetIdChange: (assetId: string | null) => void;
  title: string;
  onTitleChange: (value: string) => void;
  subtitle: string;
  onSubtitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<CourseAsset[]>([]);
  const previewFrame = useRef<HTMLDivElement>(null);
  const previewStage = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 340, height: 0 });

  useEffect(() => {
    const frame = previewFrame.current;
    const stage = previewStage.current;
    if (!frame || !stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setPreviewSize((current) => {
        let { width, height } = current;
        for (const entry of entries) {
          if (entry.target === frame) width = entry.contentRect.width;
          // ResizeObserver reports layout height before the CSS transform.
          // The hero changes height at breakpoints even at the same frame width.
          if (entry.target === stage) height = entry.contentRect.height;
        }
        return width === current.width && height === current.height
          ? current
          : { width, height };
      });
    });
    observer.observe(frame);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // course_assets is not in the Realtime publication: after the upload the
  // preview fetches the list again, otherwise the new cover only appeared on reload.
  const assetsReloadRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    const subscription = subscribeToCourseAssets(course.id, setAssets, () => undefined);
    assetsReloadRef.current = subscription.reload;
    return () => {
      assetsReloadRef.current = null;
      subscription();
    };
  }, [course.id]);

  // members_cover is a public-download kind, so the resolved asset carries the
  // URL the hero renders directly — no protected blob fetch needed.
  const coverUrl =
    (coverAssetId
      ? assets.find((asset) => asset.id === coverAssetId)?.downloadUrl
      : null) ?? null;
  // Mirror the student hero's own fallback so the preview matches reality:
  // empty title -> the real course title. The subtitle line shows only what the
  // teacher types here (the student view carries no separate studio name).
  const previewTitle = title.trim() || course.title || t("creatorEditor.members.untitled");

  return (
    <div
      id="builder-sec-members"
      className="mt-6 grid scroll-mt-24 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-start"
    >
      <div className="grid gap-4">
        <div className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          {t("creatorEditor.members.theme")}
          <p className="text-xs font-normal leading-5 text-[var(--color-ink-soft)]">
            {t("creatorEditor.members.themeHelp")}
          </p>
          <div className="inline-flex w-fit gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1">
            {(
              [
                { value: "light", label: t("creatorEditor.members.light"), icon: Sun },
                { value: "dark", label: t("creatorEditor.members.dark"), icon: Moon },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              const active = theme === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={!isEditable}
                  aria-pressed={active}
                  onClick={() => onThemeChange(option.value)}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2 text-sm font-semibold transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)] disabled:opacity-60 ${
                    active
                      ? "bg-white text-[var(--color-primary)] shadow-[var(--shadow-soft)]"
                      : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <MembersCoverField
          course={course}
          isEditable={isEditable}
          coverUrl={coverUrl}
          onUploaded={(assetId) => {
            onCoverAssetIdChange(assetId);
            void assetsReloadRef.current?.();
          }}
          onRemove={() => onCoverAssetIdChange(null)}
        />

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          {t("creatorEditor.members.title")}
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            disabled={!isEditable}
            maxLength={80}
            placeholder={course.title || t("creatorEditor.members.titlePlaceholder")}
            className="field-input disabled:cursor-not-allowed disabled:opacity-60"
          />
          <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
            {t("creatorEditor.members.titleHelp").replace("{length}", () => String(title.length))}
          </span>
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          {t("creatorEditor.members.subtitle")}
          <input
            value={subtitle}
            onChange={(event) => onSubtitleChange(event.target.value)}
            disabled={!isEditable}
            maxLength={160}
            placeholder={t("creatorEditor.members.subtitlePlaceholder")}
            className="field-input disabled:cursor-not-allowed disabled:opacity-60"
          />
          <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
            {t("creatorEditor.members.subtitleHelp").replace("{length}", () => String(subtitle.length))}
          </span>
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          {t("creatorEditor.members.description")}
          <textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            disabled={!isEditable}
            maxLength={2000}
            rows={4}
            placeholder={t("creatorEditor.members.descriptionPlaceholder")}
            className="field-input resize-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
            {description.length}/2000
          </span>
        </label>
      </div>

      <div className="grid gap-3 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 lg:sticky lg:top-24">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {t("creatorEditor.members.livePreview")}
        </p>
        <div
          ref={previewFrame}
          data-members-theme={theme}
          aria-hidden="true"
          inert
          style={{
            width: "100%",
            height: previewSize.height * previewSize.width / 1080,
            overflow: "hidden",
            borderRadius: 8,
            background: "var(--ma-bg)",
            pointerEvents: "none",
          }}
        >
          <div
            ref={previewStage}
            style={{
              width: 1080,
              transform: `scale(${previewSize.width / 1080})`,
              transformOrigin: "top left",
            }}
          >
            <MembersAreaHero
              theme={theme}
              coverUrl={coverUrl}
              title={previewTitle}
              subtitle={subtitle.trim() || null}
              description={description.trim() || null}
              progressPercent={null}
              backHref={null}
            />
          </div>
        </div>
        {/* rel="opener": the same reason as the top "Preview". */}
        <Link
          href={`/teach/builder/${courseId}/preview`}
          target="_blank"
          rel="opener"
          className="button-outline inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm"
        >
          {t("creatorEditor.members.openPreview")}
          <span className="sr-only"> {t("account.opensNewTab")}</span>
        </Link>
        <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
          {t("creatorEditor.members.previewHelp")}
        </p>
      </div>
    </div>
  );
}

// Single-cover uploader for the members hero — same proven uploadCourseAsset
// path as CourseCoverField, but bound to membersCoverAssetId (the upload
// returns the new asset id, which we hand back to the builder state) instead of
// the course's public coverImageUrl.
function MembersCoverField({
  course,
  moduleId,
  isEditable,
  coverUrl,
  onUploaded,
  onRemove,
}: {
  course: TeacherCourse;
  moduleId?: string;
  isEditable: boolean;
  coverUrl: string | null;
  onUploaded: (assetId: string) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const kind = moduleId ? "module_cover" : "members_cover";
  const title = moduleId ? t("courseMedia.assetKinds.module_cover") : t("creatorEditor.members.cover");
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<UploadCourseAssetProgress | null>(null);
  const [error, setError] = useState<
    { kind: "invalid-image" } | { kind: "too-large" } | { kind: "upload"; cause: unknown } | null
  >(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file || !isEditable || isUploading) {
      return;
    }

    setError(null);
    setProgress(null);

    // Module cover: source photo up to 10 MB, refused right away (before
    // opening the image). Refusals stay synchronous, as they were.
    if (moduleId && file.size > MAX_SOURCE_IMAGE_BYTES) {
      setError({ kind: "too-large" });
      setFileInputKey((current) => current + 1);
      return;
    }

    if (!isAllowedCourseAssetFile(file, kind)) {
      setError({ kind: "invalid-image" });
      setFileInputKey((current) => current + 1);
      return;
    }

    setIsUploading(true);
    // The module cover compression comes before the upload and the label no longer says
    // "Uploading...": the upload note already appears on click, without a percentage.
    setProgress({ bytesTransferred: 0, totalBytes: file.size, percent: null, state: "running" });

    try {
      // Module cover: 2:3 vertical crop compressed in the browser (10 MB
      // go in, about 300 KB come out). If it cannot be compressed, the original goes up.
      // The members area cover goes up as it came.
      const upload = moduleId ? await compressImage(file).catch(() => file) : file;
      const assetId = await uploadCourseAsset({
        courseId: course.id,
        ownerId: course.ownerId,
        kind,
        moduleId,
        file: upload,
        isPreview: false,
        onProgress: setProgress,
      });
      onUploaded(assetId);
    } catch (uploadError) {
      setError({ kind: "upload", cause: uploadError });
    } finally {
      setIsUploading(false);
      setProgress(null);
      setFileInputKey((current) => current + 1);
    }
  }

  return (
    <ImageUploadField
      // On the module page the cover lives in a column, without a frame of its own.
      className={moduleId ? undefined : "rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"}
      title={title}
      help={t(moduleId ? "creatorEditor.assets.presets.module" : "creatorEditor.members.coverHelp").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))}
      preview={{
        src: coverUrl,
        alt: moduleId ? title : t("creatorEditor.members.coverAlt").replace("{courseTitle}", () => course.title || t("publicCourses.course")),
        portrait: Boolean(moduleId),
        emptyLabel: t("creatorEditor.members.noCover"),
      }}
      triggerLabel={coverUrl ? t("creatorEditor.members.replaceCover") : t("creatorEditor.members.uploadCover")}
      input={{
        resetKey: fileInputKey,
        accept: courseAssetAcceptTypes[kind],
        "aria-label": moduleId ? t("courseMedia.assetKinds.module_cover") : undefined,
        disabled: !isEditable || isUploading,
        onChange: handleFile,
      }}
      remove={onRemove && isEditable ? { label: t("creatorEditor.members.removeCover"), onClick: onRemove } : undefined}
      progress={progress}
      error={
        error === null
          ? undefined
          : error.kind === "too-large"
            ? t("creatorEditor.members.coverTooLarge")
            : error.kind === "invalid-image"
              ? t("creatorEditor.members.invalidImage").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))
              : getCourseAssetUploadErrorMessage(error.cause, supabaseUploadLimitBytes, t)
      }
    />
  );
}
