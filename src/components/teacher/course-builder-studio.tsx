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
import { useTranslation } from "@/components/i18n/i18n-provider";
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
  formatCourseAssetSize,
  getCourseAssetUploadErrorMessage,
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
import { ReadinessGroups } from "@/components/teacher/readiness-groups";
import { UploadProgressNote } from "@/components/teacher/upload-progress-note";
import { InlineAlert } from "@/components/ui";
import type { CourseAsset } from "@/domain/course-asset";
import { isActivationRequiredError } from "@/domain/creator-verification";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import { isPublicFeatureEnabled } from "@/lib/feature-flags";
import { track } from "@/lib/posthog/events";
import { defaultSkillsetCurrency } from "@/lib/payments/currencies";
import { CurrencySelect } from "@/components/teacher/currency-select";
import { usePublishGates } from "@/components/teacher/use-publish-gates";
import { getCourseReadiness } from "@/domain/course-readiness";

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

const lessonTypes: { value: LessonType; label: string }[] = [
  { value: "video", label: "publicCourses.lessonTypes.video" },
  { value: "text", label: "publicCourses.lessonTypes.text" },
  // Quiz/assignment authoring is hidden until a real assessment engine exists
  // (no question/submission/grading model). See
  // docs/plans/2026-06-23-launch-readiness.md (B8).
  { value: "live_recording", label: "publicCourses.lessonTypes.live_recording" },
  { value: "download", label: "publicCourses.lessonTypes.download" },
  { value: "external_embed", label: "publicCourses.lessonTypes.external_embed" },
];

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

