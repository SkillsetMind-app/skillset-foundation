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

// "Como as pessoas vao pagar?": tres cartoes, cada um com um exemplo em
// numeros na moeda escolhida. No evento ao vivo o pagamento unico se chama
// Ingresso.
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
// Ate quantas parcelas: 2 a 12, mais o valor ja gravado se for outro.
const splitPaymentCounts = Array.from({ length: 11 }, (_, index) => index + 2);

// Ctrl/Cmd/Shift/Alt ou botao que nao e o esquerdo: o navegador abre outra aba
// e esta aqui nao navega. Nada que dependa de "a pessoa saiu daqui" pode rodar.
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

// Tipo proprio no arrastar: soltar texto qualquer numa linha de modulo nao
// move nada.
const lessonDragType = "application/x-skillset-lesson";

// Liberacao que recalcula a posicao da aula a cada leitura (lesson_is_released
// no banco e getLessonUnlockState): mover muda quando a aula abre e pode
// trancar de novo quem ja tinha acesso. time_drip_custom usa o dia de cada aula.
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
      // Sem forma gravada, sem valor e gratis: e como o checkout e o banco leem.
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
  // Aula com envio em curso: a pagina dela continua na tela (mesma instancia,
  // barra de progresso intacta) e a aba de conteudo fica ativa ate o envio
  // acabar, mesmo que a URL mude (voltar do navegador). Depois volta a seguir a URL.
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
      // Trocar de aba no meio de um envio desmontaria o estudio e deixaria o
      // envio sem dono.
      if (uploadingLesson) {
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", nextTab);
      // Fora da aba de conteudo a aula nao esta aberta: sem ?lesson, a lista de
      // arquivos do curso volta a ser buscada e a prontidao do Publish ve o que mudou.
      if (nextTab !== "content") {
        params.delete("lesson");
      }
      router.push(`/teach/builder?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, uploadingLesson],
  );
  // Pagina do modulo: so a URL muda (?module=M), como nas abas. Sem rota nova,
  // o modulo divide o rascunho, o autosave e o botao Salvar com o resto.
  const requestedModuleId = searchParams.get("module");
  // Pagina da aula (?lesson=L ao lado do ?module=M): a mesma ideia do modulo.
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
  // Payouts e verificacao: so o Manage sabia; aqui a pessoa clicava em
  // Publish e descobria pelo erro do servidor.
  const {
    account: publishGates,
    planId,
    loaded: gatesLoaded,
    verificationStatus,
    stripeConnectCountry,
  } = usePublishGates(user);
  // "Agora nao" na oferta do selo devolve o foco ao titulo do painel "Publicado!".
  const successNoticeRef = useRef<HTMLHeadingElement>(null);
  // Apagar modulo/aula, mover com liberacao por posicao e sair com rascunho
  // sujo perguntam na janela da plataforma (era o window.confirm).
  const { ask, dialog: confirmDialog } = useConfirm();
  // Saida ja confirmada: o clique repetido no mesmo link passa pela guarda.
  const leaveConfirmedRef = useRef(false);
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  // O que o produto entrega (courses.product_format): muda a aba de conteudo
  // e o que publicar cobra, como em publish_teacher_course.
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
  // "Oferecer tambem plano anual": o valor do ano so serve para a conta da
  // economia e para levar ao "Adicionar outro preco" (Ofertas); a etapa de
  // preco nao grava um segundo preco escondido.
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
  // ?welcome=1 vem do atalho da Agenda ("Add a short welcome lesson"): o
  // primeiro modulo ja nasce com nome.
  const [moduleTitle, setModuleTitle] = useState(() =>
    searchParams.get("welcome") === "1" ? t("creatorEditor.builder.curriculum.welcomeModule") : "",
  );
  // O nome ja entrou no formulario: o parametro sai da URL para uma recarga
  // (ou a troca de aba, que copia os parametros) nao abrir outro "Welcome".
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
  // Os dois formularios agora sao pedidos, nao paisagem: a lista de modulos e
  // que abre a aba. Cada modulo e uma linha; o clique abre a pagina dele.
  const [isModuleFormRequested, setIsModuleFormOpen] = useState(false);
  const [lessonFormModuleId, setLessonFormModuleId] = useState("");
  // Seletor "Move to module…" por aula: escolher so marca o destino e o botao
  // Move aplica (no Chrome/Edge as setas do teclado disparam change na hora).
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [moveStatus, setMoveStatus] = useState<{ moduleId: string; text: string } | null>(null);
  // Modulo onde a aula entrou: "Lesson added" so na pagina dele. Mover limpa o
  // `success`, entao a linha sempre mostra o aviso mais novo.
  const [lessonAddedIn, setLessonAddedIn] = useState<string | null>(null);
  // Lista de modulos: o anuncio do Up/Down e a linha que recebe a aula arrastada.
  const [reorderStatus, setReorderStatus] = useState("");
  const [dragOverModuleId, setDragOverModuleId] = useState<string | null>(null);
  // "Mais acoes" aberto (uma aula por vez) na pagina do modulo.
  const [lessonMenuId, setLessonMenuId] = useState<string | null>(null);
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false);
  const [error, setError] = useState<BuilderError | null>(null);
  // Onde o erro aparece: perto do botao que o causou. Num cartao so, no fim
  // da pagina, o "Save draft" do topo parecia nao fazer nada. O rodape saiu:
  // o que nao vem do Publish nem da biblioteca de midia cai no topo.
  const [errorSlot, setErrorSlot] = useState<"hero" | "publish" | "media">("hero");
  const [success, setSuccess] = useState<"lessonAdded" | "draftSaved" | "published" | null>(null);
  const errorMessage = error
    ? t(`creatorEditor.builder.errors.${error.code}`)
      .replace("{module}", () => String(error.moduleIndex ?? ""))
      .replace("{lesson}", () => String(error.lessonIndex ?? ""))
      .replace("{zero}", () => formatZeroPrice(currency))
    : null;
  const [isLoading, setIsLoading] = useState(true);
  // ?created=1 vem da tela de criar (catalogo de movimento, item 7): a faixa
  // "Rascunho salvo. Proximo: ..." aparece uma vez, quando o curso termina de
  // carregar. O parametro sai da URL nessa hora, para uma recarga ou a troca
  // de aba (que copia os parametros) nao repetir o marco. Some em 4s ou no X
  // (o relogio mora em CreatedStrip).
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
  // A aula aberta vem da URL (?module=M&lesson=L), como o modulo: o voltar do
  // navegador funciona. Aula que nao existe (mais) nesse modulo cai na pagina
  // do modulo, nunca numa tela vazia.
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
  // Com envio em curso, a aula do envio manda (a URL pode ter mudado).
  const activeLessonStudio: ActiveLessonStudio =
    uploadingLesson
    && modules.some(
      (module) =>
        module.id === uploadingLesson.moduleId
        && module.lessons.some((lesson) => lesson.id === uploadingLesson.lessonId),
    )
      ? uploadingLesson
      : urlLessonStudio;
  // Envio que falhou com a URL em outro lugar: a pagina da aula fica ate a URL
  // voltar para ela (router.replace) e so entao solta, sem remontar, com o erro
  // na tela.
  if (
    uploadingLesson?.failed
    && requestedTab === "content"
    && urlLessonStudio?.lessonId === uploadingLesson.lessonId
  ) {
    setUploadingLesson(null);
  }
  const activeLessonId = activeLessonStudio?.lessonId ?? null;
  // A faixa "proximo: sua primeira aula" sai quando uma aula abre, por
  // qualquer caminho (ali ela ja cumpriu o papel), e fora da aba de conteudo:
  // presa no pe da tela, ela cobria o "Continue to…" e os botoes do rodape.
  if (createdStripOpen && (activeLessonId || activeTab !== "content")) {
    setCreatedStripOpen(false);
  }
  // Abre a pagina da aula recem-criada quando o eco confirma o save. Refeita a
  // cada render para ver a URL atual.
  const openPendingLessonRef = useRef<(target: { moduleId: string; lessonId: string }) => void>(
    () => {},
  );
  const [courseAssets, setCourseAssets] = useState<CourseAsset[]>([]);
  // So com a lista de arquivos na mao a prontidao cobra conteudo em toda aula:
  // antes (ou se a busca falhar) o item fica de fora, como no Manage, em vez de
  // acusar de vazia uma aula que so tem envio ou PDF.
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
  // Navegacao de modulo pedida pela pessoa (linha, trilha ou modulo novo).
  // Nula na primeira hidratacao: abrir o builder ja num modulo nao rouba foco.
  const moduleNavigationRef = useRef<{ returnTo: string | null } | null>(null);
  // Espelho de `draftIsDirty` para o callback do realtime, que nao ve o render.
  const draftDirtyRef = useRef(false);
  // Ultimo snapshot que chegou com rascunho sujo e ficou de fora. Vale se o
  // rascunho voltar a ficar limpo sem save nosso; um save nosso o descarta.
  const skippedSnapshotRef = useRef<TeacherCourse | null>(null);
  // Rascunho local para o callback do realtime: so abre estudio de aula que
  // ainda existe aqui.
  const localModulesRef = useRef<TeacherCourseModule[]>([]);
  // Saves nossos no ar (autosave, Salvar, Publicar). Aqui em cima porque o
  // efeito do snapshot pulado tambem le.
  const inFlightSavesRef = useRef(0);
  // Timer do debounce do autosave, para a descarga ao sair poder cancela-lo.
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  // Estudio aberto: grava (sem prompt) o link digitado e ainda sem blur.
  const studioLeaveFlushRef = useRef<(() => void) | null>(null);
  // Descarga ao sair, refeita a cada render para ver o estado atual.
  const flushOnLeaveRef = useRef<(withStudio: boolean) => void>(() => {});
  // Buscas da lista de arquivos do curso: vale so a mais recente. Um contador,
  // e nao "cancelar ao mudar dependencia": abrir a aula logo depois (link
  // direto, quando os modulos chegam) descartava a primeira busca para sempre.
  const assetsRequestRef = useRef(0);
  // Busca o curso de novo sem esperar o Realtime. O construtor so sabe que um
  // modulo/aula foi gravado pelo snapshot do curso; com o eco do Realtime como
  // unica fonte, o upload da capa do modulo e o botao de video da aula nova
  // ficaram travados enquanto o Realtime recusava o canal (06/10).
  const courseReloadRef = useRef<(() => Promise<void>) | null>(null);

  // Copia o snapshot do servidor para o rascunho. So setters (estaveis), entao
  // serve ao callback do realtime e ao efeito que aplica o snapshot pulado.
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
    // Todo snapshot passa aqui, inclusive o eco do nosso autosave. Voltar
    // sempre para o 1o modulo mandava a aula seguinte para o modulo errado.
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
          // Aula que ja nao existe no rascunho (apagada antes do eco): abrir o
          // estudio dela deixava um estudio "fantasma", sem modal, que travava
          // a abertura da proxima aula e a recarga dos arquivos do curso.
          const stillInDraft = localModulesRef.current.some(
            (module) =>
              module.id === pendingStudio.moduleId &&
              module.lessons.some((lesson) => lesson.id === pendingStudio.lessonId),
          );
          if (stillInDraft) {
            // Nunca troca uma aula ja aberta: o estudio e por id de aula, e trocar
            // no meio de um envio perderia a barra de progresso e a trava de sair.
            openPendingLessonRef.current(pendingStudio);
            setSuccess(null);
          }
        }

        // O snapshot pode chegar atras do rascunho: eco de um save anterior com
        // autosave no ar, debounce correndo ou aula/modulo recem-criado. Antes,
        // sobrescrever apagava a edicao local e o autosave nunca a regravava.
        // Com rascunho sujo, o local manda e o proximo autosave grava por cima.
        // ponytail: local vence enquanto houver edicao pendente, ate sobre
        // mudanca de outra aba; resolver conflito entre abas se virar caso real.
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
    // Com a aula aberta na aba de conteudo, o estudio cuida dos arquivos (e
    // avisa por onAssetsChanged). Em qualquer outra aba a lista e buscada.
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

  // Evento ao vivo: a sessao agendada e o conteudo. Mesma leitura da Agenda,
  // so as sessoes deste produto ainda de pe e por vir: a que ja passou nao
  // se vende (publish_teacher_course cobra o mesmo).
  const [courseSessions, setCourseSessions] = useState<CourseEvent[] | null>(null);
  const ownerUid = user?.uid;
  useEffect(() => {
    if (!ownerUid || !courseId || productFormat !== "live_event") {
      return;
    }
    return subscribeToTeacherCourseEvents(
      ownerUid,
      (events) => setCourseSessions(upcomingSessionsOf(events, courseId, Date.now())),
      // Sem a lista, o item some da prontidao e o servidor segue cobrando.
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
  const isEditable = Boolean(isOwner && course && teacherCanEditCourse(course.status));
  const canPublish = Boolean(
    isOwner && course && teacherCanPublishCourse(course.status),
  );
  // Parcelar so aparece onde funciona, pela mesma regra do checkout: flag
  // ligada, venda em MXN e conta Stripe do Mexico. Fora disso a opcao nao
  // existe na tela (o valor gravado fica como esta).
  const showSplitPayments =
    paymentType === "one_time"
    && canSplitPayments({
      featureEnabled: isPublicFeatureEnabled("payments.cardInstallments"),
      currency,
      stripeAccountCountry: stripeConnectCountry,
    });
  // Com preco em Outros precos, o checkout cobra a oferta principal
  // (resolveCoursePrice), nao estes campos: a etapa de preco so mostra o que a
  // pagina cobra e leva para la. null = ainda nao sabe: sem saber o preco
  // principal, os cartoes nao aparecem (mudariam so o construtor). Rele ao
  // voltar para a aba: outra aba pode ter criado o preco principal.
  const [checkoutOffers, setCheckoutOffers] = useState<ProductOffer[] | null>(null);
  const [offersFailed, setOffersFailed] = useState(false);
  // "Try again" da falha: a mesma leitura, de novo (antes só recarregando a página).
  const [offersAttempt, setOffersAttempt] = useState(0);
  // De que curso é a lista na tela: uma releitura que falha não apaga a lista
  // boa do MESMO curso (a regra de toda lista); de outro curso, apaga.
  const offersCourseRef = useRef<string | null>(null);
  // Com a lista na tela, o "Try again" não tira o aviso enquanto lê: ele fica,
  // com o botão em espera, até a resposta. Sem lista, volta o esqueleto.
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
    if (!courseId) {
      return;
    }
    let alive = true;
    let latest = 0;
    const load = () => {
      const request = ++latest;
      fetch(`/api/teach/offers?courseId=${encodeURIComponent(courseId)}`, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { offers?: Omit<ProductOffer, "courseId">[]; warning?: string } | null) => {
          // A rota devolve 200 com warning quando a leitura falha: nao e "sem ofertas".
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
            // A releitura do foco falhava e apagava os cartoes que estavam
            // certos na tela. So a tela muda: o checkout le o preco no servidor.
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
  }, [courseId, offersAttempt]);
  const offerPrice = course && checkoutOffers ? resolveCoursePrice(course, checkoutOffers) : null;
  const chargedByOffer = offerPrice?.source === "offer" ? offerPrice : null;
  const paymentChoice = paymentChoiceOf(paymentType);
  const paymentChoices = paymentChoicesFor(productFormat, paymentChoice);
  const paymentChoiceFits = paymentTypeFitsFormat(productFormat, paymentType);
  const lessonCount = countCourseLessons(modules);
  // "1 module", "2 modules": a tela dizia "1 modules, 1 lessons" (QA visual em
  // producao, 08/09). O singular tem chave propria, como no hub do curso.
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
  // Curso sem nenhum modulo abre ja com o formulario: nao ha lista para olhar.
  const isModuleFormOpen = isModuleFormRequested || modules.length === 0;
  // Id desconhecido ou de modulo apagado cai na lista, nunca em tela vazia.
  const activeModuleIndex = requestedModuleId
    ? modules.findIndex((module) => module.id === requestedModuleId)
    : -1;
  const activeModule = activeModuleIndex >= 0 ? modules[activeModuleIndex] : null;
  const activeModuleId = activeModule?.id ?? null;
  // Trocou de modulo (clique, voltar, avancar): o aviso de "movida" era do
  // modulo anterior e sai. Ajuste no render, o padrao do React para estado que
  // depende do valor anterior, em vez de setState num efeito.
  const [moveStatusScope, setMoveStatusScope] = useState(activeModuleId);
  if (moveStatusScope !== activeModuleId) {
    setMoveStatusScope(activeModuleId);
    setMoveStatus(null);
  }

  // Os links usam scroll={false}; sem isto o foco caia no <body> e o topo da
  // pagina do modulo ficava fora da tela. Abrir: rola ate o cartao e foca o
  // titulo. Voltar: foca a linha do modulo de onde a pessoa saiu.
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

  // A mesma regra (#373) para a pagina da aula. Entrar: rola ate o cartao e
  // foca o titulo da aula. Sair (Done, trilha, voltar): foca o botao da aula de
  // onde a pessoa saiu. Nunca na primeira carga: link direto ou recarga nao
  // roubam o foco.
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
  // Produto no ar, cobrado e sem valor: gravar isso abria a entrada gratis
  // (create_free_course_enrollment le preco nulo como zero). Nao salva ate ter
  // valor ou virar Gratis. Com oferta cobrando, o campo nem aparece e a
  // entrada gratis ja e recusada pelo preco pago.
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
  // Uma lista so de "o que falta para publicar", a mesma da aba Publish e do
  // Manage. Antes o construtor montava duas listas proprias e a barra do
  // cabecalho media outra coisa (estagios): tres numeros para um curso so.
  // Le do payload normalizado, entao um preco digitado errado conta como
  // preco ausente, igual ao que o servidor gravaria.
  // Aula sem video, texto nem arquivo trava o Publish. O servidor cobra a
  // mesma regra em publish_teacher_course (20260927020000); aqui a pessoa ve
  // antes de clicar quais aulas faltam.
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
  // A linha "4 of 7 checks · 57%" e o nome da barra que a acompanha.
  const readinessText = t("creatorEditor.builder.summary.checks")
    .replace("{done}", () => String(readiness.doneCount))
    .replace("{total}", () => String(readiness.total))
    .replace("{percent}", () => String(readiness.percent));
  // Falta so a taxa: o botao principal vira "Activate and publish" e leva ao
  // checkout com este curso, para a volta cair de novo aqui.
  const needsActivation = readiness.pending.some((item) => item.id === "activation");
  const readyToPublish = readiness.pending.every((item) => item.id === "activation");
  const activateHref = `/teach/activate?courseId=${encodeURIComponent(courseId ?? "")}`;
  const starterLesson = modules[0]?.lessons[0];
  // Pagamentos prontos, a carteira oferece a volta para esta aba Publish.
  const payoutsHref = `/account/payments?returnTo=${encodeURIComponent(
    `/teach/builder?courseId=${encodeURIComponent(courseId ?? "")}&tab=review`,
  )}#stripe-connect`;
  // Produto no ar nao publica de novo (teacherCanPublishCourse): no lugar do
  // "Publish product" apagado e mudo, a frase que diz por que.
  const isLive = course?.status === "published";
  // Quem nunca assinou vai aos planos (o teste gratis mora la), como na Home do
  // professor; "Manage plan" abria os recibos. Quem ja teve plano gerencia.
  const planLink = planId === "free"
    ? { href: "/account/plans", label: t("billingCheckout.seePlans") }
    : { href: "/account/billing?tab=subscriptions", label: t("creatorEditor.builder.publish.managePlan") };
  // Erro de preco ou de parcelas sai no proprio campo quando ele esta na tela
  // (aria-invalid + a frase ligada por aria-describedby); fora da aba de
  // preco, no alerta perto do botao clicado.
  const priceFieldShown = activeTab === "pricing" && Boolean(checkoutOffers) && !chargedByOffer && paymentChoice !== "free";
  const priceFieldError = priceFieldShown
    && (error?.code === "price" || error?.code === "livePrice" || error?.code === "paidPrice");
  const installmentsFieldError = priceFieldShown && showSplitPayments && installmentsEnabled
    && (error?.code === "installmentsSave" || error?.code === "installmentsPublish");
  const activeLessonStudioModule = activeLessonStudio
    ? modules.find((module) => module.id === activeLessonStudio.moduleId) ?? null
    : null;
  // A aula do e-book: a primeira que existir (o produto nasce com uma).
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
  // Mesma condicao que escolhe renderLessonPage() na aba Curriculum.
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
  // O resumo diz o que a pagina cobra: com preco principal, ele; sem saber
  // ainda, nenhum preco.
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
    !checkoutOffers
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
  // Valor na moeda escolhida: os exemplos dos cartoes, a previa das parcelas
  // e a economia do anual. Centavos so quando existem ("3x of $100").
  const formatMoney = (amountMinor: number, moneyCurrency = currency) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: moneyCurrency.toUpperCase(),
      minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  // Sem aula ainda o seletor fica apagado: a linha embaixo diz por quê (F-12).
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
    {/* Fora do <label>: dentro, a frase entraria no nome do campo. */}
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
  // A mesma conta do checkout (buildInstallmentPlan): o maior numero de
  // parcelas e quanto fica cada uma.
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
    // Curso: modulo e aula. Os outros tipos: o que a prontidao cobra deles.
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
  // "Acabou de ficar pronto" so conta depois que todas as leituras voltaram:
  // payouts e verificacao, os arquivos do curso e, no evento, as sessoes.
  // Antes disso os falsos iniciais virariam festa ao chegar (abrir
  // ?tab=review acendia "Stripe payouts" sem ninguem ter feito nada).
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
  // A aba de abertura e a linha de base: so a TROCA de aba anima o painel. A
  // primeira carga entra parada (nada de opacidade 0 no que vira LCP).
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
    // Com save nosso no ar, o guardado pode ser o eco dele mesmo: aplicar
    // ressuscitava o save e engolia uma volta exata ao estado anterior. O
    // sucesso descarta o guardado; a falha o aplica (em persistDraft).
    if (draftIsDirty || !skipped || inFlightSavesRef.current > 0) {
      return;
    }
    // O rascunho voltou a ficar limpo sem save nosso (desfez a edicao, ou o
    // autosave foi bloqueado/falhou e a pessoa voltou atras). O servidor pode
    // ter coisa mais nova, de outra aba ou da pagina de vendas no Manage, que
    // usa a mesma RPC de troca total. Sem isto, a proxima edicao qualquer
    // gravava a copia velha inteira por cima.
    skippedSnapshotRef.current = null;
    // Assincrono: setState direto no corpo do efeito e vetado (react-hooks).
    // O microtask confere de novo: entre agendar e rodar, uma edicao pode ter
    // comitado (o React esvazia os efeitos pendentes antes do render de uma
    // digitacao). Aplicar as cegas trocava essa edicao pelo snapshot velho e
    // marcava como salvo. Sujo, ou com save no ar, o snapshot volta ao
    // guardado (sem trocar um mais novo): o proximo save bem-sucedido o
    // descarta, e um save que falha o aplica (em persistDraft).
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

  // Clicar no cartao ja escolhido nao muda nada: um produto antigo que cobra
  // por ano continua anual dentro de "Mensalidade".
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

    // Saindo do Gratis o campo nascia com "0"; vazio mostra o exemplo.
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
    // O modulo recem-criado abre na pagina dele: e nele que a proxima aula entra.
    moduleNavigationRef.current = { returnTo: null };
    router.push(builderModuleHref(nextModule.id), { scroll: false });
    setIsModuleFormOpen(false);
    setError(null);
    setSuccess(null);
  }

  // A porta única para escolher a aula de amostra: página da aula, seletor da
  // aba Pricing, menu da linha e caixa de aula nova. Só a página da aula
  // sincronizava os vídeos; nas outras três a loja respondia "Video
  // unavailable" para a amostra, e ao trocar de A para B os vídeos de A
  // seguiam marcados como amostra (is_preview) e os de B não. "" = nenhuma.
  function chooseFreePreviewLesson(next: string) {
    if (next === freePreviewLessonId) {
      return;
    }
    setFreePreviewLessonId(next);
    if (!course) {
      return;
    }
    // A flag do curso sozinha não abre o vídeo para quem ainda não
    // comprou: a busca anônima filtra por is_preview no asset. Sem este
    // passo, marcar a prévia depois do upload deixava a loja com
    // "Video unavailable" e nenhum aviso no estúdio.
    void syncLessonPreviewAssets(course.id, next).catch(() => {
      // Falha aqui não pode derrubar o builder. Nada mais refaz esta
      // sincronia (o publish não a chama): a amostra fica em "Video
      // unavailable" até o professor escolhê-la de novo, e nada mais depende dela.
    });
  }

  function openLessonForm(moduleId: string) {
    // `lessonModuleId` era o select "Choose module"; agora quem responde por ele
    // e a linha do modulo, e `handleAddLesson` segue igual.
    setLessonFormModuleId(moduleId);
    setLessonModuleId(moduleId);
  }

  function handleAddLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isEditable) {
      return;
    }

    // O modulo do formulario aberto manda; `lessonModuleId` fica de reserva.
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

    // Aula nova nasce so com o titulo: tipo, drip, nota, texto e link sairam
    // do formulario (decisao de 14/09). O conteudo entra em "Edit content".
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
      // A aula nova ainda não tem vídeo, mas a sincronia fecha o da anterior.
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

  // A biblioteca de midia pede "media": a falha sai embaixo dela, onde se
  // apagou ou enviou o arquivo. Aula e capa do modulo caem no topo.
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

  // "Moved X to position N": Up/Down trocavam as linhas sem movimento e sem
  // anuncio (so mover para outro modulo anunciava).
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

  // Roda depois da janela de confirmar: le o estado de agora (atualizacoes
  // funcionais), nao o capturado no clique.
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
    // A linha (e o botao que tinha o foco) some: o foco vai para o titulo da aba.
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
    // Ja no ref, sem esperar o render: a descarga ao sair (com o builder
    // desmontando) le daqui o link que o estudio acabou de gravar.
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
      // A regiao da pagina do modulo que ja anuncia o "Move to module".
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

  // Mover para outro modulo: vai para o fim dele, como o mesmo objeto (mesmo
  // id). O estudio a abrir (aula recem-criada) passa a mirar o modulo novo;
  // senao procuraria a aula no modulo antigo e ficaria sem aula. (Mover so
  // existe na pagina do modulo e na lista: nunca com a pagina da aula aberta.)
  // `onMoved` roda so se a aula mudou de modulo (o botao Move limpa o destino,
  // anuncia e leva o foco).
  function moveLessonToModule(lessonId: string, targetModuleId: string, onMoved?: () => void) {
    if (!isEditable) {
      return;
    }

    // Aula que nao e deste curso (arrastada de outra aba): nada muda, e nem
    // aparece a confirmacao.
    if (!modules.some((module) => module.lessons.some((lesson) => lesson.id === lessonId))) {
      return;
    }

    const target = modules.find((module) => module.id === targetModuleId);
    // Ja esta nesse modulo (ex.: soltou na propria linha): nada muda.
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

    // ponytail: com liberacao por posicao, mover pode trancar de novo quem ja
    // tinha acesso, porque a posicao e recalculada a cada leitura. Por ora a
    // pessoa confirma; a correcao de raiz (aula concluida conta como liberada,
    // no drip-policy.ts e em lesson_is_released) precisa de migration e fica
    // agendada a parte.
    if (positionalDripStrategies.has(dripStrategy)) {
      ask({
        title: t("creatorEditor.builder.confirm.moveTitle"),
        body: t("creatorEditor.builder.curriculum.moveConfirm"),
        confirmLabel: t("creatorEditor.builder.confirm.moveAction"),
        run: () => {
          move();
          // Com a janela aberta o resto da pagina e inerte: o foco que
          // `onMoved` leva so pega depois que ela fecha.
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

    // Depois da janela: o estado de agora, nao o capturado no clique.
    setFreePreviewLessonId((current) => (current === lessonId ? "" : current));

    // Aula apagada antes do eco do save que a levou: o eco nao pode abrir o
    // estudio dela.
    if (pendingLessonStudioRef.current?.lessonId === lessonId) {
      pendingLessonStudioRef.current = null;
    }

    setSuccess(null);
    // A linha (e o botao que tinha o foco) some: o foco vai para o titulo do modulo.
    window.setTimeout(() => document.getElementById("builder-module-heading")?.focus(), 0);
  }

  // Autosave e o botao Salvar podem estar no ar ao mesmo tempo. O selo so vira
  // "Saved" quando a ULTIMA gravacao pendente volta; antes, a primeira a voltar
  // pintava "Saved" com a outra ainda no ar.
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
        // O servidor agora tem o nosso rascunho; o proximo eco traz o resto.
        skippedSnapshotRef.current = null;
        if (inFlightSavesRef.current === 1) {
          setAutosaveState("saved");
          // Ultimo save no ar: busca o curso em vez de esperar o eco. O contador
          // de geracao do subscribe descarta uma resposta mais velha que o eco.
          // ponytail: com o Realtime saudavel, eco e recarga buscam duas vezes;
          // tirar a recarga so se o custo aparecer.
          void courseReloadRef.current?.();
        }
      } finally {
        inFlightSavesRef.current -= 1;
        // Save nosso falhou com o rascunho limpo: o snapshot guardado durante
        // o save (que o efeito nao aplica com save no ar) vale agora. No
        // sucesso ele ja foi descartado acima, entao aqui nao sobra nada.
        const skipped = skippedSnapshotRef.current;
        if (inFlightSavesRef.current === 0 && skipped && !draftDirtyRef.current) {
          skippedSnapshotRef.current = null;
          applyServerDraft(skipped);
        }
      }
    },
    [courseId, applyServerDraft],
  );

  // Pagina do modulo (?module=M). Funcao de render, nao componente: le o mesmo
  // estado do builder, entao nao existe segunda copia do rascunho.
  // Evento ao vivo: a sessao vem antes das aulas, que viram a gravacao
  // opcional (replay). Marcar e editar continuam na Agenda.
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

  // E-book: so o envio de arquivos da aula que nasceu com o produto. O
  // comprador baixa ali; modulo, aula e video nao aparecem.
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

  // Pagina da aula (?module=M&lesson=L): o corpo do estudio na propria pagina,
  // com a trilha Curso > Modulo > Aula no lugar do modal. Mesmo rascunho,
  // mesmo autosave e mesmo Salvar do resto do builder.
  function renderLessonPage() {
    if (!course || !activeLessonStudioModule || !activeLessonStudioLesson) {
      return null;
    }
    const lessonModule = activeLessonStudioModule;
    const lesson = activeLessonStudioLesson;

    return (
      <LessonContentModal
        // Uma instancia por aula: o estado do estudio (aba, envio, se a
        // nota publica antiga aparece) nao vaza de uma aula para outra.
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
        // Done troca a entrada do historico: modulo > aula > modulo nao se acumula.
        onClose={() => router.replace(builderModuleHref(lessonModule.id), { scroll: false })}
        onUploadingChange={(uploading, failed) => {
          if (uploading) {
            setUploadingLesson({ moduleId: lessonModule.id, lessonId: lesson.id });
            return;
          }
          // Falhou com a URL em outro lugar (ex.: voltar do navegador): a URL
          // volta para a aula antes de soltar; senao a pagina com o erro sumia
          // antes de aparecer.
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
    // Primeira aula JÁ SALVA do módulo: a rota de IA confere o dono por ela.
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
              // O upload precisa do id do modulo ja gravado no servidor.
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
            {/* A rota confere o dono por uma aula JÁ SALVA do módulo. */}
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

        {/* Liberacao por posicao (sequencia, por modulo, por aula): mover muda
            quando a aula abre e qual vem antes. Avisa antes, e o mover pede
            confirmacao. Com dia proprio por aula (custom), nada muda. */}
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
          // Uma linha por aula (era um cartao de 3 linhas com 8 a 9 controles
          // e um botao cheio em cada): numero, titulo, a acao principal em
          // contorno, subir/descer e o resto em "Mais acoes", que abre logo
          // abaixo da linha (nada flutua para fora da tela).
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
                {/* A linha mostra so o titulo: tipo, dias de espera, nota,
                    texto e link sairam da tela (decisao de 14/09), mas
                    continuam no dado — updateLesson so aplica o patch. */}
                <input
                  value={lesson.title}
                  onChange={(event) =>
                    updateLesson(module.id, lesson.id, {
                      title: event.target.value,
                    })
                  }
                  disabled={!isEditable}
                  aria-label={t("creatorEditor.builder.curriculum.lessonTitle")}
                  // Borda clara em repouso: sem ela o titulo parecia texto
                  // solto, nao um campo que se edita ali mesmo.
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
                  {/* Caminho de teclado (e o acessivel) para mudar de modulo:
                      o seletor so marca o destino e o botao Move aplica. */}
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
                            // A linha sai desta pagina: o foco vai para o titulo do modulo.
                            document.getElementById("builder-module-heading")?.focus();
                          });
                        }}
                        // So com um destino que ainda existe e nao e o proprio
                        // modulo (o destino marcado pode ter sido apagado).
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

        {/* "Add lesson" mora no fim da lista, onde a aula nova entra. O
            formulario abria acima da lista e o "Lesson added" saia no
            rodape, telas abaixo. A linha de aviso e a da lista (mover, subir,
            descer, aula nova) e fica sempre na tela: o leitor de tela so
            anuncia mudanca de texto numa regiao que ja existia. */}
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
                // O aviso sai assim que ha titulo, sem esperar outro clique.
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
            {/* Como no formulario do modulo: o aviso sai aqui, nao no rodape. */}
            {error?.code === "lessonTitle" ? (
              <p id={`lesson-title-error-${module.id}`} role="alert" className="text-xs font-semibold text-[var(--color-danger-fg)]">
                {errorMessage}
              </p>
            ) : null}
            {/* Previa gratis e a minoria dos casos: fica a um clique daqui. */}
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

    // Com o campo na tela, o foco vai ate ele: no celular o aviso do campo
    // ficava abaixo da dobra e o Save parecia nao fazer nada.
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
      // O que cada tipo cobra (publish_teacher_course) tem a sua mensagem: a
      // sessao do evento, o arquivo do e-book, a comunidade ligada.
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

  // Sair pelo voltar/avancar do navegador, gesto do trackpad ou Alt+Esquerda
  // desmonta o builder sem clique em link: o timer de 1,8 s morria junto e a
  // edicao ia com ele (beforeunload nao dispara no App Router). A descarga manda
  // o rascunho pendente na hora, pelo mesmo persistDraft do autosave.
  useEffect(() => {
    flushOnLeaveRef.current = (withStudio) => {
      try {
        // Link digitado no estudio e ainda sem blur vai primeiro, sem prompt.
        // So saindo de verdade: com a aba apenas escondida, a pessoa volta ao
        // campo e decide ela mesma.
        if (withStudio) {
          studioLeaveFlushRef.current?.();
        }
        // Save, autosave ou Publicar no ar: nao comeca uma segunda troca total
        // (o Publicar pausa o autosave de proposito entre gravar e publicar).
        // O caminho no ar e o autosave normal levam o resto.
        // ponytail: desmontar de verdade com save no ar pula a descarga, e o
        // que foi editado depois dele se perde; enfileirar se virar caso real.
        if (isAutosavingRef.current || inFlightSavesRef.current > 0 || isSaving || isSubmitting) {
          return;
        }
        if (!courseId || !canAutosaveDraft || savedSignature === null) {
          return;
        }
        // Modulos do ref: ja trazem o link que acabou de ser gravado acima.
        const payload = {
          ...builderDraftPayload,
          modules: sanitizeModules(localModulesRef.current),
        };
        const signature = JSON.stringify(payload);
        if (signature === savedSignature) {
          return;
        }
        window.clearTimeout(autosaveTimerRef.current);
        // Pelo runAutosave (que chama o persistDraft): o save fica marcado como
        // o autosave no ar, e um timer novo com o mesmo payload nao o reenvia.
        // Ele ja trata o erro, entao nada escapa daqui.
        void runAutosave(signature, payload);
      } catch {
        // Sair nunca pode quebrar a desmontagem.
      }
    };
  });

  // pagehide cobre fechar/recarregar e o bfcache; visibilitychange('hidden')
  // chega antes, e e o unico aviso confiavel no celular. Aba escondida nao mexe
  // no estudio: trocar de app e voltar nao pode apagar o link digitado.
  // ponytail: fechar a aba de verdade pode cortar o fetch no meio; fetch com
  // keepalive no cliente Supabase se isso aparecer em producao.
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

  // Layout, nao passivo: na desmontagem o React limpa o pai antes dos filhos,
  // entao o handle do link do estudio (efeito de layout do filho) ainda existe
  // aqui. Numa limpeza passiva ele ja teria sido solto.
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
    // Rascunho sujo ou envio em curso: sem a camada do antigo modal, a barra
    // lateral e os links da marca ficam clicaveis no meio de um envio.
    if ((!draftIsDirty && !uploadingLesson) || typeof document === "undefined") {
      return;
    }

    const handleClickCapture = (event: MouseEvent) => {
      // O clique que a janela de sair repete depois do "Leave anyway": segue
      // para o Link como seguia quando o confirm() devolvia true.
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
      // Envio em curso: sair desmontaria o builder e o envio seguiria sem dono
      // (sucesso sem onde gravar, erro sem onde aparecer). Bloqueia e avisa.
      if (uploadingLesson) {
        event.preventDefault();
        event.stopPropagation();
        // So avisa, com um botao: a saida continua bloqueada e o envio segue.
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

      // A janela nao segura o clique como o confirm() segurava: o clique para
      // aqui e, confirmado, e repetido no mesmo link (o Link do Next navega
      // como navegaria). Link que sumiu da tela: vai pelo endereco.
      event.preventDefault();
      event.stopPropagation();
      ask({
        title: t("creatorEditor.builder.confirm.leaveTitle"),
        body: t("creatorEditor.builder.confirm.leave"),
        confirmLabel: t("creatorEditor.builder.confirm.leaveAction"),
        cancelLabel: t("creatorEditor.builder.confirm.stay"),
        danger: true,
        run: () => {
          // Depois de a janela fechar: com ela aberta a pagina e inerte.
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
      // O bloco de reduzir movimento do CSS nao alcanca a rolagem pedida em JS.
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

  // No celular as cinco etapas viram uma faixa que rola de lado (globals.css):
  // a etapa aberta vem para o meio e a borda direita esmaece enquanto houver
  // etapa escondida, como nas abas da sala (classroom-tabs.tsx). Só mexe no
  // scrollLeft da própria faixa, nunca na rolagem da página. isLoading: a faixa
  // só existe depois da carga.
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
  // A ajuda da etapa, no celular, fica atrás de "More about this step".
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

  // O marco da jornada: latão, com ícone, e o carregando dentro do botão. Mora
  // só no fim da aba Publish, onde a pessoa termina (o rodapé repetia).
  // Cada pendencia do Publish leva ao lugar de resolver: a aba e o campo (a
  // mesma ancora do stepper), ou a primeira aula ainda sem conteudo. Plano e
  // pagamentos tem link proprio; verificacao e ativacao, nao (null).
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
        // Aula ainda sem eco do save nao tem pagina: abre o modulo dela.
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

  const showPublishReason = !(readyToPublish || isLive || success === "published");
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
      // O botao apagado diz por que: a frase ao lado dele.
      aria-describedby={showPublishReason ? "builder-publish-reason" : undefined}
      className="w-full sm:w-auto"
    >
      {needsActivation
        ? t("creatorEditor.builder.publish.activateAndPublish")
        : t("creatorEditor.builder.publish.submit")}
    </Button>
  );

  // Um alerta so, renderizado no lugar de errorSlot. O titulo vazio da aula
  // nova fica no proprio formulario dela; preco e parcelas, no campo, quando
  // o campo esta na tela.
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
  // Publicou: o pico da jornada. O link para divulgar sai aqui mesmo, sem ir
  // ao Manage. Mora na aba Publish, no lugar do botao; se a pessoa trocou de
  // aba enquanto publicava, sai no topo da aba em que ela esta, em vez de
  // trocar a aba debaixo de quem digita. O botao latao de copiar so pega o
  // foco quando nada esta focado (CourseShareLink), entao nao rouba teclas.
  const publishedPanel = success === "published" ? (
    <>
      {courseId ? (
        <PublishedPanel
          courseId={courseId}
          courseTitle={title.trim() || t("creatorPanel.hub.header.courseFallback")}
          headingRef={successNoticeRef}
        />
      ) : null}
      {/* Depois de publicar, e só aí: a oferta do selo, sem travar nada.
          Status null (leitura falhou ou não chegou) não oferece. */}
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
  // Lugar fora da tela (Publish em outra aba, biblioteca fechada): o topo.
  const heroShowsError = errorSlot === "hero"
    || (errorSlot === "publish" && activeTab !== "review")
    || (errorSlot === "media" && !isMediaLibraryOpen);

  return (
    <div className="course-builder-shell">
      <section className="course-builder-hero">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={course?.status ?? "draft"} />
            {/* Cada estado uma vez: a faixa azul repetia o "Draft" do selo e o
                "% ready" repetia o stepper. Fica a frase curta ao lado do selo.
                Rascunho e "ajustes pedidos" nunca chegaram ao marketplace;
                "inativo" pode ter aluno matriculado e fica de fora. */}
            {course?.status === "draft" || course?.status === "needs_changes" ? (
              <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
                {t("creatorEditor.builder.shell.unpublished")}
              </span>
            ) : null}
            {isEditable ? (
              <BuilderSaveStatus
                state={displayedSaveStatus}
                blockedReason={autosaveBlockedReason}
                // Ao abrir o curso o chip ja diz "Saved" sem ninguem ter
                // salvado: o verde so acende depois de uma gravacao de verdade.
                justSaved={autosaveState === "saved"}
              />
            ) : null}
          </div>
          {/* No celular o rótulo sai: o primeiro campo ficava ~800px abaixo
              do topo, e o título logo abaixo já diz onde se está. */}
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)] max-sm:hidden">
            {t("creatorEditor.builder.shell.title")}
          </p>
          {/* h1, não h2: esta é a única página do builder e o título do curso é
              o assunto dela. Enquanto era h2, /teach/builder não tinha h1
              nenhum — quem navega por cabeçalho (leitor de tela, atalho de
              navegação) entrava numa página sem título anunciado, e a árvore
              de headings começava direto no nível 2. */}
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
          {/* rel="opener": a prévia sabe que veio daqui, e o "Exit preview"
              fecha a aba em vez de abrir um segundo construtor nela
              (course-preview-shell.tsx). A prévia guarda esta aba e zera
              window.opener ao montar: página de outra origem aberta depois
              naquela aba não alcança esta. */}
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
          {/* Contorno, nao navy: o curso ja salva sozinho e o selo ao lado diz
              o estado. O rotulo nao vira "Saving..." (o selo ja diz): a face
              da espera repete o "Save draft" com o anel, e o lugar do anel
              fica guardado, entao o botao nao empurra Manage e Preview. */}
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
      {/* O "Save draft" e um so, aqui em cima: a confirmacao sai embaixo dele. */}
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
            {/* Duas linhas, nao reticencias: a unica dica do proximo passo saia
                cortada ("Upload a cover — it fronts the pro..."). */}
            <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-[var(--color-ink-soft)]">
              {t("creatorEditor.builder.navigation.next")}{" "}
              <span className="text-[var(--color-primary)]">
                {readiness.next?.hint ?? t("creatorEditor.builder.publish.ready")}
              </span>
            </p>
          </div>
          <div className="course-builder-stepper__meter">
            {/* A prontidao mora so aqui, numa linha: o "71%" aparecia tres
                vezes (chip do topo, esta linha e o cartao do rodape). */}
            {/* aria-hidden: a barra logo abaixo já diz esta frase (é o nome
                dela) e o valor; sem isso o leitor de tela lia tudo duas vezes. */}
            <p aria-hidden="true" className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
              {readinessText}
            </p>
            {/* A barra media estagios (5) e o chip media checks (7): 40% e
                71% no mesmo cabecalho para o mesmo curso. Agora os tres leem
                o mesmo numero. */}
            {/* A barra compartilhada (latão de texto, trilho que segue o tema),
                a mesma do painel do curso e da área do aluno. */}
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
          {/* key: trocar de aba remonta o cabecalho e a animacao roda de novo.
              Na pagina da aula ele sai: "Build the curriculum." e as contagens
              ficavam entre o construtor e a aula, e a trilha ja diz onde se esta. */}
          {isLessonPage ? null : (
          <div key={activeTab} className={`${panelIn} flex flex-wrap items-start justify-between gap-4 pb-4`}>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                {activeTab === "members" ? t("creatorEditor.members.step") : t(builderTabs[selectedTabIndex]?.label ?? "creatorEditor.builder.shell.shortTitle")}
              </p>
              {/* Alvo do foco quando a linha que o tinha some (modulo apagado). */}
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
              {/* No celular a ajuda da etapa fica fechada atrás deste botão: o
                  parágrafo empurrava o primeiro campo mais uma tela para baixo.
                  Do sm para cima o botão some e a ajuda fica aberta. */}
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
              {/* O e-book nao mostra modulo nem aula. */}
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
            {/* No teto o "Add" apaga: a frase diz por quê (F-12). */}
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
                // A chave da Conta (.settings-toggle: botao por transform, nos
                // tokens de movimento) dentro de um alvo de 44px. A daqui era
                // feita a mao, 48x28, e o botao pulava por `left`.
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span aria-hidden="true" className={`settings-toggle ${communityEnabled ? "settings-toggle--on" : ""}`}>
                  <span />
                </span>
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
            {!checkoutOffers ? (
              // Sem a lista de precos, o preco principal e desconhecido: nada
              // de cartoes por cima dele. Enquanto ela chega, blocos do tamanho
              // dos cartoes guardam o lugar (antes o painel ficava so com a nota
              // de rodape e os cartoes entravam empurrando tudo).
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
              // A pagina cobra a oferta principal: cartoes e campos aqui
              // mudariam so o construtor, e o checkout seguiria cobrando ela.
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
            {/* Uma pergunta so, feita uma vez. Os campos de cada cartao so
                aparecem depois da escolha; os cartoes ficam montados e o foco
                continua no cartao clicado. */}
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
                {/* A coluna da moeda era 140px fixos. Um <select> nunca fica mais
                    estreito que a sua opção mais larga ("BRL - Brazilian Real"),
                    então ele empurrava a borda e saía do cartão em telas médias e
                    grandes. minmax(0, …) nas duas colunas deixa a grade encolher, e o
                    min-w-0 do próprio select (em CurrencySelect) deixa o controle
                    acompanhar a coluna em vez de a coluna acompanhar o controle. */}
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
                        // O aviso do campo sai ao corrigir, sem esperar outro Save.
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
                  {/* Fora do label: dentro dele a frase entraria no nome do campo. */}
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
                  // Produto antigo que cobra uma vez por ano: continua assim.
                  // Passar para mensal limpa o valor, que era o do ano.
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
                        {/* So com o mensal ja gravado: o Manage le o curso salvo e,
                            com o valor antigo, abria outro preco principal. */}
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
          {/* A lista vem primeiro. Antes, a estrutura do curso era a ultima
              coisa da aba: dois formularios grandes sempre abertos ("Add
              module" e "Add lesson", com um select "Choose module") ficavam
              acima dela. */}
          <div
            id="builder-sec-modules"
            className="scroll-mt-24"
          >
            {/* O e-book vem antes da pagina da aula: o link "Open" do envio
                leva ?module&lesson, e a aula dele nao tem pagina propria. */}
            {ebookLesson && ebookModule ? renderEbookFiles(ebookModule, ebookLesson) : activeLessonStudioLesson ? renderLessonPage() : activeModule ? renderModulePage(activeModule, activeModuleIndex) : (
            <>
            {renderLiveSession()}
            {/* So no curso: comunidade, evento e e-book tem a propria acao.
                Sem modulo, a unica acao e o formulario "Add your first module"
                logo abaixo (aberto sozinho): o vazio diz o mesmo. */}
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

            {/* Sempre montada: o leitor de tela so anuncia mudanca numa regiao
                que ja existia. */}
            <p role="status" className="sr-only">{reorderStatus}</p>
            <div className="mt-4 grid gap-2">
              {modules.map((module, moduleIndex) => {
                const coverUrl = getSafeMediaUrl(getModuleCoverAsset(module, courseAssets)?.downloadUrl);
                return (
                  <article
                    key={module.id}
                    // Soltar aqui uma aula arrastada a leva para o fim deste modulo.
                    onDragOver={(event) => {
                      // So aceita o arrastar de uma aula; texto ou arquivo nao.
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
                    // A linha que vai receber a aula se marca (antes nada mudava).
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
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md"
                    >
                      {/* A capa vertical 2:3 em miniatura (32x48), com o canto
                          das outras capas: era um círculo aqui e um retângulo
                          na página do módulo. */}
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
                      {/* Longe do Down: a 8 px e do mesmo tamanho, errar o
                          toque apagava o modulo. */}
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
                      // Caminho do mouse; o acessivel e o seletor da pagina do
                      // modulo. No toque o arrastar nao existe: as etiquetas
                      // somem em vez de parecer que respondem.
                      <ul aria-hidden="true" className="flex basis-full flex-wrap gap-1.5 pointer-coarse:hidden">
                        {module.lessons.map((lesson) => (
                          <li key={lesson.id}>
                            <span
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData(lessonDragType, lesson.id);
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              // Arrasto cancelado (Esc, soltou fora): a marca sai.
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
            {/* A liberacao das aulas morava na aba de preco, com "Interval
                days" ao lado da moeda. E ritmo de aula, nao cobranca: fica
                aqui, embaixo da lista de modulos, com rotulo simples. */}
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
                  // "Release lessons every [1] days": com o padrao 1 a frase saia
                  // errada. Um rotulo de campo nao depende do numero.
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
            {/* O titulo do painel ja diz "Publish to the marketplace.": um
                segundo titulo de 30 px logo abaixo repetia a mesma coisa. */}
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
                  {/* Pendente era texto dourado e feito era um "✓" digitado: o
                      latão marcava problema. Feito = check verde (6.51:1) com
                      "Done" para o leitor de tela; pendente = círculo vazio. */}
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
                      {/* Mesmo destino do Manage: sem ele a pessoa lia "termine
                          o cadastro" e nao tinha onde clicar. */}
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
                      // Varios "Fix in Details" na lista: o nome do item vai
                      // junto para o leitor de tela.
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

        {/* Aba Publish: a recusa do Publish sai logo acima do botao. */}
        {errorSlot === "publish" && activeTab === "review" && builderErrorAlert ? (
          <div className="mt-6">{builderErrorAlert}</div>
        ) : null}

        {activeTab === "review" ? publishedPanel : null}

        {/* Na pagina da aula a saida e o "Back to module" dela: Back/Continue
            do construtor empilhavam uma terceira barra de acoes. */}
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
            // A aba Publish terminava num texto; o botão de publicar ficava no
            // cartão do rodapé, que no celular vem depois do resumo inteiro.
            <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
              {showPublishReason ? (
                <span id="builder-publish-reason" className="text-xs font-semibold text-[var(--color-ink-soft)]">
                  {t("creatorEditor.builder.publish.finish")}
                </span>
              ) : null}
              {success === "published" ? null : publishButton}
            </div>
          )}
        </div>
        )}
      </section>

      {/* O rodape so leva para fora e para a biblioteca. A prontidao e as
          pendencias moram na aba Publish (com o "Go to..." de cada uma), o
          "Save draft" no topo e o "Publish product" na aba Publish: aqui
          repetiam tudo embaixo de toda aba. */}
      <div className="course-builder-footer">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-4">
          <Link
            href="/teach"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)]"
          >
            <ArrowLeft aria-hidden="true" size={14} strokeWidth={2} />
            {t("creatorEditor.builder.navigation.studio")}
          </Link>
          {/* A biblioteca inteira (upload de capa + lista de arquivos) vinha
              aberta embaixo de toda aba e sozinha respondia por boa parte dos
              3.138 px da aba de conteudo. Agora e um clique de quem precisa. */}
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
        // Evento ao vivo: espera as sessoes chegarem, senao a faixa diria
        // "agende sua sessao" a quem ja agendou e trocaria a frase na cara do
        // leitor de tela. Se a leitura falhar, a faixa nao aparece.
        message={
          createdStripOpen && course && (productFormat !== "live_event" || courseSessions !== null)
            ? t(`creatorEditor.builder.created.${
                productFormat === "live_event" && courseSessions?.length ? "live_eventScheduled" : productFormat
              }`)
            : null
        }
        // O curso nasce com "Modulo 1, Aula 1": a faixa abre essa aula.
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
 * Linha do checklist de publicar (catalogo de movimento, item 5). O que fica
 * pronto COM a aba aberta acende em latao claro uma vez e o check se desenha;
 * o que ja estava pronto quando a aba abriu nao pisca, senao abrir a aba
 * viraria festa. A foto de "pronto" so e tirada com `ready` (as leituras de
 * payouts, verificacao, arquivos e sessoes de volta).
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
 * A faixa "Rascunho salvo. Proximo: ..." (catalogo de movimento, item 7).
 * - A regiao `role="status"` fica sempre montada e so o conteudo entra, um
 *   tique depois: NVDA e JAWS nao anunciam uma regiao viva que ja nasce
 *   preenchida.
 * - Some em 4s, mas o relogio para enquanto o ponteiro ou o foco estao nela
 *   (sem isso o foco no X caia no <body> quando a faixa sumia).
 * - `absolute` sem tamanho: vazia, nao ocupa linha nem gap na grade do
 *   construtor. Nao `fixed`: fixed cria contexto de empilhamento e prenderia
 *   o z-index 60 da faixa dentro dele.
 */
function CreatedStrip({
  message,
  action,
  onClose,
}: {
  message: string | null;
  // O atalho do proximo passo. Com ele a faixa nao some sozinha: sai no X ou
  // no atalho (sumir em 4s deixava o botao fora de alcance).
  action?: { label: string; onClick: () => void };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(false);
  const sticky = Boolean(action);
  // Os dois relogios saem juntos: o tique que poe o texto na regiao ja
  // montada e os 4s ate sumir (que nao corre enquanto `held`). Soltar a
  // faixa recomeca os 4s.
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
 * O painel "Publicado!" (catalogo de movimento, item 8), no lugar do paragrafo
 * cinza igual ao "Draft saved.". O selo carimba, a gravura acende e o botao
 * latao "Copy my page link" recebe o foco. Uma festa por produto: publicar de
 * novo o mesmo curso mostra o painel parado.
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
  // So le no inicializador; quem grava e o efeito. No StrictMode o
  // inicializador roda duas vezes antes de qualquer efeito, entao as duas
  // leituras concordam.
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

// Os dois chips de falha do salvar ("Not saving", "Save failed"): o fundo é o
// token de erro, não o vermelho a 6% escrito à mão, que no tema escuro sumia
// no cartão (F-07).
const dangerChipClass =
  "inline-flex items-center gap-1.5 rounded-chip border border-[rgba(178,34,52,0.22)] bg-[var(--color-danger-soft)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-danger-fg)]";

function BuilderSaveStatus({
  state,
  blockedReason,
  justSaved = false,
}: {
  state: "pending" | "saving" | "saved" | "error" | "blocked";
  blockedReason?: AutosaveBlockedReason | null;
  /** Uma gravacao acabou de voltar: o chip entra e o verde acende 1,5s. */
  justSaved?: boolean;
}) {
  const { t } = useTranslation();
  // Autosave parado por campo inválido. Precisa ser visualmente diferente do
  // "Unsaved changes" neutro — este estado não passa sozinho, e continuar
  // digitando só aumenta o que vai se perder.
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
    // Anunciado como o "Not saving": antes a falha do salvar sozinho entrava
    // no topo calada para o leitor de tela.
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
  /** A previa vem de course.coverImageUrl: quem chama busca o curso de novo. */
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

  // course_assets nao esta na publicacao do Realtime: depois do upload a
  // previa busca a lista de novo, senao a capa nova so aparecia ao recarregar.
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
        {/* rel="opener": o mesmo motivo do "Preview" do topo. */}
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

    // Capa do módulo: foto de origem até 10 MB, recusada na hora (antes de
    // abrir a imagem). As recusas ficam síncronas, como eram.
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
    // A compressao da capa do modulo vem antes do envio e o rotulo nao diz mais
    // "Uploading...": a nota de envio ja aparece no clique, sem porcentagem.
    setProgress({ bytesTransferred: 0, totalBytes: file.size, percent: null, state: "running" });

    try {
      // Capa do módulo: recorte vertical 2:3 comprimido no navegador (10 MB
      // entram, uns 300 KB saem). Se não der para comprimir, sobe o original.
      // A capa da área de membros sobe como veio.
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
      // Na página do módulo a capa mora numa coluna, sem moldura própria.
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
