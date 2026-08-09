"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CloudOff,
  CreditCard,
  ExternalLink,
  Film,
  Gift,
  Image as ImageIcon,
  Loader2,
  Moon,
  Plus,
  Repeat,
  Sun,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PlanSelectorCards,
  type PlanSelectorOption,
} from "@/components/shared/plan-selector-cards";
import { InlineHelp } from "@/components/shared/inline-help";
import { StatusChip } from "@/components/shared/status-chip";
import { MembersAreaHero } from "@/components/learn/members-area-hero";
import { CourseAssetUploader } from "@/components/teacher/course-asset-uploader";
import { CourseCategorySelect } from "@/components/teacher/course-category-select";
import { LessonContentModal } from "@/components/teacher/lesson-content-modal";
import type { DripStrategy } from "@/domain/drip-policy";
import { DEFAULT_PLATFORM_FEE_BPS } from "@/lib/payments/rules";
import type {
  LessonType,
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
  skillsetCourseCategories,
  teacherCanEditCourse,
  teacherCanPublishCourse,
} from "@/domain/teacher-course";
import {
  subscribeToTeacherCourse,
  publishTeacherCourse,
  updateTeacherCourseBuilder,
} from "@/lib/data/teacher-courses";
import {
  courseAssetAcceptTypes,
  courseAssetMaxBytes,
  formatCourseAssetSize,
  isAllowedCourseAssetFile,
} from "@/domain/course-asset";
import {
  fetchCourseAssets,
  subscribeToCourseAssets,
  uploadCourseAsset,
  type UploadCourseAssetProgress,
} from "@/lib/data/course-assets";
import type { CourseAsset } from "@/domain/course-asset";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import { isPublicFeatureEnabled } from "@/lib/feature-flags";
import {
  defaultSkillsetCurrency,
  getCurrencyLabel,
  supportedStripeCurrencies,
  topSkillsetCurrencies,
} from "@/lib/payments/currencies";

const secondaryCurrencies = supportedStripeCurrencies.filter(
  (currency) => !(topSkillsetCurrencies as readonly string[]).includes(currency),
);
const builderTabs = [
  { value: "details", label: "Details", sub: "Title, categories, promise" },
  { value: "pricing", label: "Pricing", sub: "Payment, drip, preview" },
  { value: "content", label: "Curriculum", sub: "Modules, lessons, uploads" },
  { value: "members", label: "Members Area", sub: "Theme, cover, title" },
  { value: "review", label: "Publish", sub: "Readiness and launch" },
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
  { id: "basics", label: "Course basics", sub: "Info, cover, promise", target: "details", anchor: "builder-sec-cover" },
  { id: "pricing", label: "Pricing", sub: "Access model", target: "pricing", anchor: "builder-sec-pricing" },
  { id: "content", label: "Curriculum", sub: "Modules and lessons", target: "content", anchor: "builder-sec-modules" },
  { id: "members", label: "Members area", sub: "Learner experience", target: "members", anchor: "builder-sec-members" },
  { id: "publish", label: "Publish", sub: "Final checks", target: "review", anchor: "builder-sec-review" },
];
type ActiveLessonStudio = {
  moduleId: string;
  lessonId: string;
} | null;

const lessonTypes: { value: LessonType; label: string }[] = [
  { value: "video", label: "Video lesson" },
  { value: "text", label: "Text lesson" },
  // Quiz/assignment authoring is hidden until a real assessment engine exists
  // (no question/submission/grading model). See
  // docs/plans/2026-06-23-launch-readiness.md (B8).
  { value: "live_recording", label: "Live recording" },
  { value: "download", label: "Download" },
  { value: "external_embed", label: "External embed" },
];

const dripStrategies: { value: DripStrategy; label: string; detail: string }[] = [
  {
    value: "instant",
    label: "Instant access",
    detail: "Every lesson is available immediately after enrollment.",
  },
  {
    value: "sequential_progress",
    label: "Sequential progress",
    detail: "The next lesson opens after the previous lesson is completed.",
  },
  {
    value: "time_drip_lesson",
    label: "One lesson per interval",
    detail: "Release lessons gradually based on enrollment date.",
  },
  {
    value: "time_drip_module",
    label: "One module per interval",
    detail: "Release modules gradually based on enrollment date.",
  },
  {
    value: "time_drip_custom",
    label: "Custom lesson schedule",
    detail: "Use each lesson's delay field for precise release timing.",
  },
];

const paymentModelOptions: PlanSelectorOption<TeacherCoursePaymentType>[] = [
  {
    value: "one_time",
    title: "One-time payment",
    description: "Learners pay once and get lifetime access.",
    features: ["Best for complete courses", "Lifetime access for learners"],
    icon: CreditCard,
  },
  {
    value: "free",
    title: "Free",
    description: "No payment required. Useful for lead-gen or trial cohorts.",
    features: ["Opens enrollment without checkout", "Useful for previews or pilots"],
    icon: Gift,
  },
  {
    value: "subscription_monthly",
    title: "Monthly subscription",
    description: "Recurring monthly billing.",
    features: ["Recurring access", "Cancellation controls"],
    icon: Repeat,
  },
  {
    value: "subscription_yearly",
    title: "Yearly subscription",
    description: "Recurring yearly billing.",
    features: ["Annual access", "Renewal reminders"],
    icon: CalendarClock,
  },
];

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