const paymentModelOptions: PlanSelectorOption<TeacherCoursePaymentType>[] = [
  {
    value: "one_time",
    title: "creatorEditor.builder.paymentModels.one_time.title",
    description: "creatorEditor.builder.paymentModels.one_time.description",
    features: ["creatorEditor.builder.paymentModels.one_time.feature1", "creatorEditor.builder.paymentModels.one_time.feature2"],
    icon: CreditCard,
  },
  {
    value: "free",
    title: "creatorEditor.builder.paymentModels.free.title",
    description: "creatorEditor.builder.paymentModels.free.description",
    features: ["creatorEditor.builder.paymentModels.free.feature1", "creatorEditor.builder.paymentModels.free.feature2"],
    icon: Gift,
  },
  {
    value: "subscription_monthly",
    title: "creatorEditor.builder.paymentModels.subscription_monthly.title",
    description: "creatorEditor.builder.paymentModels.subscription_monthly.description",
    features: ["creatorEditor.builder.paymentModels.subscription_monthly.feature1", "creatorEditor.builder.paymentModels.subscription_monthly.feature2"],
    icon: Repeat,
  },
  {
    value: "subscription_yearly",
    title: "creatorEditor.builder.paymentModels.subscription_yearly.title",
    description: "creatorEditor.builder.paymentModels.subscription_yearly.description",
    features: ["creatorEditor.builder.paymentModels.subscription_yearly.feature1", "creatorEditor.builder.paymentModels.subscription_yearly.feature2"],
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

function getLessonTypeLabel(type: LessonType, t: (key: string) => string) {
  return t(`publicCourses.lessonTypes.${type}`);
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
    | "lessonTitleMissing" | "price" | "installmentsSave" | "category" | "paidPrice"
    | "installmentsPublish" | "duplicateTitle" | "activation" | "save" | "preview"
    | "setup" | "verification" | "payouts" | "payment" | "publish";
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
  const { locale, t } = useTranslation();
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
  // Payouts e verificacao: so o Manage sabia; aqui a pessoa clicava em
  // Publish e descobria pelo erro do servidor.
  const { account: publishGates } = usePublishGates(user);
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
  const [moduleError, setModuleError] = useState(false);
  const [lessonModuleId, setLessonModuleId] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonType, setLessonType] = useState<LessonType>("video");
  const [lessonDescription, setLessonDescription] = useState("");
  const [lessonDurationMinutes, setLessonDurationMinutes] = useState("");
  const [lessonDripDelayDays, setLessonDripDelayDays] = useState("");
  const [lessonContentText, setLessonContentText] = useState("");
  const [lessonExternalUrl, setLessonExternalUrl] = useState("");
  const [lessonIsFreePreview, setLessonIsFreePreview] = useState(false);
  const [error, setError] = useState<BuilderError | null>(null);
  const [success, setSuccess] = useState<"lessonAdded" | "draftSaved" | "published" | null>(null);
  const errorMessage = error
    ? t(`creatorEditor.builder.errors.${error.code}`)
      .replace("{module}", () => String(error.moduleIndex ?? ""))
      .replace("{lesson}", () => String(error.lessonIndex ?? ""))
    : null;
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
          setError({ code: "notFound" });
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
        setError(null);
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
          setSuccess(null);
        }
      },
      () => {
        setIsLoading(false);
        setError({ code: "load" });
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
  // Uma lista so de "o que falta para publicar", a mesma do rodape e do
  // Manage. Antes o construtor montava duas listas proprias e a barra do
  // cabecalho media outra coisa (estagios): tres numeros para um curso so.
  // Le do payload normalizado, entao um preco digitado errado conta como
  // preco ausente, igual ao que o servidor gravaria.
  const readiness = getCourseReadiness(
    { ...builderDraftPayload, coverImageUrl: course?.coverImageUrl ?? null },
    publishGates,
    t,
  );
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
      ? t("creatorEditor.builder.summary.month")
      : paymentType === "subscription_yearly"
        ? t("creatorEditor.builder.summary.year")
        : "";
  const formattedPrice =
    paymentType === "free"
      ? t("publicCourses.free")
      : parsedPriceAmountMinor
        ? `${new Intl.NumberFormat(locale, {
            style: "currency",
            currency: currency.toUpperCase(),
            maximumFractionDigits: 0,
          }).format(parsedPriceAmountMinor / 100)}${priceIntervalSuffix}`
        : t("creatorEditor.builder.summary.setPrice");
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
  // Preço e parcelas só ficam inválidos por digitação (a hidratação sempre
  // produz valor válido ou vazio). Um preço inválido que normaliza para o mesmo
  // valor da base ("invalid" e vazio viram null) não muda a assinatura, e o
  // estúdio dizia "All changes saved" com o campo errado na tela. O bloqueio
  // desses campos é visível mesmo sem diferença na assinatura; estrutura segue
  // exigindo rascunho sujo, porque pode vir assim do banco.
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
      // Erro LOCAL do formulário, não o `error` compartilhado do estúdio: aquele
      // é renderizado ~600 linhas abaixo daqui, três telas de rolagem longe do
      // botão. Clicar em "Add module" sem título parecia não fazer nada, e a
      // explicação estava fora da tela.
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
    setError(null);
    setSuccess(null);
  }

  function handleAddLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable) {
      return;
    }

    if (!lessonModuleId) {
      setError({ code: "chooseModule" });
      return;
    }

    const nextTitle = lessonTitle.trim();

    if (!nextTitle) {
      setError({ code: "lessonTitle" });
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
    setError(null);
    // Video-first flow: the lesson studio (Video tab) opens automatically as
    // soon as autosave persists the lesson — no hunting for the studio button.
    pendingLessonStudioRef.current = {
      moduleId: lessonModuleId,
      lessonId: nextLessonId,
    };
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

  function moveModule(moduleId: string, direction: "up" | "down") {
    if (!isEditable) {
      return;
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
    const confirmed = window.confirm(
      t(lessonCount === 0
        ? "creatorEditor.builder.confirm.deleteModuleEmpty"
        : lessonCount === 1
          ? "creatorEditor.builder.confirm.deleteModuleOne"
          : "creatorEditor.builder.confirm.deleteModuleMany")
        .replace(/\{title\}|\{count\}/g, (token) => token === "{title}"
          ? target?.title || t("creatorEditor.builder.curriculum.untitledModule")
          : String(lessonCount)),
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
    setSuccess(null);
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
    setSuccess(null);
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
    setSuccess(null);
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
      t("creatorEditor.builder.confirm.deleteLesson").replace("{title}", () => targetLesson?.title || t("creatorEditor.builder.curriculum.untitledLesson")),
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

    setSuccess(null);
  }

  async function saveDraft() {
    if (!courseId || !isEditable) {
      return;
    }

    setError(null);
    setSuccess(null);

    if (!priceFieldIsValid) {
      setError({ code: "price" });
      return;
    }

    if (!installmentsAreValid) {
      setError({ code: "installmentsSave" });
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

    try {
      await updateTeacherCourseBuilder(courseId, builderDraftPayload);
      setSavedSignature(signatureAtSubmit);
      setAutosaveState("saved");
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
      setError({ code: message.toLowerCase().includes("preview")
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
                  : "publish" });
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

  // O `beforeunload` acima só existe para o navegador: fechar a aba, recarregar,
  // voltar. Ele NÃO dispara em navegação client-side do App Router — e é por ali
  // que se sai daqui na prática, clicando "Courses", "Sales" ou o logo na
  // barra lateral. O componente desmontava, o timer de 1,8s morria com ele e o
  // rascunho ia junto, sem uma palavra.
  //
  // Captura no document, antes de o Link do Next tratar o clique. Só intercepta
  // link que sai desta página; âncora interna (#builder-sec-…), target=_blank
  // e clique modificado (ctrl/cmd/meio, que abre em outra aba e não desmonta
  // nada) seguem direto.
  useEffect(() => {
    if (!draftIsDirty || typeof document === "undefined") {
      return;
    }

    const handleClickCapture = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
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
      if (destination.pathname === window.location.pathname) {
        return;
      }

      const proceed = window.confirm(
        t("creatorEditor.builder.confirm.leave"),
      );

      if (!proceed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("click", handleClickCapture, true);
    return () =>
      document.removeEventListener("click", handleClickCapture, true);
  }, [draftIsDirty, t]);

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
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t("creatorEditor.builder.shell.chooseCourse")}
        </p>
        <Link href="/teach" className="button-outline mt-5 px-4 py-2.5 text-sm">
          {t("creatorEditor.builder.navigation.studio")}
        </Link>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="settings-section-card">
        <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorEditor.builder.shell.loading")}</p>
      </section>
    );
  }

  if (error && !course) {
    return (
      <section className="settings-section-card">
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {errorMessage}
        </p>
        <Link href="/teach" className="button-outline mt-5 px-4 py-2.5 text-sm">
          {t("creatorEditor.builder.navigation.studio")}
        </Link>
      </section>
    );
  }

  return (
    <div className="course-builder-shell">
      {/* A Hotmart mostra "esse produto nao esta publicado" no topo do editor
          enquanto e rascunho. Aqui o chip de status ficava escondido entre
          outros dois, e quem entrava pelo construtor nao sabia se o aluno ja
          via o curso. Rascunho e "ajustes pedidos" nunca chegaram ao
          marketplace; "inativo" pode ter aluno matriculado, entao a frase
          "so veem depois de publicar" seria falsa e ele fica de fora. */}
      {course?.status === "draft" || course?.status === "needs_changes" ? (
        <InlineAlert tone="info" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>{t("creatorEditor.builder.shell.unpublished")}</span>
          <Link
            href={`/teach/courses/${encodeURIComponent(courseId ?? "")}/manage`}
            className="inline-flex min-h-11 items-center font-bold text-[var(--color-primary)] underline underline-offset-2"
          >
            {t("creatorEditor.builder.shell.unpublishedLink")}
          </Link>
        </InlineAlert>
      ) : null}
      <section className="course-builder-hero">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={course?.status ?? "draft"} />
            <span className="rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)]/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.summary.percent").replace("{percent}", () => String(readiness.percent))}
            </span>
            {isEditable ? (
              <BuilderSaveStatus
                state={displayedSaveStatus}
                blockedReason={autosaveBlockedReason}
              />
            ) : null}
          </div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("creatorEditor.builder.shell.title")}
          </p>
          {/* h1, não h2: esta é a única página do builder e o título do curso é
              o assunto dela. Enquanto era h2, /teach/builder não tinha h1
              nenhum — quem navega por cabeçalho (leitor de tela, atalho de
              navegação) entrava numa página sem título anunciado, e a árvore
              de headings começava direto no nível 2. */}
          <h1 className="display-title mt-3 text-[clamp(2rem,4vw,3.2rem)] leading-[1.02] text-[var(--color-primary)]">
            {title.trim() || t("creatorEditor.members.untitled")}
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.shell.help")}
          </p>
        </div>
        <div className="course-builder-hero__actions">
          <Link
            href={`/teach/courses/${encodeURIComponent(courseId ?? "")}/manage`}
            className="button-outline px-4 py-2.5 text-sm"
          >
            {t("creatorEditor.builder.navigation.manage")}
          </Link>
          <Link
            href={`/teach/builder/${courseId}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="button-outline px-4 py-2.5 text-sm"
          >
            <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
            {t("creatorEditor.preview.open")}
            <span className="sr-only"> {t("account.opensNewTab")}</span>
          </Link>
          <button
            type="button"
            onClick={saveDraft}
            disabled={!isEditable || isSaving}
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {isSaving ? t("creatorEditor.builder.navigation.saving") : t("creatorEditor.builder.navigation.save")}
          </button>
        </div>
      </section>

      <nav className="course-builder-stepper" aria-label={t("creatorEditor.builder.navigation.steps")}>
        <div className="course-builder-stepper__head">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {t("creatorEditor.builder.navigation.creation")}
            </p>
            <p className="mt-1 truncate text-sm font-semibold leading-snug text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.navigation.next")}{" "}
              <span className="text-[var(--color-primary)]">
                {readiness.next?.hint ?? t("creatorEditor.builder.publish.ready")}
              </span>
            </p>
          </div>
          <div className="course-builder-stepper__meter">
            <div className="flex items-center justify-between gap-4 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
              <span>{t("creatorEditor.builder.summary.checks").replace("{done}", () => String(readiness.doneCount)).replace("{total}", () => String(readiness.total))}</span>
              <span className="text-[var(--color-primary)]">
                {t("creatorEditor.builder.summary.publishPercent").replace("{percent}", () => String(readiness.percent))}
              </span>
            </div>
            {/* A barra media estagios (5) e o chip media checks (7): 40% e
                71% no mesmo cabecalho para o mesmo curso. Agora os tres leem
                o mesmo numero. */}
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-strong)]">
              <div
                data-testid="publish-readiness-bar"
                className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-300"
                style={{ width: `${readiness.percent}%` }}
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
                  <span className="course-builder-step__label">{stage.id === "members" ? t("creatorEditor.members.step") : t(stage.label)}</span>
                  <span className="course-builder-step__sub">{stage.id === "members" ? t("creatorEditor.members.stepHelp") : t(stage.sub)}</span>
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
                {activeTab === "members" ? t("creatorEditor.members.step") : t(builderTabs[selectedTabIndex]?.label ?? "creatorEditor.builder.shell.shortTitle")}
              </p>
              <h3 className="display-title mt-3 text-4xl leading-tight text-[var(--color-primary)]">
                {activeTab === "details"
                  ? t("creatorEditor.builder.steps.details.heading")
                  : activeTab === "members"
                    ? t("creatorEditor.members.heading")
                    : activeTab === "content"
                      ? t("creatorEditor.builder.steps.content.heading")
                      : activeTab === "pricing"
                        ? t("creatorEditor.builder.steps.pricing.heading")
                        : t("creatorEditor.builder.steps.review.heading")}
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
                {activeTab === "details"
                  ? t("creatorEditor.builder.steps.details.help")
                  : activeTab === "members"
                    ? t("creatorEditor.members.help")
                    : activeTab === "content"
                      ? t("creatorEditor.builder.steps.content.help")
                      : activeTab === "pricing"
                        ? t("creatorEditor.builder.steps.pricing.help")
                        : t("creatorEditor.builder.steps.review.help")}
              </p>
            </div>
            <div className="grid gap-2 text-right text-xs font-semibold text-[var(--color-ink-soft)]">
              <span>{t("creatorEditor.builder.summary.modules").replace("{count}", () => String(modules.length))}</span>
              <span>{t("creatorEditor.builder.summary.lessons").replace("{count}", () => String(lessonCount))}</span>
              {totalDurationMinutes > 0 ? (
                <span>{t("creatorEditor.builder.summary.duration").replace("{duration}", () => formattedDuration)}</span>
              ) : null}
              <span>{formattedPrice}</span>
            </div>
          </div>

        {course?.status === "in_review" ? (
          <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.shell.legacy")}
          </p>
        ) : course?.status === "published" ? (
          <p className="mt-5 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.shell.published")}
          </p>
        ) : null}
        {course?.reviewNote ? (
          <div className="mt-5 rounded-[14px] border border-[rgba(178,34,52,0.18)] bg-[rgba(178,34,52,0.04)] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {t("creatorEditor.builder.shell.reviewNote")}
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
            {t("creatorEditor.builder.details.title")}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={!isEditable}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
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
                        aria-label={t("creatorEditor.builder.details.removeOutcome").replace("{index}", () => String(index + 1))}
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
                className="inline-flex w-fit items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] px-3 py-2 text-xs font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus aria-hidden="true" size={14} strokeWidth={2} />
                {t("creatorEditor.builder.details.addOutcome")}
              </button>
            ) : null}
          </div>
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.details.help")}
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
        ) : null}

        {activeTab === "members" && course ? (
          <div className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1">
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  {t("creatorEditor.builder.community.title")}
                </p>
                <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                  {t("creatorEditor.builder.community.help")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={communityEnabled}
                aria-label={t("creatorEditor.builder.community.enable")}
                disabled={!isEditable}
                onClick={() => {
                  setCommunityEnabled((previous) => !previous);
                  setSuccess(null);
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
                ? t("creatorEditor.builder.community.on")
                : t("creatorEditor.builder.community.off")}
            </p>
          </div>
        ) : null}

        {activeTab === "pricing" ? (
          <div
            id="builder-sec-pricing"
            className="scroll-mt-24 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {t("creatorEditor.builder.pricing.setup")}
            </p>
            <div className="mt-4">
              <PlanSelectorCards
                label={
                  <span className="flex items-center gap-2">
                    {t("creatorEditor.builder.pricing.model")}
                    <InlineHelp
                      topic={t("creatorEditor.builder.pricing.helpTopic")}
                      href="/help#course-pricing"
                    >
                      {t("creatorEditor.builder.pricing.help")}
                    </InlineHelp>
                  </span>
                }
                options={paymentModelOptions.map((option) => ({
                  ...option,
                  title: t(option.title),
                  description: t(option.description),
                  features: option.features.map((feature) => t(feature)),
                }))}
                value={paymentType}
                onChange={handlePaymentTypeChange}
                disabled={!isEditable}
              />
            </div>
            {/* A coluna da moeda era 140px fixos. Um <select> nunca fica mais
                estreito que a sua opção mais larga ("BRL - Brazilian Real"),
                então ele empurrava a borda e saía do cartão em telas médias e
                grandes. minmax(0, …) nas duas colunas deixa a grade encolher, e o
                min-w-0 do próprio select (em CurrencySelect) deixa o controle
                acompanhar a coluna em vez de a coluna acompanhar o controle. */}
            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,200px)]">
              <label className="grid min-w-0 gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t("creatorEditor.builder.pricing.price")}
                <input
                  value={priceAmount}
                  onChange={(event) => setPriceAmount(event.target.value)}
                  disabled={!isEditable || paymentType === "free"}
                  inputMode="decimal"
                  placeholder={
                    paymentType === "free" ? t("creatorEditor.builder.pricing.freePlaceholder") : t("creatorEditor.builder.pricing.pricePlaceholder")
                  }
                  className="min-w-0 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
              </label>
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
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4 rounded-[12px] border border-[var(--color-line)] bg-white p-4">
              <div className="max-w-xl">
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  {t("creatorEditor.builder.pricing.installments")}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                  {paymentType !== "one_time"
                    ? t("creatorEditor.builder.pricing.installmentsOneTime")
                    : !cardInstallmentsConfigured
                      ? t("creatorEditor.builder.pricing.installmentsUnavailable")
                      : currency !== "MXN"
                        ? t("creatorEditor.builder.pricing.installmentsCurrency")
                        : t("creatorEditor.builder.pricing.installmentsEligible")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={installmentsEnabled && canConfigureCardInstallments}
                aria-label={t("creatorEditor.builder.pricing.enableInstallments")}
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
                {t("creatorEditor.builder.pricing.release")}
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
                      {t(item.label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                {t("creatorEditor.builder.pricing.interval")}
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
              {t(dripStrategies.find((item) => item.value === dripStrategy)?.detail ?? "")}
              {dripStrategy === "time_drip_custom"
                ? t("creatorEditor.builder.pricing.customHelp")
                : ""}
            </p>
            <label className="mt-4 grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
              {t("creatorEditor.builder.pricing.preview")}
              <select
                value={freePreviewLessonId}
                onChange={(event) => setFreePreviewLessonId(event.target.value)}
                disabled={!isEditable || allLessons.length === 0}
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              >
                <option value="">{t("creatorEditor.builder.pricing.noPreview")}</option>
                {allLessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.moduleTitle} - {lesson.title}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.pricing.listingHelp")}
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
              {t("creatorEditor.builder.curriculum.addModule")}
            </h4>
            <form className="mt-3 grid gap-3" onSubmit={handleAddModule}>
              <input
                value={moduleTitle}
                onChange={(event) => {
                  setModuleTitle(event.target.value);
                  setModuleError(false);
                }}
                disabled={!isEditable}
                aria-label={t("creatorEditor.builder.curriculum.moduleTitle")}
                placeholder={t("creatorEditor.builder.curriculum.moduleTitlePlaceholder")}
                className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              />
              <textarea
                value={moduleSummary}
                onChange={(event) => setModuleSummary(event.target.value)}
                disabled={!isEditable}
                rows={2}
                aria-label={t("creatorEditor.builder.curriculum.moduleDescription")}
                placeholder={t("creatorEditor.builder.curriculum.moduleDescriptionExample")}
                className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              />
              {moduleError ? (
                <p
                  role="alert"
                  className="text-xs font-semibold text-[var(--color-danger-fg)]"
                >
                  {t("creatorEditor.builder.errors.moduleTitle")}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={!isEditable}
                className="button-outline w-fit px-4 py-2.5 text-sm disabled:opacity-60"
              >
                {t("creatorEditor.builder.curriculum.addModule")}
              </button>
            </form>
          </div>

          <div
            id="builder-sec-lessons"
            className="scroll-mt-24 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
              {t("creatorEditor.builder.curriculum.addLesson")}
              <InlineHelp
                topic={t("creatorEditor.builder.curriculum.helpTopic")}
                href="/help#drip-release"
              >
                {t("creatorEditor.builder.curriculum.help")}
              </InlineHelp>
            </h4>
            <form className="mt-3 grid gap-3" onSubmit={handleAddLesson}>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={lessonModuleId}
                  onChange={(event) => setLessonModuleId(event.target.value)}
                  disabled={!isEditable || modules.length === 0}
                  aria-label={t("creatorEditor.builder.curriculum.moduleForLesson")}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                >
                  <option value="">{t("creatorEditor.builder.curriculum.chooseModule")}</option>
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
                  aria-label={t("creatorEditor.builder.curriculum.lessonType")}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                >
                  {lessonTypes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {t(item.label)}
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={lessonTitle}
                onChange={(event) => setLessonTitle(event.target.value)}
                disabled={!isEditable}
                aria-label={t("creatorEditor.builder.curriculum.lessonTitle")}
                placeholder={t("creatorEditor.builder.curriculum.lessonTitle")}
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              />
              <div className="grid gap-3 md:grid-cols-[160px_160px_1fr]">
                <input
                  value={lessonDurationMinutes}
                  onChange={(event) => setLessonDurationMinutes(event.target.value)}
                  disabled={!isEditable}
                  inputMode="numeric"
                  aria-label={t("creatorEditor.builder.curriculum.lessonDuration")}
                  placeholder={t("creatorEditor.builder.curriculum.minutes")}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
                <input
                  value={lessonDripDelayDays}
                  onChange={(event) => setLessonDripDelayDays(event.target.value)}
                  disabled={!isEditable}
                  inputMode="numeric"
                  aria-label={t("creatorEditor.builder.curriculum.delayLabel")}
                  placeholder={t("creatorEditor.builder.curriculum.delayPlaceholder")}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
                <input
                  value={lessonExternalUrl}
                  onChange={(event) => setLessonExternalUrl(event.target.value)}
                  disabled={!isEditable}
                  aria-label={t("creatorEditor.builder.curriculum.externalLabel")}
                  placeholder={t("creatorEditor.builder.curriculum.externalPlaceholder")}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
                />
              </div>
              <textarea
                value={lessonDescription}
                onChange={(event) => setLessonDescription(event.target.value)}
                disabled={!isEditable}
                rows={3}
                aria-label={t("creatorEditor.builder.curriculum.noteLabel")}
                placeholder={t("creatorEditor.builder.curriculum.notePlaceholder")}
                className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
              />
              <textarea
                value={lessonContentText}
                onChange={(event) => setLessonContentText(event.target.value)}
                disabled={!isEditable}
                rows={4}
                aria-label={t("creatorEditor.builder.curriculum.textLabel")}
                placeholder={t("creatorEditor.builder.curriculum.textPlaceholder")}
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
                {t("creatorEditor.builder.curriculum.makePreview")}
              </label>
              <button
                type="submit"
                disabled={!isEditable || modules.length === 0}
                className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
              >
                {t("creatorEditor.builder.curriculum.addLesson")}
              </button>
            </form>
          </div>

          <div className="rounded-[14px] border fine-rule bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                  {t("creatorEditor.builder.curriculum.editor")}
                </p>
                <h4 className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                  {t("creatorEditor.builder.curriculum.editorHelp")}
                </h4>
              </div>
              <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
                {t(lessonCount === 1 ? "creatorEditor.builder.curriculum.lessonOne" : "creatorEditor.builder.curriculum.lessonMany").replace("{count}", () => String(lessonCount))}
              </span>
            </div>

            <div className="mt-4 grid gap-4">
              {modules.length === 0 ? (
                <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
                  {t("creatorEditor.builder.curriculum.empty")}
                </p>
              ) : (
                modules.map((module, moduleIndex) => (
                  <article
                    key={module.id}
                    className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
                  >
                    <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
                      <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                        {t("creatorEditor.builder.curriculum.moduleNumber").replace("{index}", () => String(moduleIndex + 1))}
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
                          aria-label={t("creatorEditor.builder.curriculum.moduleDescriptionNumber").replace("{index}", () => String(moduleIndex + 1))}
                          placeholder={t("creatorEditor.builder.curriculum.moduleDescriptionPlaceholder")}
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
                          {t("creatorEditor.builder.curriculum.up")}
                        </button>
                        <button
                          type="button"
                          onClick={() => moveModule(module.id, "down")}
                          disabled={!isEditable || moduleIndex === modules.length - 1}
                          className="button-outline px-3 py-2 text-xs disabled:opacity-50"
                        >
                          {t("creatorEditor.builder.curriculum.down")}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteModule(module.id)}
                          disabled={!isEditable}
                          className="rounded-[8px] border border-[rgba(178,34,52,0.22)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-accent-fg)] disabled:opacity-50"
                        >
                          {t("creatorEditor.builder.curriculum.delete")}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3">
                      {module.lessons.length === 0 ? (
                        <p className="rounded-[10px] border fine-rule bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                          {t("creatorEditor.builder.curriculum.moduleEmpty")}
                        </p>
                      ) : (
                        module.lessons.map((lesson, lessonIndex) => (
                          <div
                            key={lesson.id}
                            className="grid gap-3 rounded-[14px] border border-[var(--color-line)] bg-white p-4"
                          >
                            <div className="grid gap-3 lg:grid-cols-[1fr_190px_120px_140px_auto] lg:items-end">
                              <label className="grid gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                                {t("creatorEditor.builder.curriculum.lessonTitle")}
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
                                {t("creatorEditor.builder.curriculum.type")}
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
                                      {t(item.label)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="grid gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                                {t("creatorEditor.builder.curriculum.minutes")}
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
                                {t("creatorEditor.builder.curriculum.delayDays")}
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
                                  {t("creatorEditor.builder.curriculum.up")}
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
                                  {t("creatorEditor.builder.curriculum.down")}
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
                              aria-label={t("creatorEditor.builder.curriculum.noteNumber").replace("{index}", () => String(lessonIndex + 1))}
                              placeholder={t("creatorEditor.builder.curriculum.editNotePlaceholder")}
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
                              aria-label={t("creatorEditor.builder.curriculum.textNumber").replace("{index}", () => String(lessonIndex + 1))}
                              placeholder={t("creatorEditor.builder.curriculum.editTextPlaceholder")}
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
                              aria-label={t("creatorEditor.builder.curriculum.externalNumber").replace("{index}", () => String(lessonIndex + 1))}
                              placeholder={t("creatorEditor.builder.curriculum.editExternalPlaceholder")}
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
                                    className="button-solid px-3 py-2 text-xs disabled:opacity-60"
                                    title={t("creatorEditor.builder.curriculum.saveErrorTitle")}
                                  >
                                    {t("creatorEditor.builder.curriculum.saveToUpload")}
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
                                    <Loader2
                                      aria-hidden="true"
                                      size={13}
                                      strokeWidth={2.2}
                                      className="animate-spin"
                                    />
                                    {t("creatorEditor.builder.curriculum.savingLesson")}
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
                                    ? t("creatorEditor.builder.curriculum.previewSelected")
                                    : t("creatorEditor.builder.curriculum.markPreview")}
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => deleteLesson(module.id, lesson.id)}
                                disabled={!isEditable}
                                className="rounded-[8px] border border-[rgba(178,34,52,0.22)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-accent-fg)] disabled:opacity-50"
                              >
                                {t("creatorEditor.builder.curriculum.deleteLesson")}
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
              {t("creatorEditor.builder.publish.title")}
            </p>
            <h4 className="display-title mt-3 flex items-center gap-2 text-3xl text-[var(--color-ink)]">
              {t("creatorEditor.builder.publish.heading")}
              <InlineHelp
                topic={t("creatorEditor.builder.publish.helpTopic")}
                href="/help#course-publishing"
              >
                {t("creatorEditor.builder.publish.help")}
              </InlineHelp>
            </h4>
            <ReadinessGroups
              readiness={readiness}
              className="mt-5 grid gap-6"
              renderItem={(item) => (
                <li
                  key={item.id}
                  className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3"
                >
                  <p className={`text-sm font-semibold ${item.done ? "text-[var(--color-primary)]" : "text-[var(--color-accent-fg)]"}`}>
                    {item.done ? "✓ " : ""}
                    {item.label}
                    {item.optional ? (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                        {t("creatorEditor.builder.publish.optional")}
                      </span>
                    ) : null}
                  </p>
                  {item.done ? null : (
                    <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">{item.hint}</p>
                  )}
                </li>
              )}
            />
            <p className="mt-5 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.publish.checksHelp")}
            </p>
          </div>
        ) : null}

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
            className="button-outline inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-40"
          >
            <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.9} />
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
              className="button-solid inline-flex items-center gap-2 px-4 py-2.5 text-sm"
            >
              {builderTabs[selectedTabIndex + 1].value === "members"
                ? t("creatorEditor.members.continueTo")
                : t("creatorEditor.builder.navigation.continueTo").replace("{step}", () => t(builderTabs[selectedTabIndex + 1].label))}
              <ArrowRight aria-hidden="true" size={14} strokeWidth={1.9} />
            </button>
          ) : (
            <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.publish.finish")}
            </span>
          )}
        </div>
      </section>

      <div className="course-builder-footer">
        <section className="settings-section-card">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("creatorEditor.builder.summary.structure")}
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {t("creatorEditor.builder.summary.structureCount").replace("{modules}", () => String(modules.length)).replace("{lessons}", () => String(lessonCount))}
          </h3>
          <div className="mt-5 grid gap-3">
            {modules.length === 0 ? (
              <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
                {t("creatorEditor.builder.summary.empty")}
              </p>
            ) : (
              modules.map((module, index) => (
                <article
                  key={module.id}
                  className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                    {t("creatorEditor.builder.curriculum.moduleNumber").replace("{index}", () => String(index + 1))}
                  </p>
                  <h4 className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                    {module.title}
                  </h4>
                  <div className="mt-3 grid gap-2">
                    {module.lessons.length === 0 ? (
                      <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                        {t("creatorEditor.builder.summary.noLessons")}
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
                            {getLessonTypeLabel(lesson.type, t)}
                            {lesson.durationMinutes ? ` - ${lesson.durationMinutes} min` : ""}
                            {typeof lesson.dripDelayDays === "number"
                              ? ` - D+${lesson.dripDelayDays}`
                              : ""}
                            {freePreviewLessonId === lesson.id ? t("creatorEditor.builder.summary.preview") : ""}
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
            {t("creatorEditor.builder.publish.title")}
          </p>
          {/* Era uma segunda lista, escrita a mao com regra diferente da aba
              Publish (sem parcelas, outro texto de preco). Mesma fonte agora. */}
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            {t("creatorEditor.builder.summary.percent").replace("{percent}", () => String(readiness.percent))}
          </p>
          <div className="mt-4 grid gap-2 text-sm text-[var(--color-ink-soft)]">
            {readiness.pending.length === 0 ? (
              <p>{t("creatorEditor.builder.publish.passed")}</p>
            ) : (
              readiness.pending.map((item) => <p key={item.id}>{item.hint}</p>)
            )}
          </div>
          {error ? (
            <div
              role="alert"
              className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
            >
              <p>{errorMessage}</p>
              {error.code === "activation" ? (
                <Link
                  href="/teach/activate"
                  className="button-solid mt-3 px-4 py-2 text-xs"
                >
                  {t("creatorEditor.builder.publish.activate")}
                </Link>
              ) : null}
            </div>
          ) : null}
          {success ? (
            <p className="mt-4 info-notice">
              {t(`creatorEditor.builder.success.${success}`)}
            </p>
          ) : null}
          <div className="mt-5 grid gap-3">
            <button
              type="button"
              onClick={saveDraft}
              disabled={!isEditable || isSaving}
              className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {isSaving ? t("creatorEditor.builder.navigation.saving") : t("creatorEditor.builder.navigation.save")}
            </button>
            <button
              type="button"
              onClick={publishCourse}
              disabled={
                !canPublish
                || isSubmitting
                || !readiness.ready
                || !priceFieldIsValid
              }
              className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {isSubmitting ? t("creatorEditor.builder.publish.publishing") : t("creatorEditor.builder.publish.submit")}
            </button>
            <Link href="/teach" className="button-outline px-4 py-2.5 text-sm">
              {t("creatorEditor.builder.navigation.studio")}
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
          onSetFreePreview={() => {
            const next =
              freePreviewLessonId === activeLessonStudioLesson.id
                ? ""
                : activeLessonStudioLesson.id;
            setFreePreviewLessonId(next);
            // A flag do curso sozinha não abre o vídeo para quem ainda não
            // comprou: a busca anônima filtra por is_preview no asset. Sem este
            // passo, marcar a prévia depois do upload deixava a loja com
            // "Video unavailable" e nenhum aviso no estúdio.
            void syncLessonPreviewAssets(course.id, next).catch(() => {
              // Falha aqui não pode derrubar o builder; o publish revalida.
            });
          }}
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

/**
 * O QUE, exatamente, está impedindo o autosave — ou `null` quando nada impede.
 *
 * Antes isto era só um booleano (`canAutosaveDraft`), e por isso o pior modo de
 * falha deste editor era silencioso: com um preço malformado (ou um limite de
 * parcelas inválido, ou um módulo sem aula) o autosave simplesmente parava, e o
 * único sinal na tela era o mesmo selo cinza "Unsaved changes" que também
 * aparece durante o debounce normal de 1,8s. O professor seguia montando
 * módulos e aulas achando que estava tudo gravado — e perdia tudo ao recarregar.
 *
 * `canAutosaveDraft` passou a DERIVAR daqui, e não o contrário: assim um gate
 * novo não entra sem trazer junto o texto que diz ao professor o que corrigir.
 */
type AutosaveBlockedReason = "price" | "installments" | "structure";

export function getAutosaveBlockedReason(input: {
  isEditable: boolean;
  priceFieldIsValid: boolean;
  installmentsAreValid: boolean;
  draftStructureError: boolean;
}): AutosaveBlockedReason | null {
  if (!input.isEditable) {
    // Curso não editável não tem rascunho para perder — não há bloqueio a
    // anunciar, e alarmar aqui seria ruído.
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

function BuilderSaveStatus({
  state,
  blockedReason,
}: {
  state: "pending" | "saving" | "saved" | "error" | "blocked";
  blockedReason?: AutosaveBlockedReason | null;
}) {
  const { t } = useTranslation();
  // Autosave parado por campo inválido. Precisa ser visualmente diferente do
  // "Unsaved changes" neutro — este estado não passa sozinho, e continuar
  // digitando só aumenta o que vai se perder.
  if (state === "blocked") {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(178,34,52,0.22)] bg-[rgba(178,34,52,0.06)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-danger-fg)]"
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
      <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
        <Loader2
          aria-hidden="true"
          size={12}
          strokeWidth={2.2}
          className="animate-spin"
        />
        {t("creatorEditor.builder.save.saving")}
      </span>
    );
  }

  if (state === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
        <span className="size-1.5 rounded-full bg-[var(--color-ink-muted)]" />
        {t("creatorEditor.builder.save.pending")}
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(178,34,52,0.22)] bg-[rgba(178,34,52,0.06)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-danger-fg)]">
        <CloudOff aria-hidden="true" size={12} strokeWidth={2} />
        {t("creatorEditor.builder.save.error")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
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
}: {
  course: TeacherCourse;
  isEditable: boolean;
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
    } catch (uploadError) {
      // O motivo real (teto de tamanho, permissão, conexão) já vem pronto do
      // domínio; o texto genérico mandava conferir "propriedade do curso".
      setError({ kind: "upload", cause: uploadError });
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
            {t("courseMedia.assetKinds.course_cover")}
          </p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--color-ink-soft)]">
            {t("creatorEditor.builder.cover.help").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))}
          </p>
        </div>
        {course.coverImageUrl ? (
          <span className="inline-flex items-center gap-1 rounded-[8px] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-primary)]">
            <CheckCircle2 size={12} aria-hidden /> {t("creatorEditor.members.coverSet")}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-start">
        <div className="relative aspect-video overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white">
          {course.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={course.coverImageUrl}
              alt={t("creatorEditor.builder.cover.alt").replace("{title}", () => course.title || t("creatorEditor.builder.cover.course"))}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[var(--color-ink-soft)]">
              <ImageIcon size={22} aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">
                {t("creatorEditor.members.noCover")}
              </span>
            </div>
          )}
        </div>

        <div className="grid content-start gap-2">
          <label
            className={`inline-flex w-fit items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-primary)] ${
              !isEditable || isUploading
                ? "pointer-events-none opacity-60"
                : "cursor-pointer"
            }`}
          >
            <UploadCloud size={16} aria-hidden />
            {isUploading
              ? t("creatorEditor.members.uploading")
              : course.coverImageUrl
                ? t("creatorEditor.members.replaceCover")
                : t("creatorEditor.members.uploadCover")}
            <input
              key={fileInputKey}
              type="file"
              accept={courseAssetAcceptTypes.course_cover}
              disabled={!isEditable || isUploading}
              onChange={handleFile}
              className="sr-only"
            />
          </label>

          {progress ? <UploadProgressNote progress={progress} /> : null}

          {error ? (
            <p role="alert" className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-xs font-semibold text-[var(--color-danger-fg)]">
              {error.kind === "invalid-image"
                ? t("creatorEditor.members.invalidImage").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))
                : getCourseAssetUploadErrorMessage(error.cause, supabaseUploadLimitBytes, t)}
            </p>
          ) : null}

          {!course.coverImageUrl && !error && !progress ? (
            <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.cover.emptyHelp")}
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
          <div className="inline-flex w-fit gap-1 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1">
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
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-[8px] px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
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
          {t("creatorEditor.members.title")}
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            disabled={!isEditable}
            maxLength={80}
            placeholder={course.title || t("creatorEditor.members.titlePlaceholder")}
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
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
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
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
            className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
          />
          <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
            {description.length}/2000
          </span>
        </label>
      </div>

      <div className="grid gap-3 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 lg:sticky lg:top-24">
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
            borderRadius: 10,
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
        <Link
          href={`/teach/builder/${courseId}/preview`}
          target="_blank"
          rel="noopener noreferrer"
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

    if (!isAllowedCourseAssetFile(file, "members_cover")) {
      setError({ kind: "invalid-image" });
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
    } catch (uploadError) {
      setError({ kind: "upload", cause: uploadError });
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
            {t("creatorEditor.members.cover")}
          </p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--color-ink-soft)]">
            {t("creatorEditor.members.coverHelp").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))}
          </p>
        </div>
        {coverUrl ? (
          <span className="inline-flex items-center gap-1 rounded-[8px] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-primary)]">
            <CheckCircle2 size={12} aria-hidden /> {t("creatorEditor.members.coverSet")}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-start">
        <div className="relative aspect-video overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- members cover is an arbitrary CourseAsset URL
            <img
              src={coverUrl}
              alt={t("creatorEditor.members.coverAlt").replace("{courseTitle}", () => course.title || t("publicCourses.course"))}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[var(--color-ink-soft)]">
              <ImageIcon size={22} aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">
                {t("creatorEditor.members.noCover")}
              </span>
            </div>
          )}
        </div>

        <div className="grid content-start gap-2">
          <label
            className={`inline-flex w-fit items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-primary)] ${
              !isEditable || isUploading
                ? "pointer-events-none opacity-60"
                : "cursor-pointer"
            }`}
          >
            <UploadCloud size={16} aria-hidden />
            {isUploading
              ? t("creatorEditor.members.uploading")
              : coverUrl
                ? t("creatorEditor.members.replaceCover")
                : t("creatorEditor.members.uploadCover")}
            <input
              key={fileInputKey}
              type="file"
              accept={courseAssetAcceptTypes.members_cover}
              disabled={!isEditable || isUploading}
              onChange={handleFile}
              className="sr-only"
            />
          </label>

          {coverUrl && isEditable && !isUploading ? (
            <button
              type="button"
              onClick={onRemove}
              className="min-h-11 w-fit text-xs font-semibold text-[var(--color-accent-fg)] underline-offset-2 hover:underline"
            >
              {t("creatorEditor.members.removeCover")}
            </button>
          ) : null}

          {progress ? <UploadProgressNote progress={progress} /> : null}

          {error ? (
            <p role="alert" className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-xs font-semibold text-[var(--color-danger-fg)]">
              {error.kind === "invalid-image"
                ? t("creatorEditor.members.invalidImage").replace("{limit}", () => formatCourseAssetSize(supabaseUploadLimitBytes))
                : getCourseAssetUploadErrorMessage(error.cause, supabaseUploadLimitBytes, t)}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