function normalizeDurationMinutes(value: string): number | null {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.round(parsedValue);
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

function getLessonTypeLabel(type: LessonType) {
  return lessonTypes.find((item) => item.value === type)?.label ?? type;
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

function getCourseStructureError(modules: TeacherCourseModule[]): string {
  for (const [moduleIndex, module] of modules.entries()) {
    if (!module.title.trim()) {
      return `Module ${moduleIndex + 1} needs a title before saving.`;
    }

    for (const [lessonIndex, lesson] of module.lessons.entries()) {
      if (!lesson.title.trim()) {
        return `Lesson ${lessonIndex + 1} in module ${moduleIndex + 1} needs a title before saving.`;
      }
    }
  }

  return "";
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
      paymentType:
        course.paymentType ??
        (course.priceAmountMinor === 0 ? "free" : "one_time"),
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const courseId = searchParams.get("courseId");
  const requestedTab = searchParams.get("tab");
  const activeTab: BuilderTab = isBuilderTab(requestedTab)
    ? requestedTab
    : "details";
  const selectTab = useCallback(
    (nextTab: BuilderTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", nextTab);
      router.push(`/teach/builder?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
  const { user } = useAuth();
  const [course, setCourse] = useState<TeacherCourse | null>(null);
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
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleSummary, setModuleSummary] = useState("");
  const [lessonModuleId, setLessonModuleId] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonType, setLessonType] = useState<LessonType>("video");
  const [lessonDescription, setLessonDescription] = useState("");
  const [lessonDurationMinutes, setLessonDurationMinutes] = useState("");
  const [lessonDripDelayDays, setLessonDripDelayDays] = useState("");
  const [lessonContentText, setLessonContentText] = useState("");
  const [lessonExternalUrl, setLessonExternalUrl] = useState("");
  const [lessonIsFreePreview, setLessonIsFreePreview] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeLessonStudio, setActiveLessonStudio] =
    useState<ActiveLessonStudio>(null);
  const [courseAssets, setCourseAssets] = useState<CourseAsset[]>([]);
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

  useEffect(() => {
    if (!courseId) {
      return;
    }

    return subscribeToTeacherCourse(
      courseId,
      (nextCourse) => {
        setIsLoading(false);

        if (!nextCourse) {
          setError("We could not find this course.");
          return;
        }

        setCourse(nextCourse);
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
          nextCourse.paymentType ??
            (nextCourse.priceAmountMinor === 0 ? "free" : "one_time"),
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
        setLessonModuleId(nextCourse.modules?.[0]?.id ?? "");
        setError("");
        // Baseline mirrors exactly what the state setters above produce, so a
        // fresh hydration (or our own write echoing back) is never seen as a
        // user edit. Async callback -> setState is allowed here.
        setSavedSignature(builderDraftSignatureFromCourse(nextCourse));

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
          setActiveLessonStudio(pendingStudio);
          setSuccess("");
        }
      },
      () => {
        setIsLoading(false);
        setError("We could not load this course. Please return to Teacher Studio and try again.");
      },
    );
  }, [courseId]);

  // One-shot (re)load instead of a realtime channel: the lesson studio modal
  // already owns the `course_assets:{id}` realtime topic while it is open, and
  // Phoenix allows one join per topic per socket — so the builder refreshes on
  // mount and whenever the studio closes (the only place lesson videos change).
  useEffect(() => {
    if (!courseId || activeLessonStudio) {
      return;
    }

    let cancelled = false;
    fetchCourseAssets(courseId)
      .then((nextAssets) => {
        if (!cancelled) {
          setCourseAssets(nextAssets);
        }
      })
      .catch(() => {
        // Non-critical: only the "Add video"/"Edit content" hint degrades.
      });

    return () => {
      cancelled = true;
    };
  }, [courseId, activeLessonStudio]);

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
  const isEditable = Boolean(isOwner && course && teacherCanEditCourse(course.status));
  const canPublish = Boolean(
    isOwner && course && teacherCanPublishCourse(course.status),
  );
  const cardInstallmentsConfigured = isPublicFeatureEnabled(
    "payments.cardInstallments",
  );
  const canConfigureCardInstallments =
    paymentType === "one_time"
    && currency === "MXN"
    && cardInstallmentsConfigured;
  const lessonCount = countCourseLessons(modules);
  const allLessons = modules.flatMap((module) =>
    module.lessons.map((lesson) => ({
      ...lesson,
      moduleTitle: module.title,
    })),
  );
  const parsedPriceAmountMinor = parsePriceAmountMinor(priceAmount);
  const priceFieldIsValid =
    paymentType === "free" || !hasInvalidPriceAmount(priceAmount);
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
  const readinessItems = [
    {
      label: title.trim() ? "Course title is set." : "Add a course title.",
      ready: Boolean(title.trim()),
    },
    {
      label:
        summary.trim().length >= 20
          ? "Summary is ready."
          : "Add a clearer summary.",
      ready: summary.trim().length >= 20,
    },
    {
      label:
        selectedCategories.length > 0
          ? "Marketplace category is set."
          : "Choose at least one marketplace category.",
      ready: selectedCategories.length > 0,
    },
    {
      label: modules.length > 0 ? "At least one module exists." : "Add at least one module.",
      ready: modules.length > 0,
    },
    {
      label: lessonCount > 0 ? "At least one lesson exists." : "Add at least one lesson.",
      ready: lessonCount > 0,
    },
    {
      label:
        pricingModelIsReady
          ? paymentType === "free"
            ? "Free enrollment model is ready."
            : "Paid price is ready."
          : "Set a paid price greater than $0, or choose Free.",
      ready: pricingModelIsReady && priceFieldIsValid,
    },
    {
      label:
        installmentsAreValid
          ? "Payment model is ready."
          : "Set a valid installment limit.",
      ready: installmentsAreValid,
    },
  ];
  const readyItemCount = readinessItems.filter((item) => item.ready).length;
  const readinessProgress = Math.round(
    (readyItemCount / readinessItems.length) * 100,
  );
  const nextReadinessItem = readinessItems.find((item) => !item.ready);
  const activeLessonStudioModule = activeLessonStudio
    ? modules.find((module) => module.id === activeLessonStudio.moduleId) ?? null
    : null;
  const activeLessonStudioLesson =
    activeLessonStudio && activeLessonStudioModule
      ? activeLessonStudioModule.lessons.find(
          (lesson) => lesson.id === activeLessonStudio.lessonId,
        ) ?? null
      : null;
  const activeLessonStudioModuleIndex = activeLessonStudioModule
    ? modules.findIndex((module) => module.id === activeLessonStudioModule.id)
    : -1;
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
  const priceIntervalSuffix =
    paymentType === "subscription_monthly"
      ? " / month"
      : paymentType === "subscription_yearly"
        ? " / year"
        : "";
  const formattedPrice =
    paymentType === "free"
      ? "Free"
      : parsedPriceAmountMinor
        ? `${new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: currency.toUpperCase(),
            maximumFractionDigits: 0,
          }).format(parsedPriceAmountMinor / 100)}${priceIntervalSuffix}`
        : "Set price";
  const tabCompletion: Record<BuilderTab, boolean> = {
    details: Boolean(
      title.trim()
      && summary.trim().length >= 20
      && selectedCategories.length > 0
    ),
    // Members-area customization is optional; the learner workspace falls back
    // to the course title, cover, and light theme.
    members: true,
    content: modules.length > 0 && lessonCount > 0,
    pricing:
      pricingModelIsReady &&
      priceFieldIsValid &&
      installmentsAreValid,
    review: readinessProgress === 100,
  };
  const stageCompletion: Record<string, boolean> = {
    basics: tabCompletion.details,
    pricing: tabCompletion.pricing,
    content: tabCompletion.content,
    members: tabCompletion.members,
    publish: tabCompletion.review,
  };
  const completedStageCount = builderStages.filter(
    (stage) => stageCompletion[stage.id],
  ).length;
  const builderStepProgress = Math.round(
    (completedStageCount / builderStages.length) * 100,
  );
  const activeStageId =
    builderStages.find((stage) => stage.target === activeTab)?.id ??
    builderStages[0].id;
  const totalDurationMinutes = allLessons.reduce(
    (sum, lesson) => sum + (lesson.durationMinutes ?? 0),
    0,
  );
  const formattedDuration =
    totalDurationMinutes >= 60
      ? `${Math.floor(totalDurationMinutes / 60)}h ${totalDurationMinutes % 60}m`
      : `${totalDurationMinutes}m`;

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
  const builderDraftSignature = useMemo(
    () => JSON.stringify(builderDraftPayload),
    [builderDraftPayload],
  );
  const draftStructureError = getCourseStructureError(
    builderDraftPayload.modules,
  );
  const canAutosaveDraft =
    isEditable
    && priceFieldIsValid
    && installmentsAreValid
    && !draftStructureError;
  const draftIsDirty =
    savedSignature !== null && builderDraftSignature !== savedSignature;
  const displayedSaveStatus: "pending" | "saving" | "saved" | "error" =
    autosaveState === "saving"
      ? "saving"
      : autosaveState === "error"
        ? "error"
        : draftIsDirty
          ? "pending"
          : "saved";

  function handlePaymentTypeChange(nextPaymentType: TeacherCoursePaymentType) {
    if (!isEditable) {
      return;
    }

    setPaymentType(nextPaymentType);

    if (nextPaymentType === "free") {
      setPriceAmount("0");
      setInstallmentsEnabled(false);
    }

    if (nextPaymentType !== "one_time") {
      setInstallmentsEnabled(false);
    }

    setSuccess("");
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
    setSuccess("");
  }

  function handleAddModule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable) {
      return;
    }

    const nextTitle = moduleTitle.trim();

    if (!nextTitle) {
      setError("Add a module title before creating the module.");
      return;
    }

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
    setError("");
    setSuccess("");
  }

  function handleAddLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable) {
      return;
    }

    if (!lessonModuleId) {
      setError("Create or choose a module before adding a lesson.");
      return;
    }

    const nextTitle = lessonTitle.trim();

    if (!nextTitle) {
      setError("Add a lesson title before creating the lesson.");
      return;
    }

    const durationMinutes = Number(lessonDurationMinutes);
    const nextLessonId = createLocalId("lesson");
    const nextDurationMinutes =
      lessonDurationMinutes.trim().length > 0 && Number.isFinite(durationMinutes) && durationMinutes > 0
        ? Math.round(durationMinutes)
        : null;
    const nextDripDelayDays = normalizeDripDelayDays(lessonDripDelayDays);

    setModules((current) =>
      current.map((module) =>
        module.id === lessonModuleId
          ? {
              ...module,
              lessons: [
                ...module.lessons,
                {
                  id: nextLessonId,
                  title: nextTitle,
                  type: lessonType,
                  description: lessonDescription.trim(),
                  durationMinutes: nextDurationMinutes,
                  dripDelayDays: nextDripDelayDays,
                  contentText: lessonContentText.trim() || null,
                  externalUrl: lessonExternalUrl.trim() || null,
                },
              ],
            }
          : module,
      ),
    );
    if (lessonIsFreePreview) {
      setFreePreviewLessonId(nextLessonId);
    }
    setLessonTitle("");
    setLessonDescription("");
    setLessonDurationMinutes("");
    setLessonDripDelayDays("");
    setLessonContentText("");
    setLessonExternalUrl("");
    setLessonIsFreePreview(false);
    setError("");
    // Video-first flow: the lesson studio (Video tab) opens automatically as
    // soon as autosave persists the lesson — no hunting for the studio button.
    pendingLessonStudioRef.current = {
      moduleId: lessonModuleId,
      lessonId: nextLessonId,
    };
    setSuccess("Lesson added — opening the lesson studio once it autosaves…");
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
    setSuccess("");
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
    setSuccess("");
  }

  function moveModule(moduleId: string, direction: "up" | "down") {
    if (!isEditable) {
      return;
    }

    setModules((currentModules) => {
      const currentIndex = currentModules.findIndex((module) => module.id === moduleId);
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      return moveArrayItem(currentModules, currentIndex, nextIndex);
    });
    setSuccess("");
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
    const confirmed = window.confirm(
      `Delete module "${target?.title || "Untitled module"}"${
        lessonCount > 0
          ? ` and its ${lessonCount} lesson${lessonCount === 1 ? "" : "s"}`
          : ""
      }? This cannot be undone after autosave.`,
    );

    if (!confirmed) {
      return;
    }

    setModules((currentModules) => {
      const deletedModule = currentModules.find((module) => module.id === moduleId);
      const nextModules = currentModules.filter((module) => module.id !== moduleId);

      if (lessonModuleId === moduleId) {
        setLessonModuleId(nextModules[0]?.id ?? "");
      }

      if (
        deletedModule?.lessons.some((lesson) => lesson.id === freePreviewLessonId)
      ) {
        setFreePreviewLessonId("");
      }

      return nextModules;
    });
    setSuccess("");
  }

  function updateLesson(
    moduleId: string,
    lessonId: string,
    patch: Partial<TeacherLesson>,
  ) {
    if (!isEditable) {
      return;
    }

    setModules((currentModules) =>
      currentModules.map((module) =>
        module.id === moduleId
          ? {
              ...module,
              lessons: module.lessons.map((lesson) =>
                lesson.id === lessonId ? { ...lesson, ...patch } : lesson,
              ),
            }
          : module,
      ),
    );
    setSuccess("");
  }

  function moveLesson(moduleId: string, lessonId: string, direction: "up" | "down") {
    if (!isEditable) {
      return;
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
    setSuccess("");
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
    const confirmed = window.confirm(
      `Delete lesson "${targetLesson?.title || "Untitled lesson"}"? This cannot be undone after autosave.`,
    );

    if (!confirmed) {
      return;
    }

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

    if (freePreviewLessonId === lessonId) {
      setFreePreviewLessonId("");
    }

    if (
      activeLessonStudio?.moduleId === moduleId
      && activeLessonStudio.lessonId === lessonId
    ) {
      setActiveLessonStudio(null);
    }

    setSuccess("");
  }

  async function saveDraft() {
    if (!courseId || !isEditable) {
      return;
    }

    setError("");
    setSuccess("");

    if (!priceFieldIsValid) {
      setError("Use a valid non-negative price, or leave the field empty.");
      return;
    }

    if (!installmentsAreValid) {
      setError("Set a valid installment limit before saving.");
      return;
    }

    if (draftStructureError) {
      setError(draftStructureError);
      return;
    }

    const signatureAtSave = builderDraftSignature;
    setIsSaving(true);
    setAutosaveState("saving");

    try {
      await updateTeacherCourseBuilder(courseId, builderDraftPayload);
      setSavedSignature(signatureAtSave);
      setAutosaveState("saved");
      setSuccess("Draft saved.");
    } catch (caughtError) {
      // Surface the duplicate-title block on rename the same way the create
      // screen does — otherwise a colliding title is swallowed by the generic
      // save error and the teacher can't tell why the save failed.
      const message =
        caughtError instanceof Error ? caughtError.message.toLowerCase() : "";
      pendingLessonStudioRef.current = null;
      setAutosaveState("error");
      setError(
        message.includes("already")
          ? "A course with this title already exists. Choose a different name."
          : "We could not save this course. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function publishCourse() {
    if (!courseId || !canPublish) {
      return;
    }

    setError("");
    setSuccess("");

    if (!priceFieldIsValid) {
      setError("Use a valid non-negative price, or leave the field empty.");
      return;
    }

    if (selectedCategories.length === 0) {
      setError("Choose at least one marketplace category before publishing.");
      return;
    }

    if (!pricingModelIsReady) {
      setError("Set a paid price greater than $0, or choose Free as the payment model before publishing.");
      return;
    }

    if (!installmentsAreValid) {
      setError("Set a valid installment limit before publishing.");
      return;
    }

    if (draftStructureError) {
      setError(draftStructureError);
      return;
    }

    const signatureAtSubmit = builderDraftSignature;
    setIsSubmitting(true);

    try {
      await updateTeacherCourseBuilder(courseId, builderDraftPayload);
      setSavedSignature(signatureAtSubmit);
      setAutosaveState("saved");
      await publishTeacherCourse(courseId);
      setSuccess("Course published. Its product page is now live.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "";
      setError(
        message.toLowerCase().includes("preview")
          ? "Clear the invalid free preview or choose a lesson from this course."
          : message.toLowerCase().includes("teacher setup")
          ? "Teacher setup must be complete before publishing courses."
          : message.toLowerCase().includes("verification")
          ? "Professional verification must be approved before publishing."
          : message.toLowerCase().includes("activation fee")
          ? "Activate your storefront to unlock publishing — it is a one-time fee, charged once."
          : message.toLowerCase().includes("payout")
          || message.toLowerCase().includes("onboarding")
          ? "Finish Stripe payout onboarding before publishing a paid course — open the Payouts panel in your studio."
          : message.toLowerCase().includes("payment")
          || message.toLowerCase().includes("price")
          ? "Set a valid payment model before publishing."
          : "We could not publish this course. Please try again.",
      );
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
      setAutosaveState("saving");

      try {
        await updateTeacherCourseBuilder(courseId, payload);
        setSavedSignature(signature);
        setAutosaveState("saved");
      } catch {
        // A failed autosave also cancels any pending auto-open of the lesson
        // studio — the lesson row falls back to "Save draft to upload".
        pendingLessonStudioRef.current = null;
        setAutosaveState("error");
      } finally {
        isAutosavingRef.current = false;
      }
    },
    [courseId],
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

  // Browser-level guard for the gap autosave can't cover: the debounce window
  // and a *failed* autosave both leave edits unpersisted. Warn before the tab
  // closes/reloads while the draft is dirty. Keyed on draftIsDirty so the
  // listener attaches only when there is something to lose and the closure
  // always sees current state (no ref, no setState in body -> loop-safe).
  useEffect(() => {
    if (!draftIsDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [draftIsDirty]);

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
      document
        .getElementById(anchor)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  // After a stepper click switches tabs, the target section mounts on the next
  // render; scroll once activeTab settles. No-op for normal tab nav (ref null).
  useEffect(() => {
    scrollPendingSectionIntoView();
  }, [activeTab, scrollPendingSectionIntoView]);

  if (!courseId) {
    return (
      <section className="settings-section-card">
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          Choose a course from Teacher Studio before opening the builder.
        </p>
        <Link href="/teach" className="button-outline mt-5 px-4 py-2.5 text-sm">
          Back to Teacher Studio
        </Link>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="settings-section-card">
        <p className="text-sm text-[var(--color-ink-soft)]">Loading course builder...</p>
      </section>
    );
  }

  if (error && !course) {
    return (
      <section className="settings-section-card">
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
        <Link href="/teach" className="button-outline mt-5 px-4 py-2.5 text-sm">
          Back to Teacher Studio
        </Link>
      </section>
    );
  }

  return (
    <div className="course-builder-shell">
      <section className="course-builder-hero">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={course?.status ?? "draft"} />
            <span className="rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)]/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
              {readinessProgress}% ready
            </span>
            {isEditable ? (
              <BuilderSaveStatus state={displayedSaveStatus} />
            ) : null}
          </div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Course builder
          </p>
          <h2 className="display-title mt-3 text-[clamp(2rem,4vw,3.2rem)] leading-[1.02] text-[var(--color-primary)]">
            {title.trim() || "Untitled course"}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Build the course learners will actually experience: details, modules,
            lessons, media, pricing, drip rules, and publication checks in one
            guided workspace.
          </p>
        </div>
        <div className="course-builder-hero__actions">
          <Link
            href={`/teach/courses/${encodeURIComponent(courseId ?? "")}/manage`}
            className="button-outline px-4 py-2.5 text-sm"
          >
            Manage product
          </Link>
          <Link
            href={`/teach/builder/${courseId}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="button-outline px-4 py-2.5 text-sm"
          >
            <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
            Preview
          </Link>
          <button
            type="button"
            onClick={saveDraft}
            disabled={!isEditable || isSaving}
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save draft"}
          </button>
        </div>
      </section>

      <nav className="course-builder-stepper" aria-label="Course creation steps">
        <div className="course-builder-stepper__head">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Course creation
            </p>
            <p className="mt-1 truncate text-sm font-semibold leading-snug text-[var(--color-ink-soft)]">
              Next:{" "}
              <span className="text-[var(--color-primary)]">
                {nextReadinessItem?.label ?? "Course is ready to publish."}
              </span>
            </p>
          </div>
          <div className="course-builder-stepper__meter">
            <div className="flex items-center justify-between gap-4 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
              <span>{completedStageCount} of {builderStages.length} stages ready</span>
              <span className="text-[var(--color-primary)]">
                Publish readiness {readinessProgress}%
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-strong)]">
              <div
                className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-300"
                style={{ width: `${builderStepProgress}%` }}
              />
            </div>
          </div>
        </div>
        <div className="course-builder-steps">
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
                    <CheckCircle2 aria-hidden="true" size={13} strokeWidth={2} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span className="min-w-0">
                  <span className="course-builder-step__label">{stage.label}</span>
                  <span className="course-builder-step__sub">{stage.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <section className="course-builder-panel">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-line)] pb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                {builderTabs[selectedTabIndex]?.label ?? "Builder"}
              </p>
              <h3 className="display-title mt-3 text-4xl leading-tight text-[var(--color-primary)]">
                {activeTab === "details"
                  ? "Set the course foundation."
                  : activeTab === "members"
                    ? "Customize the members area."
                    : activeTab === "content"
                      ? "Build the curriculum."
                      : activeTab === "pricing"
                        ? "Package the offer."
                        : "Publish to the marketplace."}
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
                {activeTab === "details"
                  ? "This is the information learners use to understand the promise of the course."
                  : activeTab === "members"
                    ? "Choose the theme, cover, and copy enrolled students see at the top of their course workspace."
                    : activeTab === "content"
                      ? "Create the modules, lessons, links, text content, and upload targets that power the members area."
                      : activeTab === "pricing"
                        ? "Set access, price, release timing, and the free preview lesson before publishing."
                        : "Your professional credential is the gate. Once the product checks pass, publishing opens sales and the public link immediately."}
              </p>
            </div>
            <div className="grid gap-2 text-right text-xs font-semibold text-[var(--color-ink-soft)]">
              <span>{modules.length} modules</span>
              <span>{lessonCount} lessons</span>
              {totalDurationMinutes > 0 ? (
                <span>{formattedDuration} total</span>
              ) : null}
              <span>{formattedPrice}</span>
            </div>
          </div>

        {course?.status === "in_review" ? (
          <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            This course carries a legacy review status. Complete the checks and
            publish it directly from this workspace.
          </p>
        ) : course?.status === "published" ? (
          <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            This course is live. You can keep improving its content and learner
            experience without creating a new review cycle.
          </p>
        ) : null}
        {course?.reviewNote ? (
          <div className="mt-5 rounded-[14px] border border-[rgba(178,34,52,0.18)] bg-[rgba(178,34,52,0.04)] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              SkillsetMind review note
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
              {course.reviewNote}
            </p>
          </div>
        ) : null}

        {activeTab === "details" ? (
        <div className="mt-6 grid gap-4">
          <div id="builder-sec-cover" className="scroll-mt-24">
            {course ? (
              <CourseCoverField course={course} isEditable={isEditable} />
            ) : null}
          </div>
          <label
            id="builder-sec-basics"
            className="grid gap-2 scroll-mt-24 text-sm font-semibold text-[var(--color-ink)]"
          >
            Course title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={!isEditable}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
            />
          </label>
          <div className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Categories
            <p className="text-xs font-normal leading-5 text-[var(--color-ink-soft)]">
              Required. Select up to five. The first selected category becomes
              the primary marketplace category.
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
            Course summary
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              disabled={!isEditable}
              rows={4}
              className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
            />
            <span
              className={`text-xs font-semibold ${
                summary.trim().length >= 20
                  ? "text-[var(--color-ink-soft)]"
                  : "text-[var(--color-accent-fg)]"
              }`}
            >
              {summary.trim().length >= 20
                ? `${summary.trim().length} characters`
                : `${summary.trim().length}/20 characters minimum for publication`}
            </span>
          </label>
          <div id="builder-sec-outcomes" className="scroll-mt-24 grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="grid gap-1">
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  What learners will learn
                </p>
                <p className="text-xs text-[var(--color-ink-soft)]">
                  Concrete outcomes shown as the &ldquo;What you&rsquo;ll
                  learn&rdquo; list on the marketplace page. Aim for 4&ndash;6.
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
                      aria-label={`Learning outcome ${index + 1}`}
                      placeholder="Example: Launch a paid cohort course end to end"
                      className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
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
                        aria-label={`Remove learning outcome ${index + 1}`}
                        className="shrink-0 rounded-[8px] border border-[var(--color-line)] p-2.5 text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-accent-fg)] hover:text-[var(--color-accent-fg)]"
                      >
                        <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-[10px] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                No outcomes yet. Add the concrete results a student walks away
                with.
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
                className="inline-flex w-fit items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] px-3 py-2 text-xs font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus aria-hidden="true" size={14} strokeWidth={2} />
                Add learning outcome
              </button>
            ) : null}
          </div>
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            Keep the title specific, the category clear, and the summary focused
            on learner outcomes. This copy will influence the marketplace page.
          </p>
        </div>
        ) : null}

        {activeTab === "members" && course ? (
          <MembersAreaTab
            courseId={courseId}
            course={course}
            isEditable={isEditable}
            theme={membersTheme}
            onThemeChange={(next) => {
              setMembersTheme(next);
              setSuccess("");
            }}
            coverAssetId={membersCoverAssetId}
            onCoverAssetIdChange={(next) => {
              setMembersCoverAssetId(next);
              setSuccess("");
            }}
            title={membersTitle}
            onTitleChange={(next) => {
              setMembersTitle(next);
              setSuccess("");
            }}
            subtitle={membersSubtitle}
            onSubtitleChange={(next) => {
              setMembersSubtitle(next);
              setSuccess("");
            }}
            description={membersDescription}
            onDescriptionChange={(next) => {
              setMembersDescription(next);
              setSuccess("");
            }}
          />
        ) : null}

        {activeTab === "members" && course ? (
          <div className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1">
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  Course community
                </p>
                <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                  Adds a private discussion space inside the members area where
                  enrolled students can post, comment, and connect. You can turn
                  this on or off at any time, even after publishing.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={communityEnabled}
                aria-label="Enable course community"
                disabled={!isEditable}
                onClick={() => {
                  setCommunityEnabled((previous) => !previous);
                  setSuccess("");
                }}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  communityEnabled
                    ? "bg-[var(--color-primary)]"
                    : "bg-[var(--color-line)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    communityEnabled ? "left-6" : "left-1"
                  }`}
                />
              </button>
            </div>
            <p className="mt-3 text-xs font-semibold text-[var(--color-ink-soft)]">
              {communityEnabled
                ? "Community is on. Students see a Community section in this course."
                : "Community is off. Students only see lessons and resources."}
            </p>
          </div>
        ) : null}

        {activeTab === "pricing" ? (
          <div
            id="builder-sec-pricing"
            className="scroll-mt-24 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              Marketplace setup
            </p>
            <div className="mt-4">
              <PlanSelectorCards
                label={
                  <span className="flex items-center gap-2">
                    Payment model
                    <InlineHelp
                      topic="Course pricing"
                      href="/help#course-pricing"
                    >
                      Choose free access, a one-time purchase, or recurring
                      monthly or yearly access. Paid products require a positive
                      price and payout-ready Stripe Connect account before they
                      can be published.
                    </InlineHelp>
                  </span>
                }
                options={paymentModelOptions}
                value={paymentType}
                onChange={handlePaymentTypeChange}
                disabled={!isEditable}
              />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_140px]">
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                Price
                <input
                  value={priceAmount}
                  onChange={(event) => setPriceAmount(event.target.value)}
                  disabled={!isEditable || paymentType === "free"}
                  inputMode="decimal"
                  placeholder={
                    paymentType === "free" ? "Free course" : "Example: 149"
                  }
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                Currency
                <select
                  value={currency}
                  onChange={(event) => {
                    const nextCurrency = event.target.value;
                    setCurrency(nextCurrency);
                    if (nextCurrency !== "MXN") {
                      setInstallmentsEnabled(false);
                    }
                  }}
                  disabled={!isEditable}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                >
                  <optgroup label="Most used">
                    {topSkillsetCurrencies.map((item) => (
                      <option key={item} value={item}>
                        {item} - {getCurrencyLabel(item)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Other supported currencies">
                    {secondaryCurrencies.map((item) => (
                      <option key={item} value={item}>
                        {item} - {getCurrencyLabel(item)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4 rounded-[12px] border border-[var(--color-line)] bg-white p-4">
              <div className="max-w-xl">
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  Card installments
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                  {paymentType !== "one_time"
                    ? "Installments apply only to one-time payments."
                    : !cardInstallmentsConfigured
                      ? "Unavailable with the current Stripe account. Stripe requires a Mexico platform account and MXN pricing."
                      : currency !== "MXN"
                        ? "Select MXN to configure installments for eligible Mexican cards."
                        : "Eligible cards choose from the plans configured in Stripe. Card issuer and minimum amount rules apply."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={installmentsEnabled && canConfigureCardInstallments}
                aria-label="Enable card installments"
                disabled={!isEditable || !canConfigureCardInstallments}
                onClick={() => setInstallmentsEnabled((previous) => !previous)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  installmentsEnabled && canConfigureCardInstallments
                    ? "bg-[var(--color-primary)]"
                    : "bg-[var(--color-line)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    installmentsEnabled && canConfigureCardInstallments
                      ? "left-6"
                      : "left-1"
                  }`}
                />
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_180px]">
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                Content release
                <select
                  value={dripStrategy}
                  onChange={(event) =>
                    setDripStrategy(event.target.value as DripStrategy)
                  }
                  disabled={!isEditable}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                >
                  {dripStrategies.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                Interval days
                <input
                  value={dripIntervalDays}
                  onChange={(event) => setDripIntervalDays(event.target.value)}
                  disabled={
                    !isEditable
                    || !["time_drip_lesson", "time_drip_module"].includes(
                      dripStrategy,
                    )
                  }
                  inputMode="numeric"
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
              </label>
            </div>
            <p className="mt-3 rounded-[10px] border fine-rule bg-white px-4 py-3 text-xs leading-5 text-[var(--color-ink-soft)]">
              {dripStrategies.find((item) => item.value === dripStrategy)?.detail}
              {dripStrategy === "time_drip_custom"
                ? " Set each lesson delay in the curriculum editor."
                : ""}
            </p>
            <label className="mt-4 grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
              Free preview lesson
              <select
                value={freePreviewLessonId}
                onChange={(event) => setFreePreviewLessonId(event.target.value)}
                disabled={!isEditable || allLessons.length === 0}
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              >
                <option value="">No preview selected yet</option>
                {allLessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.moduleTitle} - {lesson.title}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
              These fields prepare the public listing. Paid access still requires
              Stripe checkout before enrollment opens.
            </p>
          </div>
        ) : null}

        {activeTab === "content" ? (
        <div className="mt-6 grid gap-4">
          <div
            id="builder-sec-modules"
            className="scroll-mt-24 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <h4 className="text-sm font-semibold text-[var(--color-ink)]">
              Add module
            </h4>
            <form className="mt-3 grid gap-3" onSubmit={handleAddModule}>
              <input
                value={moduleTitle}
                onChange={(event) => setModuleTitle(event.target.value)}
                disabled={!isEditable}
                aria-label="Module title"
                placeholder="Example: Foundations"
                className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              />
              <textarea
                value={moduleSummary}
                onChange={(event) => setModuleSummary(event.target.value)}
                disabled={!isEditable}
                rows={2}
                aria-label="Module description"
                placeholder="Optional module description. Example: Set up the concepts students need before the practical lessons."
                className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              />
              <button
                type="submit"
                disabled={!isEditable}
                className="button-outline w-fit px-4 py-2.5 text-sm disabled:opacity-60"
              >
                Add module
              </button>
            </form>
          </div>

          <div
            id="builder-sec-lessons"
            className="scroll-mt-24 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
              Add lesson
              <InlineHelp
                topic="Lesson access and drip release"
                href="/help#drip-release"
              >
                Use lesson delays to pace access after enrollment. A free
                preview is optional and must point to a lesson in this course;
                it helps buyers inspect the teaching style before enrolling.
              </InlineHelp>
            </h4>
            <form className="mt-3 grid gap-3" onSubmit={handleAddLesson}>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={lessonModuleId}
                  onChange={(event) => setLessonModuleId(event.target.value)}
                  disabled={!isEditable || modules.length === 0}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                >
                  <option value="">Choose module</option>
                  {modules.map((module) => (
                    <option key={module.id} value={module.id}>
                      {module.title}
                    </option>
                  ))}
                </select>
                <select
                  value={lessonType}
                  onChange={(event) => setLessonType(event.target.value as LessonType)}
                  disabled={!isEditable}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                >
                  {lessonTypes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={lessonTitle}
                onChange={(event) => setLessonTitle(event.target.value)}
                disabled={!isEditable}
                aria-label="Lesson title"
                placeholder="Lesson title"
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              />
              <div className="grid gap-3 md:grid-cols-[160px_160px_1fr]">
                <input
                  value={lessonDurationMinutes}
                  onChange={(event) => setLessonDurationMinutes(event.target.value)}
                  disabled={!isEditable}
                  inputMode="numeric"
                  aria-label="Lesson duration in minutes"
                  placeholder="Minutes"
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
                <input
                  value={lessonDripDelayDays}
                  onChange={(event) => setLessonDripDelayDays(event.target.value)}
                  disabled={!isEditable}
                  inputMode="numeric"
                  aria-label="Drip delay in days"
                  placeholder="Drip delay days"
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
                <input
                  value={lessonExternalUrl}
                  onChange={(event) => setLessonExternalUrl(event.target.value)}
                  disabled={!isEditable}
                  aria-label="Lesson external link or replay URL"
                  placeholder="Optional external link or replay URL"
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
              </div>
              <textarea
                value={lessonDescription}
                onChange={(event) => setLessonDescription(event.target.value)}
                disabled={!isEditable}
                rows={3}
                aria-label="Lesson note or outcome"
                placeholder="Optional lesson note or outcome"
                className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              />
              <textarea
                value={lessonContentText}
                onChange={(event) => setLessonContentText(event.target.value)}
                disabled={!isEditable}
                rows={4}
                aria-label="Lesson text content"
                placeholder="Optional text content, instructions, assignment prompt, or lesson outline."
                className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              />
              <label className="flex items-start gap-3 rounded-[10px] border fine-rule bg-white p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                <input
                  type="checkbox"
                  checked={lessonIsFreePreview}
                  disabled={!isEditable}
                  onChange={(event) => setLessonIsFreePreview(event.target.checked)}
                  className="mt-1"
                />
                Make this lesson the public free preview.
              </label>
              <button
                type="submit"
                disabled={!isEditable || modules.length === 0}
                className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
              >
                Add lesson
              </button>
            </form>
          </div>

          <div className="rounded-[14px] border fine-rule bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                  Curriculum editor
                </p>
                <h4 className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                  Edit, reorder, and clean up modules and lessons
                </h4>
              </div>
              <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
                {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-4 grid gap-4">
              {modules.length === 0 ? (
                <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
                  Add your first module above. Once it exists, you can edit, reorder,
                  and organize its lessons here.
                </p>
              ) : (
                modules.map((module, moduleIndex) => (
                  <article
                    key={module.id}
                    className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
                  >
                    <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
                      <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                        Module {moduleIndex + 1}
                        <input
                          value={module.title}
                          onChange={(event) =>
                            updateModuleTitle(module.id, event.target.value)
                          }
                          disabled={!isEditable}
                          className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                        />
                        <textarea
                          value={module.summary ?? ""}
                          onChange={(event) =>
                            updateModuleSummary(module.id, event.target.value)
                          }
                          disabled={!isEditable}
                          rows={2}
                          aria-label={`Module ${moduleIndex + 1} description`}
                          placeholder="Optional module description"
                          className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => moveModule(module.id, "up")}
                          disabled={!isEditable || moduleIndex === 0}
                          className="button-outline px-3 py-2 text-xs disabled:opacity-50"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveModule(module.id, "down")}
                          disabled={!isEditable || moduleIndex === modules.length - 1}
                          className="button-outline px-3 py-2 text-xs disabled:opacity-50"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteModule(module.id)}
                          disabled={!isEditable}
                          className="rounded-[8px] border border-[rgba(178,34,52,0.22)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-accent-fg)] disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3">
                      {module.lessons.length === 0 ? (
                        <p className="rounded-[10px] border fine-rule bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                          This module has no lessons yet.
                        </p>
                      ) : (
                        module.lessons.map((lesson, lessonIndex) => (
                          <div
                            key={lesson.id}
                            className="grid gap-3 rounded-[14px] border border-[var(--color-line)] bg-white p-4"
                          >
                            <div className="grid gap-3 lg:grid-cols-[1fr_190px_120px_140px_auto] lg:items-end">
                              <label className="grid gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                                Lesson title
                                <input
                                  value={lesson.title}
                                  onChange={(event) =>
                                    updateLesson(module.id, lesson.id, {
                                      title: event.target.value,
                                    })
                                  }
                                  disabled={!isEditable}
                                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                                />
                              </label>
                              <label className="grid gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                                Type
                                <select
                                  value={lesson.type}
                                  onChange={(event) =>
                                    updateLesson(module.id, lesson.id, {
                                      type: event.target.value as LessonType,
                                    })
                                  }
                                  disabled={!isEditable}
                                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                                >
                                  {lessonTypes.map((item) => (
                                    <option key={item.value} value={item.value}>
                                      {item.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="grid gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                                Minutes
                                <input
                                  value={lesson.durationMinutes ?? ""}
                                  onChange={(event) =>
                                    updateLesson(module.id, lesson.id, {
                                      durationMinutes: normalizeDurationMinutes(
                                        event.target.value,
                                      ),
                                    })
                                  }
                                  disabled={!isEditable}
                                  inputMode="numeric"
                                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                                />
                              </label>
                              <label className="grid gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                                Delay days
                                <input
                                  value={lesson.dripDelayDays ?? ""}
                                  onChange={(event) =>
                                    updateLesson(module.id, lesson.id, {
                                      dripDelayDays: normalizeDripDelayDays(
                                        event.target.value,
                                      ),
                                    })
                                  }
                                  disabled={!isEditable}
                                  inputMode="numeric"
                                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--color-ink)] outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                                />
                              </label>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => moveLesson(module.id, lesson.id, "up")}
                                  disabled={!isEditable || lessonIndex === 0}
                                  className="button-outline px-3 py-2 text-xs disabled:opacity-50"
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveLesson(module.id, lesson.id, "down")}
                                  disabled={
                                    !isEditable ||
                                    lessonIndex === module.lessons.length - 1
                                  }
                                  className="button-outline px-3 py-2 text-xs disabled:opacity-50"
                                >
                                  Down
                                </button>
                              </div>
                            </div>

                            <textarea
                              value={lesson.description}
                              onChange={(event) =>
                                updateLesson(module.id, lesson.id, {
                                  description: event.target.value,
                                })
                              }
                              disabled={!isEditable}
                              rows={2}
                              aria-label={`Lesson ${lessonIndex + 1} note or outcome`}
                              placeholder="Lesson note or learner outcome"
                              className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                            />
                            <textarea
                              value={lesson.contentText ?? ""}
                              onChange={(event) =>
                                updateLesson(module.id, lesson.id, {
                                  contentText: event.target.value || null,
                                })
                              }
                              disabled={!isEditable}
                              rows={3}
                              aria-label={`Lesson ${lessonIndex + 1} text content`}
                              placeholder="Text content, assignment prompt, or lesson outline"
                              className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                            />
                            <input
                              value={lesson.externalUrl ?? ""}
                              onChange={(event) =>
                                updateLesson(module.id, lesson.id, {
                                  externalUrl: event.target.value || null,
                                })
                              }
                              disabled={!isEditable}
                              aria-label={`Lesson ${lessonIndex + 1} external link`}
                              placeholder="Optional external link, live replay, or embed URL"
                              className="rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                            />

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap gap-2">
                                {savedLessonIds.has(lesson.id) ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActiveLessonStudio({
                                        moduleId: module.id,
                                        lessonId: lesson.id,
                                      })
                                    }
                                    className="button-solid inline-flex items-center gap-1.5 px-3 py-2 text-xs"
                                    title={
                                      lessonIdsWithVideo.has(lesson.id) ||
                                      getTrustedLessonEmbed(lesson.externalUrl)
                                        ? "Edit the lesson video, materials, and settings"
                                        : "Add the lesson video"
                                    }
                                  >
                                    {lessonIdsWithVideo.has(lesson.id) ||
                                    getTrustedLessonEmbed(lesson.externalUrl) ? (
                                      "Edit content"
                                    ) : (
                                      <>
                                        <Film aria-hidden="true" size={13} strokeWidth={1.9} />
                                        Add video
                                      </>
                                    )}
                                  </button>
                                ) : autosaveState === "error" ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="button-solid px-3 py-2 text-xs disabled:opacity-60"
                                    title="Autosave failed — use Save draft to enable uploads"
                                  >
                                    Save draft to upload
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
                                    <Loader2
                                      aria-hidden="true"
                                      size={13}
                                      strokeWidth={2.2}
                                      className="animate-spin"
                                    />
                                    Saving lesson…
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFreePreviewLessonId(
                                      freePreviewLessonId === lesson.id ? "" : lesson.id,
                                    )
                                  }
                                  disabled={!isEditable}
                                  className={`rounded-[8px] border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                                    freePreviewLessonId === lesson.id
                                      ? "border-[var(--color-primary)] bg-[rgba(26,54,93,0.08)] text-[var(--color-primary)]"
                                      : "border-[var(--color-line)] bg-white text-[var(--color-ink-soft)]"
                                  }`}
                                >
                                  {freePreviewLessonId === lesson.id
                                    ? "Free preview selected"
                                    : "Mark free preview"}
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => deleteLesson(module.id, lesson.id)}
                                disabled={!isEditable}
                                className="rounded-[8px] border border-[rgba(178,34,52,0.22)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-accent-fg)] disabled:opacity-50"
                              >
                                Delete lesson
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
        ) : null}

        {activeTab === "review" ? (
          <div
            id="builder-sec-review"
            className="mt-6 scroll-mt-24 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              Publish readiness
            </p>
            <h4 className="display-title mt-3 flex items-center gap-2 text-3xl text-[var(--color-ink)]">
              Ready the product for launch
              <InlineHelp
                topic="Course publishing"
                href="/help#course-publishing"
              >
                SkillsetMind verifies the professional rather than manually
                approving every course. Once these product checks pass, an
                approved creator publishes directly and the marketplace link
                opens immediately.
              </InlineHelp>
            </h4>
            <div className="mt-5 grid gap-3">
              {readinessItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3"
                >
                  <p className={`text-sm font-semibold ${item.ready ? "text-[var(--color-primary)]" : "text-[var(--color-accent-fg)]"}`}>
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm leading-7 text-[var(--color-ink-soft)]">
              SkillsetMind gates the professional, not each course. Product,
              pricing, and payout checks run before the marketplace link opens.
            </p>
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-6">
          <button
            type="button"
            onClick={() => {
              const previousTab = builderTabs[selectedTabIndex - 1];
              if (previousTab) {
                selectTab(previousTab.value);
              }
            }}
            disabled={selectedTabIndex <= 0}
            className="button-outline inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-40"
          >
            <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.9} />
            {selectedTabIndex > 0
              ? `Back to ${builderTabs[selectedTabIndex - 1].label}`
              : "Back"}
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
              className="button-solid inline-flex items-center gap-2 px-4 py-2.5 text-sm"
            >
              Continue to {builderTabs[selectedTabIndex + 1].label}
              <ArrowRight aria-hidden="true" size={14} strokeWidth={1.9} />
            </button>
          ) : (
            <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
              Finish the publication checks to go live.
            </span>
          )}
        </div>
      </section>

      <div className="course-builder-footer">
        <section className="settings-section-card">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Course structure
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {modules.length} modules, {lessonCount} lessons
          </h3>
          <div className="mt-5 grid gap-3">
            {modules.length === 0 ? (
              <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
                Start with one module, then add the lessons learners should complete.
              </p>
            ) : (
              modules.map((module, index) => (
                <article
                  key={module.id}
                  className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                    Module {index + 1}
                  </p>
                  <h4 className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                    {module.title}
                  </h4>
                  <div className="mt-3 grid gap-2">
                    {module.lessons.length === 0 ? (
                      <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                        No lessons yet.
                      </p>
                    ) : (
                      module.lessons.map((lesson) => (
                        <div
                          key={lesson.id}
                          className="rounded-[10px] bg-white px-3 py-2"
                        >
                          <p className="text-xs font-semibold text-[var(--color-ink)]">
                            {lesson.title}
                          </p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                            {getLessonTypeLabel(lesson.type)}
                            {lesson.durationMinutes ? ` - ${lesson.durationMinutes} min` : ""}
                            {typeof lesson.dripDelayDays === "number"
                              ? ` - D+${lesson.dripDelayDays}`
                              : ""}
                            {freePreviewLessonId === lesson.id ? " - preview" : ""}
                          </p>
                          {lesson.description ? (
                            <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">
                              {lesson.description}
                            </p>
                          ) : null}
                          {lesson.contentText ? (
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--color-ink-soft)]">
                              {lesson.contentText}
                            </p>
                          ) : null}
                          {lesson.externalUrl ? (
                            <p className="mt-2 break-all text-[11px] leading-5 text-[var(--color-primary)]">
                              {lesson.externalUrl}
                            </p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="settings-section-card">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Publish readiness
          </p>
          <div className="mt-4 grid gap-2 text-sm text-[var(--color-ink-soft)]">
            <p>{title.trim() ? "Course title is set." : "Add a course title."}</p>
            <p>{summary.trim().length >= 20 ? "Summary is ready." : "Add a clearer summary."}</p>
            <p>{selectedCategories.length > 0 ? "Marketplace category is set." : "Choose at least one marketplace category."}</p>
            <p>{modules.length > 0 ? "At least one module exists." : "Add at least one module."}</p>
            <p>{lessonCount > 0 ? "At least one lesson exists." : "Add at least one lesson."}</p>
            <p>{pricingModelIsReady ? "Enrollment model is ready." : "Set price or mark the course as Free."}</p>
          </div>
          {error ? (
            <div
              role="alert"
              className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]"
            >
              <p>{error}</p>
              {error.startsWith("Activate your storefront") ? (
                <Link
                  href="/teach/activate"
                  className="button-solid mt-3 px-4 py-2 text-xs"
                >
                  Activate storefront
                </Link>
              ) : null}
            </div>
          ) : null}
          {success ? (
            <p className="mt-4 info-notice">
              {success}
            </p>
          ) : null}
          <div className="mt-5 grid gap-3">
            <button
              type="button"
              onClick={saveDraft}
              disabled={!isEditable || isSaving}
              className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save draft"}
            </button>
            <button
              type="button"
              onClick={publishCourse}
              disabled={
                !canPublish
                || isSubmitting
                || !title.trim()
                || summary.trim().length < 20
                || selectedCategories.length === 0
                || modules.length === 0
                || lessonCount === 0
                || !priceFieldIsValid
                || !pricingModelIsReady
                || !installmentsAreValid
              }
              className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {isSubmitting ? "Publishing..." : "Publish product"}
            </button>
            <Link href="/teach" className="button-outline px-4 py-2.5 text-sm">
              Back to Teacher Studio
            </Link>
          </div>
        </section>

        {course ? (
          <div className="course-builder-footer__full">
            <CourseAssetUploader course={course} isEditable={isEditable} />
          </div>
        ) : null}
      </div>
      {course && activeLessonStudioModule && activeLessonStudioLesson ? (
        <LessonContentModal
          course={course}
          module={activeLessonStudioModule}
          moduleIndex={activeLessonStudioModuleIndex}
          lesson={activeLessonStudioLesson}
          lessonIndex={activeLessonStudioLessonIndex}
          isEditable={isEditable}
          isFreePreview={freePreviewLessonId === activeLessonStudioLesson.id}
          onClose={() => setActiveLessonStudio(null)}
          onSetFreePreview={() =>
            setFreePreviewLessonId(
              freePreviewLessonId === activeLessonStudioLesson.id
                ? ""
                : activeLessonStudioLesson.id,
            )
          }
          onUpdateLesson={(patch) =>
            updateLesson(
              activeLessonStudioModule.id,
              activeLessonStudioLesson.id,
              patch,
            )
          }
        />
      ) : null}
    </div>
  );
}

function BuilderSaveStatus({
  state,
}: {
  state: "pending" | "saving" | "saved" | "error";
}) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
        <Loader2
          aria-hidden="true"
          size={12}
          strokeWidth={2.2}
          className="animate-spin"
        />
        Saving
      </span>
    );
  }

  if (state === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
        <span className="size-1.5 rounded-full bg-[var(--color-ink-muted)]" />
        Unsaved changes
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(178,34,52,0.22)] bg-[rgba(178,34,52,0.06)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent-fg)]">
        <CloudOff aria-hidden="true" size={12} strokeWidth={2} />
        Save failed — use Save draft
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
      <CheckCircle2 aria-hidden="true" size={12} strokeWidth={2} />
      All changes saved
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
}: {
  course: TeacherCourse;
  isEditable: boolean;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<UploadCourseAssetProgress | null>(null);
  const [error, setError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file || !isEditable) {
      return;
    }

    setError("");
    setProgress(null);

    if (!isAllowedCourseAssetFile(file, "course_cover")) {
      setError(
        `Use an image file under ${formatCourseAssetSize(courseAssetMaxBytes)}.`,
      );
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
    } catch {
      setError(
        "We could not upload this cover. Check the file and course ownership, then try again.",
      );
    } finally {
      setIsUploading(false);
      setProgress(null);
      setFileInputKey((current) => current + 1);
    }
  }

  return (
    <section className="grid gap-3 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Course cover
          </p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--color-ink-soft)]">
            Public artwork for the marketplace, the course page, and the student
            classroom hero. Recommended 16:9, under{" "}
            {formatCourseAssetSize(courseAssetMaxBytes)}.
          </p>
        </div>
        {course.coverImageUrl ? (
          <span className="inline-flex items-center gap-1 rounded-[8px] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-primary)]">
            <CheckCircle2 size={12} aria-hidden /> Cover set
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-start">
        <div className="relative aspect-video overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white">
          {course.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={course.coverImageUrl}
              alt={`${course.title || "Course"} cover`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[var(--color-ink-soft)]">
              <ImageIcon size={22} aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">
                No cover yet
              </span>
            </div>
          )}
        </div>

        <div className="grid content-start gap-2">
          <label
            className={`inline-flex w-fit items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] ${
              !isEditable || isUploading
                ? "pointer-events-none opacity-60"
                : "cursor-pointer"
            }`}
          >
            <UploadCloud size={16} aria-hidden />
            {isUploading
              ? "Uploading..."
              : course.coverImageUrl
                ? "Replace cover"
                : "Upload cover"}
            <input
              key={fileInputKey}
              type="file"
              accept={courseAssetAcceptTypes.course_cover}
              disabled={!isEditable || isUploading}
              onChange={handleFile}
              className="hidden"
            />
          </label>

          {progress ? (
            <div className="rounded-[10px] border fine-rule bg-white p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[var(--color-primary)]">
                <span>
                  {progress.state === "success" ? "Upload complete" : "Uploading"}
                </span>
                <span>{progress.percent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-soft)]">
                <div
                  className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-xs font-semibold text-[var(--color-accent-fg)]">
              {error}
            </p>
          ) : null}

          {!course.coverImageUrl && !error && !progress ? (
            <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
              Add a cover — it appears on the marketplace card, the course page,
              and the classroom.
            </p>
          ) : null}
        </div>
      </div>
    </section>
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
  const [assets, setAssets] = useState<CourseAsset[]>([]);

  useEffect(() => {
    return subscribeToCourseAssets(course.id, setAssets, () => undefined);
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
  const previewTitle = title.trim() || course.title || "Untitled course";

  return (
    <div
      id="builder-sec-members"
      className="mt-6 grid scroll-mt-24 gap-4 lg:grid-cols-[1fr_360px] lg:items-start"
    >
      <div className="grid gap-4">
        <div className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Theme
          <p className="text-xs font-normal leading-5 text-[var(--color-ink-soft)]">
            Sets the look of the enrolled-student hero. Light is the default.
          </p>
          <div className="inline-flex w-fit gap-1 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1">
            {(
              [
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
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
                  className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
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
          onUploaded={onCoverAssetIdChange}
          onRemove={() => onCoverAssetIdChange(null)}
        />

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Members area title
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            disabled={!isEditable}
            maxLength={80}
            placeholder={course.title || "Your course title"}
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
          />
          <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
            {title.length}/80 — leave empty to use the course title.
          </span>
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Subtitle
          <input
            value={subtitle}
            onChange={(event) => onSubtitleChange(event.target.value)}
            disabled={!isEditable}
            maxLength={160}
            placeholder="Your studio name, a tagline, or who it's for"
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
          />
          <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
            {subtitle.length}/160 — the line under the title. Add your studio
            name or a tagline, or leave it empty.
          </span>
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Description
          <textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            disabled={!isEditable}
            maxLength={2000}
            rows={4}
            placeholder="A short welcome shown under the title in the members area."
            className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
          />
          <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
            {description.length}/2000
          </span>
        </label>
      </div>

      <div className="grid gap-3 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 lg:sticky lg:top-24">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          Live preview
        </p>
        {/* ponytail: fixed-scale thumbnail (1080px stage scaled to fit the
            340px card) — a measured/responsive scale isn't worth it for a
            corner preview; bump STAGE_WIDTH if the hero ever grows wider. */}
        <div
          data-members-theme={theme}
          aria-hidden="true"
          style={{
            width: "100%",
            height: 174,
            overflow: "hidden",
            borderRadius: 10,
            background: "var(--ma-bg)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 1080,
              transform: "scale(0.3148)",
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
        <Link
          href={`/teach/builder/${courseId}/preview`}
          target="_blank"
          rel="noopener noreferrer"
          className="button-outline inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm"
        >
          <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
          Open full preview
        </Link>
        <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
          The full preview opens the last saved version in a new tab. Edits
          autosave, so it stays current within a moment of typing.
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
  isEditable,
  coverUrl,
  onUploaded,
  onRemove,
}: {
  course: TeacherCourse;
  isEditable: boolean;
  coverUrl: string | null;
  onUploaded: (assetId: string) => void;
  onRemove: () => void;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<UploadCourseAssetProgress | null>(null);
  const [error, setError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file || !isEditable) {
      return;
    }

    setError("");
    setProgress(null);

    if (!isAllowedCourseAssetFile(file, "members_cover")) {
      setError(
        `Use an image file under ${formatCourseAssetSize(courseAssetMaxBytes)}.`,
      );
      setFileInputKey((current) => current + 1);
      return;
    }

    setIsUploading(true);

    try {
      const assetId = await uploadCourseAsset({
        courseId: course.id,
        ownerId: course.ownerId,
        kind: "members_cover",
        file,
        isPreview: false,
        onProgress: setProgress,
      });
      onUploaded(assetId);
    } catch {
      setError(
        "We could not upload this cover. Check the file and course ownership, then try again.",
      );
    } finally {
      setIsUploading(false);
      setProgress(null);
      setFileInputKey((current) => current + 1);
    }
  }

  return (
    <section className="grid gap-3 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Members area cover
          </p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--color-ink-soft)]">
            Hero background for the enrolled-student workspace. Recommended 16:9,
            under {formatCourseAssetSize(courseAssetMaxBytes)}.
          </p>
        </div>
        {coverUrl ? (
          <span className="inline-flex items-center gap-1 rounded-[8px] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-primary)]">
            <CheckCircle2 size={12} aria-hidden /> Cover set
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-start">
        <div className="relative aspect-video overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- members cover is an arbitrary CourseAsset URL
            <img
              src={coverUrl}
              alt={`${course.title || "Course"} members cover`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[var(--color-ink-soft)]">
              <ImageIcon size={22} aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">
                No cover yet
              </span>
            </div>
          )}
        </div>

        <div className="grid content-start gap-2">
          <label
            className={`inline-flex w-fit items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] ${
              !isEditable || isUploading
                ? "pointer-events-none opacity-60"
                : "cursor-pointer"
            }`}
          >
            <UploadCloud size={16} aria-hidden />
            {isUploading
              ? "Uploading..."
              : coverUrl
                ? "Replace cover"
                : "Upload cover"}
            <input
              key={fileInputKey}
              type="file"
              accept={courseAssetAcceptTypes.members_cover}
              disabled={!isEditable || isUploading}
              onChange={handleFile}
              className="hidden"
            />
          </label>

          {coverUrl && isEditable && !isUploading ? (
            <button
              type="button"
              onClick={onRemove}
              className="w-fit text-xs font-semibold text-[var(--color-accent-fg)] underline-offset-2 hover:underline"
            >
              Remove cover
            </button>
          ) : null}

          {progress ? (
            <div className="rounded-[10px] border fine-rule bg-white p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[var(--color-primary)]">
                <span>
                  {progress.state === "success" ? "Upload complete" : "Uploading"}
                </span>
                <span>{progress.percent}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-soft)]">
                <div
                  className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-200"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-xs font-semibold text-[var(--color-accent-fg)]">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
