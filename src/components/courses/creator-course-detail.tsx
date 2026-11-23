"use client";

import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";

import { useTranslation } from "@/components/i18n/i18n-provider";

import Link from "next/link";
import { ArrowLeft, Clock, Lock, Receipt, ShieldCheck, Star, Target } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { BunnyVideoPlayer } from "@/components/courses/bunny-video-player";
import { renderCourseDetailSkeleton } from "@/components/courses/course-detail-skeleton";
import { CourseModuleDisclosure } from "@/components/courses/course-module-disclosure";
import { CourseUnlockModal } from "@/components/learn/course-unlock-modal";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import {
  CourseInstructorCard,
  CourseReviewsSection,
  useInstructorProfile,
} from "@/components/courses/course-social-proof";
import { UserAvatar } from "@/components/shared/user-avatar";
import { SelfReportedTag, VerifiedBadge } from "@/components/shared/verified-badge";
import { useHasRealCourses } from "@/components/site/real-courses";
import { formatEventDateTimeInZone } from "@/domain/course-event";
import { getSafeExternalUrl } from "@/domain/external-url";
import { CourseLandingBlocks } from "@/components/courses/course-landing-blocks";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import { linkify } from "@/lib/format/linkify";
import type { CourseLanding } from "@/lib/data/course-landings";
import { emptyCourseLanding, getCourseLanding } from "@/lib/data/course-landings";
import {
  resolveCoursePrice,
  type ProductOffer,
} from "@/domain/product-pricing";
import type { TeacherCourse, TeacherCourseStatus } from "@/domain/teacher-course";
import {
  formatTotalMinutes,
  isCoursePubliclySellable,
  normalizeLearningOutcomes,
  resolveLessonVideoSource,
} from "@/domain/teacher-course";
import { canOpenEnrollment } from "@/domain/enrollment";
import { getLiveEventSession, type LiveEventSession } from "@/lib/data/course-events";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { subscribeToViewableTeacherCourse } from "@/lib/data/published-courses";
import {
  getLessonContentDoc,
  resolveLessonContent,
  type LessonContent,
} from "@/lib/data/lesson-content";
import { hasPermission } from "@/lib/permissions";
import { isPublicFeatureEnabled } from "@/lib/feature-flags";
import { getSupabaseClientConfig } from "@/lib/supabase/config";
import {
  enrollInFreeCreatorCourse,
  startCourseCheckout,
} from "@/lib/payments/checkout";
import { GuestCheckoutForm, useOnPlatformHost } from "@/components/courses/guest-checkout-form";
import { isGuestCheckoutEnabled } from "@/lib/payments/guest-checkout";
import { track } from "@/lib/posthog/events";
import { CourseViewedTracker } from "@/lib/posthog/page-trackers";
import { PaymentRequestError } from "@/lib/payments/client-fetch";

type CreatorCourseDetailProps = {
  courseIdOverride?: string;
  /** A página já renderizou título e resumo no servidor (mesmo padrão de PlatformShell). */
  hideHeader?: boolean;
  checkoutOnly?: boolean;
  /**
   * Capa, título e resumo que o servidor desenhou. Entram no topo da coluna da
   * esquerda, para o cartão de compra começar no alto da página, ao lado deles.
   */
  lead?: ReactNode;
};

// The checkout API has public codes for auth/configuration, but its business
// errors still use exact messages. Keep that allowlist scoped to their status;
// unknown provider or network details must never become public copy.
const checkoutMessageKeys: Partial<Record<number, Record<string, string>>> = {
  400: {
    "A valid courseId is required.": "publicCourses.paymentErrors.invalidCourse",
    "The selected offer is invalid.": "publicCourses.selectedOfferUnavailable",
    "The selected offer code is invalid.": "publicCourses.selectedOfferUnavailable",
    "This course is not available for purchase right now.": "publicCourses.paymentErrors.courseUnavailable",
    "You can't purchase your own course.": "publicCourses.paymentErrors.ownCourse",
    "This course does not have a paid checkout price yet.": "publicCourses.paymentErrors.priceUnavailable",
    "This teacher has not connected Stripe payouts yet.": "publicCourses.paymentErrors.creatorPaymentsUnavailable",
    "This teacher must finish Stripe onboarding before paid checkout opens.": "publicCourses.paymentErrors.creatorPaymentsUnavailable",
    "Coupon not found.": "publicCourses.paymentErrors.couponInvalid",
    "Invalid coupon code.": "publicCourses.paymentErrors.couponInvalid",
    "This coupon is not active.": "publicCourses.paymentErrors.couponUnavailable",
    "This coupon is no longer available.": "publicCourses.paymentErrors.couponUnavailable",
    "This coupon has expired.": "publicCourses.paymentErrors.couponExpired",
    "This coupon has reached its redemption limit.": "publicCourses.paymentErrors.couponLimit",
    "Invalid price for coupon redemption.": "publicCourses.paymentErrors.couponNotApplicable",
    "Coupon would zero out a paid checkout.": "publicCourses.paymentErrors.couponNotApplicable",
  },
  404: {
    "Course not found.": "publicCourses.notFound",
  },
  409: {
    "This course is already attached to your learning workspace.": "publicCourses.paymentErrors.alreadyEnrolled",
    "You already have a subscription for this course.": "publicCourses.paymentErrors.alreadySubscribed",
    "Another offer already has an active checkout. Close it or wait for it to expire before switching offers.": "publicCourses.paymentErrors.checkoutConflict",
    "A subscription checkout for this course is already starting. Please try again in a moment.": "publicCourses.paymentErrors.checkoutStarting",
    "A checkout for this course is already starting. Please try again in a moment.": "publicCourses.paymentErrors.checkoutStarting",
  },
  429: {
    "Too many attempts. Please wait before trying again.": "publicCourses.paymentErrors.rateLimit",
  },
};

function getCheckoutErrorKey(error: unknown): string {
  if (error instanceof PaymentRequestError) {
    if (error.status === 401 && error.code === "unauthenticated") {
      return "publicCourses.paymentErrors.signInRequired";
    }
    if (error.status === 503 && error.code === "payments_not_configured") {
      return "publicCourses.paymentErrors.paymentsUnavailable";
    }
    const messages = checkoutMessageKeys[error.status];
    if (messages && Object.hasOwn(messages, error.message)) {
      return messages[error.message];
    }
  }
  return "publicCourses.checkoutError";
}

export function CreatorCourseDetail({
  courseIdOverride,
  hideHeader = false,
  checkoutOnly = false,
  lead = null,
}: CreatorCourseDetailProps = {}) {
  const { t, locale } = useTranslation();
  const { status: authStatus, user } = useAuth();
  const hasRealCourses = useHasRealCourses();
  const router = useRouter();
  const searchParams = useSearchParams();
  const onPlatformHost = useOnPlatformHost();
  // URL segment: a course id on legacy links (and the Stripe checkout
  // redirects) or a title_key slug on pretty ones. Only route back to it;
  // every backend call below uses `resolvedCourseId`, the real primary key.
  const courseRef = courseIdOverride ?? searchParams.get("courseId") ?? "";
  const checkoutStatus = searchParams.get("checkout");
  const requestedOfferId = searchParams.get("offerId")?.trim() ?? "";
  const requestedOfferCode = searchParams.get("offer")?.trim().toUpperCase() ?? "";
  const requestedPriceId = searchParams.get("priceId")?.trim() ?? "";
  const hasBackendConfig = Boolean(getSupabaseClientConfig());
  const checkoutEnabled = isPublicFeatureEnabled("payments.checkout");
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [landing, setLanding] = useState<CourseLanding>(emptyCourseLanding);

  // Declared here, with the other hooks, so it runs before any early return --
  // the component bails out while `course` is still null, and a hook after that
  // point would change hook order between renders.
  //
  // Loaded separately from the course because the landing lives in its own
  // table; see the header of migration 20260820010000 for why it is not a
  // column on `courses`. One extra read on the page that needs it, instead of a
  // fat column on every marketplace listing.
  const landingCourseId = course?.id ?? null;
  useEffect(() => {
    // No reset in the null branch: the initial state is already the empty
    // landing, and writing it back here would be a synchronous setState inside
    // an effect body. This surface mounts one course and keeps it, so there is
    // no path where a previous course's page could linger.
    if (checkoutOnly || !landingCourseId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getCourseLanding(landingCourseId).then((next) => {
        if (!cancelled) setLanding(next);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkoutOnly, landingCourseId]);
  // Uma assinatura so do perfil do professor, usada pela assinatura embaixo do
  // titulo E pelo cartao do instrutor.
  const instructorProfile = useInstructorProfile(course?.ownerId ?? "");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [couponCode, setCouponCode] = useState("");
  // O campo de cupom sai da frente ate alguem ter um. Antes ele ficava sempre
  // aberto acima do botao, sugerindo que faltava algo para poder comprar.
  const [isCouponOpen, setIsCouponOpen] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isEnrollingFree, setIsEnrollingFree] = useState(false);
  // Padlocked lesson in the curriculum: opens the buy popup (cover, title and a
  // button to the buy card on this same page). Public course fields only.
  const [isUnlockOpen, setIsUnlockOpen] = useState(false);
  // Enquanto o botão do cartão de compra está fora da tela, a barra de preço e
  // compra aparece (no celular, no pé da tela; no desktop, no canto). Com ele à
  // vista, ela some: seria um segundo "Enroll" ao lado do primeiro.
  // null = ainda não medido (sem IntersectionObserver, ou antes do 1º aviso):
  // vale o desenho antigo, barra à vista no celular. Só a medição esconde.
  // Ref de callback: o cartão só nasce depois que o curso carrega.
  const [enrollCardInView, setEnrollCardInView] = useState<boolean | null>(null);
  const enrollCardObserver = useRef<IntersectionObserver | null>(null);
  // O cartão também recebe o foco do "Try again" do preço (fica nos dois desfechos).
  const enrollCardRef = useRef<HTMLElement | null>(null);
  const watchEnrollCard = useCallback((node: HTMLElement | null) => {
    enrollCardRef.current = node;
    enrollCardObserver.current?.disconnect();
    enrollCardObserver.current = null;
    if (!node || checkoutOnly || typeof IntersectionObserver === "undefined") return;
    // Some só quando o BOTÃO do cartão está na tela, não no 1º pixel do
    // cartão (o botão fica ~300 px abaixo do topo dele). Passos de 5% fazem o
    // aviso chegar a cada ~40 px de rolagem sobre o cartão.
    const observer = new IntersectionObserver(
      ([entry]) => {
        const cta = node.querySelector("[data-cta-focus]");
        if (!cta) {
          setEnrollCardInView(entry.isIntersecting);
          return;
        }
        const rect = cta.getBoundingClientRect();
        setEnrollCardInView(entry.isIntersecting && rect.top < window.innerHeight && rect.bottom > 0);
      },
      { threshold: Array.from({ length: 21 }, (_, step) => step / 20) },
    );
    observer.observe(node);
    enrollCardObserver.current = observer;
  }, [checkoutOnly]);
  const closeUnlock = useCallback(() => setIsUnlockOpen(false), []);
  // A learner who already has access sees the curriculum like the owner: no
  // padlocks and no buy popup (checkout would refuse with alreadyEnrolled).
  // Same read as the classroom; a teacher course's enrollment uses its id.
  // Keyed by user and course, so a stale answer never hides padlocks.
  const viewerUid = user?.uid ?? null;
  const enrollmentCourseId = course?.id ?? null;
  const [viewerEnrollmentKey, setViewerEnrollmentKey] = useState<string | null>(null);
  // A chave da leitura que já respondeu (com matrícula, sem, ou com falha). A
  // página de compra também lê: quem volta do cadastro ou do "Sign in" pode já
  // ter o curso, e ali via o botão de pagar em vez de "Continue learning".
  const [enrollmentAnsweredKey, setEnrollmentAnsweredKey] = useState<string | null>(null);
  useEffect(() => {
    if (!hasBackendConfig || !viewerUid || !enrollmentCourseId) {
      return;
    }
    const key = `${viewerUid}__${enrollmentCourseId}`;
    return subscribeToEnrollment(
      viewerUid,
      enrollmentCourseId,
      (enrollment) => {
        setViewerEnrollmentKey(enrollment && canOpenEnrollment(enrollment.status) ? key : null);
        setEnrollmentAnsweredKey(key);
      },
      // Falhou: fica como era (o botão de pagar; o servidor recusa quem já tem).
      () => setEnrollmentAnsweredKey(key),
    );
  }, [hasBackendConfig, viewerUid, enrollmentCourseId]);
  const [offerLoadError, setOfferLoadError] = useState("");
  const [offerState, setOfferState] = useState<{
    courseId: string | null;
    offers: ProductOffer[];
  }>({ courseId: null, offers: [] });
  // B1: the free-preview lesson body/link now live in gated lesson content.
  // RLS exposes exactly the course's freePreviewLessonId row to an
  // unauthenticated visitor, so fetch it and fall back to the inline course
  // field for un-migrated courses.
  const [previewContent, setPreviewContent] = useState<{
    key: string | null;
    content: LessonContent | null;
  }>({ key: null, content: null });

  // "Try again" do erro de leitura: a assinatura não relê sozinha, então o
  // número novo assina de novo. O aviso fica na tela até a resposta chegar.
  const [courseReadAttempt, setCourseReadAttempt] = useState(0);
  useEffect(() => {
    if (!courseRef || !hasBackendConfig) {
      return;
    }

    return subscribeToViewableTeacherCourse(
      courseRef,
      (nextCourse) => {
        setCourse(nextCourse);
        setError("");
        setIsLoading(false);
      },
      () => {
        setError("publicCourses.courseLoadError");
        setIsLoading(false);
      },
    );
  }, [courseRef, hasBackendConfig, courseReadAttempt]);

  // Resolved primary key — empty until the course row loads.
  const resolvedCourseId = course?.id ?? "";

  // B1: one-shot fetch of the free-preview lesson's gated content. Keyed on the
  // preview lesson id so it re-runs if the educator changes the preview.
  const freePreviewLessonId = course?.freePreviewLessonId ?? null;
  useEffect(() => {
    if (checkoutOnly || !resolvedCourseId || !hasBackendConfig || !freePreviewLessonId) {
      // No reset here: render resolves preview content only when
      // previewContent.key matches the current course+preview lesson, so a stale
      // value is ignored and falls back to inline — avoids a setState-in-effect.
      return;
    }

    let cancelled = false;
    const key = `${resolvedCourseId}__${freePreviewLessonId}`;

    getLessonContentDoc(resolvedCourseId, freePreviewLessonId)
      .then((content) => {
        if (!cancelled) {
          setPreviewContent({ key, content });
        }
      })
      .catch(() => {
        // Soft-fail to inline fallback — never blank the marketing preview.
        if (!cancelled) {
          setPreviewContent({ key, content: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [checkoutOnly, resolvedCourseId, hasBackendConfig, freePreviewLessonId]);

  // "Try again" do preço: limpa o erro (o cartão volta à espera de sempre, sem
  // preço nem botão de pagar) e lê as ofertas de novo.
  const [offerReadAttempt, setOfferReadAttempt] = useState(0);
  useEffect(() => {
    if (!resolvedCourseId || !isCoursePubliclySellable(course?.status)) {
      return;
    }

    const controller = new AbortController();
    void fetch(`/api/courses/${encodeURIComponent(resolvedCourseId)}/offers`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          offers?: ProductOffer[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error("publicCourses.offersUnavailable");
        }
        setOfferLoadError("");
        setOfferState({ courseId: resolvedCourseId, offers: body.offers ?? [] });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setOfferLoadError("publicCourses.offersUnavailable");
      });

    return () => controller.abort();
  }, [course?.status, resolvedCourseId, offerReadAttempt]);

  // Evento ao vivo: a data da sessao, no fuso de quem ensina. Fica guardada
  // com o id do curso, entao uma resposta velha nunca aparece em outro.
  const liveEventCourseId = course?.productFormat === "live_event" ? course.id : null;
  const [liveSession, setLiveSession] = useState<{
    courseId: string;
    session: LiveEventSession | null;
  } | null>(null);
  useEffect(() => {
    if (checkoutOnly || !liveEventCourseId || !hasBackendConfig) {
      return;
    }
    let cancelled = false;
    getLiveEventSession(liveEventCourseId)
      .then((session) => {
        if (!cancelled) setLiveSession({ courseId: liveEventCourseId, session });
      })
      // Sem a data, a pagina diz que ela sera anunciada.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [checkoutOnly, hasBackendConfig, liveEventCourseId]);

  if (!courseRef) {
    return (
      <CourseDetailState
        title={t("publicCourses.notSelected")}
        detail={t("publicCourses.chooseCourse")}
        nested={hideHeader}
        lead={lead}
      />
    );
  }

  if (!hasBackendConfig) {
    return (
      <CourseDetailState
        title={t("publicCourses.detailsUnavailable")}
        detail={t("publicCourses.connectionError")}
        nested={hideHeader}
        lead={lead}
      />
    );
  }

  if (isLoading && !error) {
    // Carregar não é erro: o esqueleto da página, sem título nem saída.
    // Chamado como função, e não como <CourseDetailSkeleton />: a árvore sai
    // com a mesma forma do retorno abaixo, e o `lead` (capa e h1 do servidor)
    // continua montado quando o curso chega, sem piscar.
    return renderCourseDetailSkeleton({
      label: t(checkoutOnly ? "publicCourses.loadingCheckout" : "publicCourses.loadingCourse"),
      checkoutOnly,
      lead,
    });
  }

  if (error) {
    // Rede ruim não é fim de caminho: o aviso com "Try again", que lê o curso de
    // novo; nada de preço ou botão de pagar até a leitura dar certo.
    return (
      <CourseDetailState
        title={t("publicCourses.unavailable")}
        detail={t(error)}
        nested={hideHeader}
        lead={lead}
        retry={{
          busy: isLoading,
          onRetry: () => {
            setIsLoading(true);
            setCourseReadAttempt((attempt) => attempt + 1);
          },
        }}
      />
    );
  }

  if (!course) {
    return (
      <CourseDetailState
        title={t("publicCourses.notFound")}
        detail={t("publicCourses.notListed")}
        nested={hideHeader}
        lead={lead}
      />
    );
  }

  const isSellable = isCoursePubliclySellable(course.status);
  if (!isSellable) {
    const isOwner = user != null && course.ownerId === user.uid;
    const isAdmin = hasPermission({ roles: user?.roles }, "platform.accessAdmin");

    return (
      <CourseDetailState
        {...getUnpublishedCourseState(course.status, { isOwner, isAdmin }, t)}
        nested={hideHeader}
        lead={lead}
      />
    );
  }

  const offersLoaded = offerState.courseId === course.id;
  const offers = offersLoaded ? offerState.offers : [];
  const hasExplicitOffer = Boolean(
    requestedOfferId || requestedOfferCode || requestedPriceId,
  );
  const resolvedPrice = offersLoaded
    ? resolveCoursePrice(course, offers, {
        ...(requestedOfferId ? { offerId: requestedOfferId } : {}),
        ...(requestedOfferCode ? { publicCode: requestedOfferCode } : {}),
        ...(requestedPriceId ? { priceId: requestedPriceId } : {}),
      })
    : null;
  const pricingReady = offersLoaded && !offerLoadError;
  // O preço ainda está a caminho (não falhou): o cartão guarda o lugar dele.
  const pricePending = !pricingReady && !offerLoadError;
  const courseIsFree =
    resolvedPrice?.paymentType === "free" || resolvedPrice?.amountMinor === 0;
  const subscriptionInterval =
    resolvedPrice?.paymentType === "subscription_monthly"
      ? "month"
      : resolvedPrice?.paymentType === "subscription_yearly"
        ? "year"
        : null;
  const priceLabel =
    !pricingReady
      ? offerLoadError
        ? t("publicCourses.pricingUnavailable")
        : t("publicCourses.loadingPricing")
      : !resolvedPrice && hasExplicitOffer
        ? t("publicCourses.offerUnavailable")
        : courseIsFree
      ? t("publicCourses.free")
      : resolvedPrice
      ? `${new Intl.NumberFormat(locale, {
          style: "currency",
          currency: resolvedPrice.currency,
        }).format(resolvedPrice.amountMinor / 100)}${
          subscriptionInterval ? ` / ${t(`publicCourses.${subscriptionInterval}`)}` : ""
        }`
      : t("publicCourses.pricingPending");
  // Página de compra, com sessão: até a matrícula responder, o botão fica na
  // espera do cartão (a mesma do preço a caminho), e não oferece pagar a quem
  // talvez já tenha o curso. A página de venda segue como era.
  const accessPending =
    checkoutOnly && user != null && enrollmentAnsweredKey !== `${user.uid}__${course.id}`;
  const canCheckout =
    pricingReady
    && !accessPending
    && checkoutEnabled
    && authStatus === "authenticated"
    && Boolean(user)
    && Boolean(resolvedPrice)
    && (resolvedPrice?.amountMinor ?? 0) > 0;
  const hasPaidPrice =
    pricingReady && Boolean(resolvedPrice) && (resolvedPrice?.amountMinor ?? 0) > 0;
  const canEnrollFree =
    pricingReady
    && !accessPending
    && authStatus === "authenticated"
    && Boolean(user)
    && courseIsFree;
  // A visitor buys a paid course without signing in first (off by default; see
  // isGuestCheckoutEnabled). Free courses still need an account, and so does a
  // creator's own domain. Only once the session is known to be absent: while it
  // loads, a signed-in buyer must not see the form.
  const guestCheckoutOn =
    authStatus === "unauthenticated"
    && checkoutEnabled
    && !courseIsFree
    && onPlatformHost
    && isGuestCheckoutEnabled();
  // The owner never sees padlocks on their own course.
  const viewerOwnsCourse = Boolean(user && course.ownerId === user.uid);
  const viewerHasAccess =
    viewerOwnsCourse || (user != null && viewerEnrollmentKey === `${user.uid}__${course.id}`);
  // An enrolled learner (not the owner) is sent to the classroom instead of
  // being offered the purchase: checkout would refuse with alreadyEnrolled.
  const viewerIsLearner = viewerHasAccess && !viewerOwnsCourse;
  const classroomHref = `/learn/courses/${course.id}`;
  const lessons = course.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({
      ...lesson,
      moduleTitle: module.title,
    })),
  );
  const previewLesson = course.freePreviewLessonId
    ? lessons.find((lesson) => lesson.id === course.freePreviewLessonId)
    : null;
  // B1: prefer the gated subcollection content for the preview lesson; fall
  // back to the inline field when the fetched doc is absent (un-migrated
  // course) or hasn't loaded for this preview lesson yet.
  const resolvedPreviewContent: LessonContent =
    previewLesson
      ? resolveLessonContent(
          previewContent.key
            === `${course.id}__${previewLesson.id}`
            ? previewContent.content ?? undefined
            : undefined,
          previewLesson,
        )
      : { contentText: null, externalUrl: null };
  const previewLessonContentText = resolvedPreviewContent.contentText;
  const previewLessonRawExternalUrl = resolvedPreviewContent.externalUrl;
  const previewLessonTrustedEmbed = getTrustedLessonEmbed(previewLessonRawExternalUrl);
  // A vitrine é o terceiro leitor da fonte do vídeo, e era o único que lia o
  // campo cru enquanto o modal do professor e a área do aluno já passavam pelo
  // resolvedor. Isso a deixava sozinha em desacordo com as outras duas telas.
  //
  // Aqui não existe lista de assets — a página pública recebe só o que o
  // serializador publica —, então a única evidência de arquivo enviado é a
  // própria fonte declarada. É menos evidência que os outros leitores têm; o
  // ganho é a decisão ficar na mesma função, e o embed voltar a ser consultado
  // quando a fonte declarada não se sustenta.
  const previewVideoSource = resolveLessonVideoSource({
    declared: previewLesson?.videoSource,
    hasVideoAsset: previewLesson?.videoSource === "upload",
    hasTrustedEmbed: Boolean(previewLessonTrustedEmbed),
  });
  const previewLessonEmbed =
    previewVideoSource === "upload" ? null : previewLessonTrustedEmbed;
  const previewLessonExternalUrl = getSafeExternalUrl(previewLessonRawExternalUrl);
  const lockedLessonCount = Math.max(lessons.length - (previewLesson ? 1 : 0), 0);
  // Comunidade, evento ao vivo e e-book nao vendem uma grade de aulas: em vez
  // de previa, curriculo, "N aulas restantes" e "Lessons: 0", a pagina diz o
  // que o comprador recebe.
  const productFormat = course.productFormat ?? "course";
  const showsCurriculum = productFormat === "course" && course.modules.length > 0;
  const session = liveSession?.courseId === course.id ? liveSession.session : null;
  const sessionLabel = session
    ? formatEventDateTimeInZone(session.startsAt, locale, session.timeZone)
    : null;
  const deliveryText =
    productFormat === "community"
      ? t("publicCourses.deliveryCommunity")
      : productFormat === "ebook"
        ? t("publicCourses.deliveryEbook")
        : productFormat === "live_event"
          ? sessionLabel
            ? t("publicCourses.deliveryLiveEvent").replace("{date}", () => sessionLabel)
            : t("publicCourses.deliveryLiveEventPending")
          : t("publicCourses.curriculumPending");
  const hasRating = Boolean(course.ratingCount && course.ratingAverage);
  const learningOutcomes = normalizeLearningOutcomes(course.learningOutcomes);
  // Duracao real do curso, somada das aulas (so com todas as aulas medidas).
  const durationLabel = formatTotalMinutes(
    course.modules.flatMap((module) => module.lessons.map((lesson) => lesson.durationMinutes)),
  );
  const instructorName = instructorProfile?.displayName || null;
  // Como se cobra, ao lado do numero grande. Nunca inventado: sai do proprio
  // tipo de pagamento que o checkout vai usar.
  const billingSuffix = !pricingReady
    ? null
    : courseIsFree
      ? t("publicCourses.freeEnrollment")
      : subscriptionInterval
        ? t(subscriptionInterval === "month" ? "publicCourses.billedMonthly" : "publicCourses.billedYearly")
        : hasPaidPrice
          ? t("publicCourses.oneTime")
          : null;
  const coursePath = `/courses/${encodeURIComponent(courseRef)}${checkoutOnly ? "/checkout" : ""}`;
  const returnParams = new URLSearchParams();
  if (requestedOfferId) returnParams.set("offerId", requestedOfferId);
  if (requestedOfferCode) returnParams.set("offer", requestedOfferCode);
  if (requestedPriceId) returnParams.set("priceId", requestedPriceId);
  const returnQuery = returnParams.size ? `?${returnParams}` : "";
  // Entrar (e a compra sem login) volta para ESTA pagina. Quem ja tem o curso
  // ve "Continue learning" nas duas: as duas leem a matricula.
  const returnTo = `${coursePath}${returnQuery}`;
  // Criar conta volta ao CHECKOUT, com a mesma oferta: conta nova nunca tem o
  // curso, e depois do e-mail e da entrevista o cartao de pagar (ou de entrar
  // gratis) e a primeira coisa da tela, e nao o topo da pagina de venda.
  const checkoutReturnTo = `/courses/${encodeURIComponent(courseRef)}/checkout${returnQuery}`;
  const signupHref = `/auth?mode=signup&returnTo=${encodeURIComponent(checkoutReturnTo)}`;
  const enrollLabel = courseIsFree
    ? t("publicCourses.enrollFree")
    : pricingReady && hasPaidPrice
      ? `${subscriptionInterval ? t("publicCourses.subscribe") : t("publicCourses.enroll")} — ${priceLabel}`
      : t("publicCourses.enroll");
  // The text of the buy card's main button. The popup uses this same value, so
  // the two never disagree, including "Checkout not available yet". Enquanto o
  // preço só carrega o botão diz "Enroll": "not available" ali parecia curso
  // fora de venda nos segundos antes do preço chegar.
  const cardActionLabel = authStatus !== "authenticated"
    ? enrollLabel
    : accessPending
      ? t("publicCourses.enroll")
      : canEnrollFree
      ? isEnrollingFree ? t("publicCourses.addingCourse") : t("publicCourses.enrollFree")
      : isCheckingOut
        ? t("publicCourses.openingCheckout")
        : checkoutEnabled && hasPaidPrice
          ? enrollLabel
          // Com a compra desligada não há o que esperar: o aviso sai direto.
          : checkoutEnabled && pricePending
            ? t("publicCourses.enroll")
            : t("publicCourses.checkoutUnavailable");
  // Secoes que EXISTEM nesta pagina. Um menu que oferece "Reviews" para um
  // curso sem resenha leva a pessoa para lugar nenhum, entao cada item so
  // entra quando a secao correspondente vai ser desenhada.
  const sectionLinks: [string, string][] = [
    [t("publicCourses.overview"), "#overview"],
    ...(learningOutcomes.length > 0
      ? ([[t("publicCourses.outcomes"), "#what-you-will-learn"]] as [string, string][])
      : []),
    ...(showsCurriculum
      ? ([
          [t("publicCourses.preview"), "#free-preview"],
          [t("publicCourses.curriculum"), "#curriculum"],
        ] as [string, string][])
      : ([[t("publicCourses.delivery"), "#delivery"]] as [string, string][])),
    ...(hasRating ? ([[t("publicCourses.reviews"), "#reviews"]] as [string, string][]) : []),
    ...(instructorProfile
      ? ([[t("publicCourses.instructor"), "#instructor"]] as [string, string][])
      : []),
  ];

  // O cartão de compra fica no fim da página no celular: sem rolar até ele, um
  // clique nos blocos que não pode seguir (ou que falhou) parece não fazer nada.
  function revealBuyCard() {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById("enroll-card")
      ?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }

  async function handleCheckout() {
    if (!course || !resolvedPrice || !canCheckout || !checkoutEnabled) {
      return;
    }

    const checkoutCourseId = course.id;
    setCheckoutError("");
    setIsCheckingOut(true);
    // CHECKOUT_STARTED: ids plus the money convention (minor + currency). The
    // coupon is text the buyer typed, so it stays out of analytics.
    track.checkoutStarted({
      course_id: checkoutCourseId,
      price_minor: resolvedPrice.amountMinor,
      currency: resolvedPrice.currency,
    });

    try {
      await startCourseCheckout(checkoutCourseId, {
        ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}),
        ...(resolvedPrice.offerId ? { offerId: resolvedPrice.offerId } : {}),
        ...(requestedOfferCode ? { offerCode: requestedOfferCode } : {}),
        ...(resolvedPrice.priceId ? { priceId: resolvedPrice.priceId } : {}),
      });
    } catch (error) {
      setCheckoutError(getCheckoutErrorKey(error));
      setIsCheckingOut(false);
      revealBuyCard();
    }
  }

  async function handleFreeEnrollment() {
    if (!course || !canEnrollFree) {
      return;
    }

    setCheckoutError("");
    setIsEnrollingFree(true);

    try {
      await enrollInFreeCreatorCourse(course.id);
      router.push(`/learn/courses/${encodeURIComponent(course.id)}`);
    } catch {
      setCheckoutError("publicCourses.enrollError");
      setIsEnrollingFree(false);
      revealBuyCard();
    }
  }

  // Every other buy button on the page (the teacher's sales blocks) does what
  // the buy card's main button does. They used to call handleCheckout alone,
  // which does nothing for a visitor, a free course or an enrolled learner.
  function handleCardAction() {
    if (isEnrollingFree || isCheckingOut) return;
    if (authStatus !== "authenticated") {
      if (guestCheckoutOn) revealBuyCard();
      else router.push(signupHref);
    } else if (viewerIsLearner) {
      router.push(classroomHref);
    } else if (canEnrollFree) {
      void handleFreeEnrollment();
    } else if (!canCheckout || !checkoutEnabled) {
      revealBuyCard();
    } else {
      void handleCheckout();
    }
  }

  function handleOfferSelection(offerId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("offer");
    params.delete("priceId");
    params.delete("checkout");
    params.set("offerId", offerId);
    const query = params.toString();
    router.replace(
      `${coursePath}${query ? `?${query}` : ""}`,
      { scroll: false },
    );
  }

  return (
    <>
    {/* COURSE_VIEWED on the public course page, once the price is resolved so
        is_free and currency are real. The checkout-only page is a step of the
        purchase, not a view. Ids only: no title, no teacher name. */}
    {!checkoutOnly && pricingReady ? (
      <CourseViewedTracker
        course_id={course.id}
        is_free={courseIsFree}
        currency={resolvedPrice?.currency}
      />
    ) : null}
    <div className={checkoutOnly ? "grid w-full min-w-0 gap-6" : "grid gap-8 pb-24 lg:grid-cols-[1.15fr_0.85fr] lg:pb-0"}>
      <section className="min-w-0">
        {/* A volta ao catálogo saiu do cartão de compra (era a última linha
            dele, disputando com o botão) e fica aqui, no alto da coluna, como
            caminho de volta. Loja vazia não é destino: leva ao início. Na
            página de compra a volta é o "ver detalhes" do cartão.
            O `lead` fica na 2ª posição desta section, como no esqueleto: é o
            que o mantém montado na troca (course-detail-skeleton.tsx). */}
        {checkoutOnly ? null : (
          <Link
            href={hasRealCourses ? "/courses" : "/"}
            className="mb-2 flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-soft)] underline-offset-4 hover:text-[var(--color-primary)] hover:underline"
          >
            <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
            {t(hasRealCourses ? "publicCourses.backCourses" : "publicPages.notFound.home")}
          </Link>
        )}
        {lead}
        {hideHeader ? null : (
          <div
            id="overview"
            className="primary-fill-card scroll-mt-24 rounded-lg border border-[var(--color-line)] bg-[var(--color-primary)] p-8 text-white shadow-[var(--shadow-soft)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
              {t("publicCourses.independent")}
            </p>
            <h1 className="display-title page-title mt-4">
              {course.title}
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-white/78">
              {course.summary}
            </p>
          </div>
        )}

        {/* Assinatura do instrutor, logo abaixo do titulo. Quem compra um curso
            escolhe uma PESSOA, e ate aqui o nome dela so aparecia no fim da
            barra lateral, depois do preco e dos avisos de pagamento. A nota
            tambem sobe para ca: era a quinta linha de uma lista neutra. */}
        {instructorName || hasRating || durationLabel ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--color-ink-soft)]">
            {/* Nome e selo num grupo só: numa tela estreita a quebra de linha
                leva os dois juntos. O selo fica fora do link porque é botão. */}
            {instructorName ? (
              <span className="inline-flex min-w-0 items-center gap-0.5">
                <Link
                  href={`/instructors/${encodeURIComponent(course.ownerId)}`}
                  className="inline-flex min-h-11 min-w-0 items-center gap-2 font-semibold text-[var(--color-ink)] underline-offset-4 hover:underline"
                >
                  <UserAvatar
                    name={instructorName}
                    photoURL={instructorProfile?.photoURL}
                    size="sm"
                  />
                  {instructorName}
                </Link>
                {instructorProfile?.verification ? (
                  <VerifiedBadge compact verification={instructorProfile.verification} />
                ) : null}
              </span>
            ) : null}
            {instructorProfile?.credentials?.[0] ? (
              // A marca fica fora do truncate: credencial longa não a esconde.
              <span className="inline-flex min-w-0 items-baseline">
                <span className="min-w-0 truncate">{instructorProfile.credentials[0]}</span>
                {instructorProfile.verification ? null : <SelfReportedTag />}
              </span>
            ) : null}
            {hasRating ? (
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-ink)]">
                <Star
                  aria-hidden="true"
                  size={14}
                  strokeWidth={1.5}
                  className="fill-[var(--color-brand)] text-[var(--color-brand)]"
                />
                {course.ratingAverage?.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                <span className="font-normal text-[var(--color-ink-soft)]">
                  ({course.ratingCount})
                </span>
              </span>
            ) : null}
            {durationLabel ? <span>{durationLabel}</span> : null}
          </div>
        ) : null}

        {!checkoutOnly ? <>
        <nav
          aria-label={t("publicCourses.sections")}
          className="mt-6 flex flex-wrap gap-1 border-b border-[var(--color-line)]"
        >
          {sectionLinks.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-11 items-center border-b-2 border-transparent px-4 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition hover:border-[var(--color-accent-fg)] hover:text-[var(--color-primary)]"
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* The teacher's own sales page, when they built one. Renders nothing
            at all when empty, so a course without one keeps today's layout
            exactly. The price and the checkout handler are passed in rather
            than recomputed: re-deriving from the course row would ignore
            offers and coupons and quote the buyer a number that is not what
            they will be charged. */}
        <CourseLandingBlocks
          blocks={landing.blocks}
          template={landing.template}
          priceLabel={priceLabel}
          onEnrol={handleCardAction}
          enrolDisabled={isEnrollingFree || isCheckingOut}
        />

        {learningOutcomes.length > 0 ? (
          <section
            id="what-you-will-learn"
            className="mt-8 scroll-mt-24 rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.outcomes")}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {learningOutcomes.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white text-[var(--color-primary)]">
                    <Target aria-hidden="true" size={14} strokeWidth={2.2} />
                  </span>
                  <p className="text-sm font-semibold leading-6 text-[var(--color-ink)]">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Prova social sobe: quem ensina vem logo depois do que a pessoa vai
            aprender, e nao no fim da barra lateral, depois do preco. */}
        {instructorProfile ? (
          <div id="instructor" className="mt-8 scroll-mt-24">
            <CourseInstructorCard
              teacherId={course.ownerId}
              profile={instructorProfile}
            />
          </div>
        ) : null}

        {showsCurriculum ? <>
        <section
          id="free-preview"
          className="mt-8 scroll-mt-24 rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.preview")}</p>
          {previewLesson ? (
            <div className="mt-5 grid gap-4 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                  {previewLesson.moduleTitle}
                </p>
                {/* 20px em Manrope: em 36px de serifa, o nome da aula grátis
                    competia com o título do curso. */}
                <h2 className="mt-2 text-xl font-bold leading-tight text-[var(--color-primary)]">
                  {previewLesson.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                  {previewLesson.description
                    || t("publicCourses.previewDescription")}
                </p>
              </div>
              {previewLessonContentText ? (
                // Mesmo texto da area de membros: quebras de linha e links
                // clicaveis, sem HTML cru.
                <div className="whitespace-pre-line rounded-lg bg-white p-4 text-sm leading-7 text-[var(--color-ink)]">
                  {linkify(previewLessonContentText)}
                </div>
              ) : null}
              {previewLessonEmbed ? (
                <div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-primary)]">
                  <iframe
                    src={previewLessonEmbed.embedUrl}
                    title={previewLesson.title}
                    className="aspect-video w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              ) : null}
              {previewVideoSource === "upload" ? (
                <div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-primary)]">
                  <BunnyVideoPlayer
                    courseId={course.id}
                    lessonId={previewLesson.id}
                    title={previewLesson.title}
                  />
                </div>
              ) : null}
              {previewLessonExternalUrl && !previewLessonEmbed ? (
                <a
                  href={previewLessonExternalUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="button-outline w-fit px-3.5 py-2 text-xs"
                >{t("publicCourses.previewResource")}</a>
              ) : null}
              {/* A note for the teacher about their own empty preview; a buyer
                  has nothing to attach. */}
              {viewerOwnsCourse && !previewLessonRawExternalUrl && previewVideoSource !== "upload" ? (
                <p className="rounded-lg bg-white p-4 text-xs leading-6 text-[var(--color-ink-soft)]">{t("publicCourses.previewMedia")}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-5 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">{t("publicCourses.noPreview")}</p>
          )}
          <p className="mt-4 text-xs leading-6 text-[var(--color-ink-soft)]">
            {t(lockedLessonCount === 1 ? "publicCourses.lockedOne" : "publicCourses.lockedMany").replace("{count}", String(lockedLessonCount))}
          </p>
        </section>

        <section
          id="curriculum"
          className="mt-8 scroll-mt-24 rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.structure")}</p>
          <div className="mt-5 grid gap-3">
            {course.modules.length === 0 ? (
              <p className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">{t("publicCourses.curriculumPending")}</p>
            ) : (
              course.modules.map((module, moduleIndex) => (
                // Um módulo por sanfona: com tudo aberto, um curso de 10 módulos
                // virava uma coluna enorme e, no celular, o cartão de compra só
                // vinha depois dela. O primeiro abre sozinho; os outros mostram
                // nome, aulas e duração.
                <CourseModuleDisclosure
                  key={module.id}
                  title={module.title}
                  meta={[
                    t(module.lessons.length === 1 ? "publicCourses.lessonOne" : "publicCourses.lessonMany")
                      .replace("{count}", String(module.lessons.length)),
                    formatTotalMinutes(module.lessons.map((lesson) => lesson.durationMinutes)),
                  ].filter(Boolean).join(" · ")}
                  defaultOpen={moduleIndex === 0}
                >
                  <div className="grid gap-2 px-3 pb-3">
                    {module.lessons.map((lesson) => {
                      const isPreview = course.freePreviewLessonId === lesson.id;
                      // 44px de altura: a aula trancada é botão (abre a compra)
                      // e tinha 32px, abaixo do alvo de toque mínimo.
                      const rowClass =
                        "flex min-h-11 items-center justify-between gap-3 rounded-md bg-white px-3 py-2.5 text-sm text-[var(--color-ink-soft)]";
                      // 12px em caixa normal, com " · ": as maiúsculas
                      // espaçadas e os hífens ("VIDEO - 12 MIN") liam como código.
                      const meta = (
                        <span className="shrink-0 text-right text-xs">
                          {t(`publicCourses.lessonTypes.${lesson.type}`)}
                          {lesson.durationMinutes ? ` · ${lesson.durationMinutes} min` : ""}
                          {isPreview ? ` · ${t("publicCourses.previewShort")}` : ""}
                        </span>
                      );
                      // The free preview (and every lesson, for the owner or
                      // an enrolled learner) stays as it was; the rest carry a
                      // padlock and open the buy popup.
                      return isPreview || viewerHasAccess ? (
                        <div key={lesson.id} className={rowClass}>
                          <span className="font-semibold text-[var(--color-ink)]">
                            {lesson.title}
                          </span>
                          {meta}
                        </div>
                      ) : (
                        <button
                          key={lesson.id}
                          type="button"
                          aria-haspopup="dialog"
                          onClick={() => setIsUnlockOpen(true)}
                          className={`${rowClass} w-full text-left transition hover:bg-[var(--color-surface-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]`}
                        >
                          <span className="flex min-w-0 items-center gap-2 font-semibold text-[var(--color-ink)]">
                            <Lock aria-hidden="true" size={13} className="shrink-0" />
                            {lesson.title}
                            <span className="sr-only">{t("publicCourses.locked")}</span>
                          </span>
                          {meta}
                        </button>
                      );
                    })}
                  </div>
                </CourseModuleDisclosure>
              ))
            )}
          </div>
        </section>
        </> : (
          <section
            id="delivery"
            className="mt-8 scroll-mt-24 rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.delivery")}</p>
            <p className="mt-4 text-sm leading-7 text-[var(--color-ink)]">{deliveryText}</p>
          </section>
        )}

        {/* Social proof: real learner reviews (enrollment-gated server-side by
            submitCourseReview). Renders nothing while a course has no
            published reviews. */}
        <CourseReviewsSection
          courseId={course.id}
          ratingAverage={course.ratingAverage}
          ratingCount={course.ratingCount}
        />
        </> : null}
      </section>

      {/* Cartao de compra fixo: no desktop ele acompanha a rolagem, entao o
          preco e o botao seguem visiveis enquanto a pessoa le o curriculo.
          Antes o cartao subia com a pagina e sumia na primeira rolagem. */}
      <aside
        ref={watchEnrollCard}
        id="enroll-card"
        // Focus fallback for the popup's button when no main action is enabled.
        tabIndex={-1}
        // O formulario de visitante deixa o cartao mais alto que a tela: preso
        // no topo, ele ganha teto e rola por dentro, para o botao nunca ficar
        // abaixo da tela (regra 1 do AGENTS.md, em svh).
        // Na pagina de compra o cartao E a coluna principal: nem preso no topo
        // nem com rolagem propria, que escondia o formulario numa caixa.
        className={`min-w-0 h-fit scroll-mt-24 self-start rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6${
          checkoutOnly ? "" : ` lg:sticky lg:top-24${guestCheckoutOn ? " lg:max-h-[calc(100svh-7rem)] lg:overflow-y-auto" : ""}`
        }`}
      >
        {/* O preco era a quarta de seis linhas de uma lista "At a glance",
            entre "Status: Published" e "Access: Secure checkout" — vocabulario
            interno que o comprador nao precisa ler. Agora ele e o numero
            grande no topo do cartao. O rotulo dizia "Access" (o comprador
            procurava o preco e lia outra coisa) em 10px; agora diz "Price" em 12px. */}
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">{t("publicCourses.priceEyebrow")}</p>
        <p className="display-title mt-1 flex flex-wrap items-baseline gap-2 text-4xl leading-none text-[var(--color-primary)]">
          {/* Carregando: uma barra da altura do preço, e não "Loading
              pricing..." em 36px quebrando em duas linhas. */}
          {pricePending ? (
            <>
              <span aria-hidden="true" className="block h-9 w-[150px] max-w-full animate-pulse rounded-md bg-[var(--color-surface-strong)]" />
              <span className="sr-only">{priceLabel}</span>
            </>
          ) : offerLoadError ? (
            // Falhou: o aviso vermelho logo abaixo diz o que houve. Aqui, só
            // um traço discreto, e não "Pricing unavailable" em 36px repetindo.
            <span aria-hidden="true" className="text-[var(--color-ink-muted)]">—</span>
          ) : (
            <span>{priceLabel}</span>
          )}
          {billingSuffix ? (
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)] [font-family:var(--font-sans)]">
              · {billingSuffix}
            </span>
          ) : null}
        </p>

        {offers.length > 1 ? (
          <fieldset className="mt-5 border-y border-[var(--color-line)] py-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">{t("publicCourses.chooseOffer")}</legend>
            <div className="mt-2 divide-y divide-[var(--color-line)]">
              {offers.map((offer) => {
                const price = offer.prices.find((entry) => entry.active !== false);
                const interval =
                  price?.paymentType === "subscription_monthly"
                    ? ` / ${t("publicCourses.month")}`
                    : price?.paymentType === "subscription_yearly"
                      ? ` / ${t("publicCourses.year")}`
                      : "";
                return (
                  <label
                    key={offer.id}
                    className="flex min-h-12 cursor-pointer items-center gap-3 py-3"
                  >
                    <input
                      type="radio"
                      name="course-offer"
                      value={offer.id}
                      checked={resolvedPrice?.offerId === offer.id}
                      onChange={() => handleOfferSelection(offer.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--color-ink)]">
                        {offer.name}
                      </span>
                      <span className="block text-xs text-[var(--color-ink-soft)]">
                        {price
                          ? price.amountMinor === 0
                            ? t("publicCourses.free")
                            : `${new Intl.NumberFormat(locale, {
                                style: "currency",
                                currency: price.currency,
                              }).format(price.amountMinor / 100)}${interval}`
                          : t("publicCourses.unavailableShort")}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        {/* Compra cancelada é um fato neutro ("nada foi cobrado"), não erro:
            tom de informação, anunciado sem interromper. */}
        {checkoutStatus === "cancelled" ? (
          <InlineAlert tone="info" className="mt-5">{t("publicCourses.cancelled")}</InlineAlert>
        ) : null}

        {checkoutStatus === "success" ? (
          <p className="mt-5 info-notice">{t("publicCourses.paymentReceived")}</p>
        ) : null}

        {/* InlineAlert: o erro é anunciado ao leitor de tela, e não só pintado. */}
        {checkoutError ? (
          <InlineAlert tone="error" className="mt-5">{t(checkoutError)}</InlineAlert>
        ) : null}

        {offerLoadError ? (
          <LoadErrorAlert
            className="mt-5"
            focusRef={enrollCardRef}
            onRetry={() => {
              setOfferLoadError("");
              setOfferReadAttempt((attempt) => attempt + 1);
            }}
          >
            {t(offerLoadError)}
          </LoadErrorAlert>
        ) : pricingReady && hasExplicitOffer && !resolvedPrice ? (
          <InlineAlert tone="error" className="mt-5">{t("publicCourses.selectedOfferUnavailable")}</InlineAlert>
        ) : null}

        {guestCheckoutOn ? (
          // Visitante com a compra sem login ligada: nome, e-mail e termos,
          // direto para o Stripe. Entrar continua a um clique.
          <GuestCheckoutForm
            courseId={course.id}
            offerId={resolvedPrice?.offerId}
            offerCode={requestedOfferCode || undefined}
            priceId={resolvedPrice?.priceId}
            returnTo={returnTo}
            submitLabel={enrollLabel}
            disabled={!hasPaidPrice}
            errorKeyFor={getCheckoutErrorKey}
            onSubmitStart={() => {
              if (!resolvedPrice) return;
              track.checkoutStarted({
                course_id: course.id,
                price_minor: resolvedPrice.amountMinor,
                currency: resolvedPrice.currency,
              });
            }}
          />
        ) : authStatus !== "authenticated" ? (
          // Visitante: o botao principal diz o que ele faz e quanto custa, e
          // leva a criar conta. `returnTo` traz a pessoa de volta a ESTE curso
          // depois de entrar, em vez de deixa-la na home.
          <div className="mt-6 grid gap-3">
            <Link
              href={signupHref}
              data-cta-focus
              className="button-solid w-full justify-center px-5 py-2.5 text-sm"
            >
              {enrollLabel}
            </Link>
            <Link
              href={`/auth?mode=signin&returnTo=${encodeURIComponent(returnTo)}`}
              className="button-outline w-full justify-center px-5 py-2.5 text-sm"
            >{t("publicCourses.signIn")}</Link>
          </div>
        ) : viewerIsLearner ? (
          <Link
            href={classroomHref}
            data-cta-focus
            className="button-solid mt-6 w-full justify-center px-5 py-2.5 text-sm"
          >
            {t("publicCourses.continueLearning")}
          </Link>
        ) : (
          <>
            {canEnrollFree ? (
              <button
                type="button"
                data-cta-focus
                onClick={handleFreeEnrollment}
                disabled={isEnrollingFree}
                className="button-solid mt-6 w-full px-5 py-2.5 text-sm"
              >
                {cardActionLabel}
              </button>
            ) : (
              <button
                type="button"
                data-cta-focus
                onClick={handleCheckout}
                disabled={!canCheckout || isCheckingOut}
                aria-busy={accessPending || (checkoutEnabled && pricePending) || undefined}
                className="button-solid mt-6 min-h-12 w-full px-5 py-3 text-base font-semibold"
              >
                {cardActionLabel}
              </button>
            )}
            {/* Cupom fora do caminho de quem nao tem um. */}
            {canCheckout && !subscriptionInterval ? (
              isCouponOpen ? (
                <label className="mt-4 block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">{t("publicCourses.coupon")}</span>
                  <input
                    value={couponCode}
                    autoFocus
                    onChange={(event) =>
                      setCouponCode(
                        event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9-]/g, "")
                          .slice(0, 32),
                      )
                    }
                    autoComplete="off"
                    placeholder={t("publicCourses.optional")}
                    className="field-input mt-2"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCouponOpen(true)}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
                >{t("publicCourses.haveCoupon")}</button>
              )
            ) : null}
            {!checkoutEnabled ? (
              <p className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-xs leading-6 text-[var(--color-ink-soft)]">{t("publicCourses.checkoutLater")}</p>
            ) : null}
          </>
        )}

        {/* Depois do botao vinham cinco blocos soltos, dois em caixas de cores
            diferentes (verde e cinza), e o botao se perdia no meio do cartao.
            Agora e UM bloco discreto, num estilo so: o que o curso inclui e,
            em lista, acesso, pagamento seguro, reembolso e quem vende. As
            frases sao as mesmas de antes (mesmas chaves), so reagrupadas. */}
        {checkoutOnly && !pricingReady ? null : <div className="mt-5 grid gap-4 border-t border-[var(--color-line)] pt-5">
          {/* Na pagina de compra quem decide ja leu o curso: categoria e contagem
              de aulas ficam no resumo do pedido, nao junto do formulario. */}
          {checkoutOnly ? null : <dl className="grid gap-2 text-sm">
            {[
              [t("publicCourses.category"), getCourseCategoryLabel(course.category, t)],
              ...(showsCurriculum ? [[t("publicCourses.lessons"), String(course.lessonCount)]] : []),
              ...(durationLabel ? [[t("publicCourses.duration"), durationLabel]] : []),
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-[var(--color-ink-soft)]">{label}</dt>
                <dd className="min-w-0 text-right font-semibold text-[var(--color-ink)]">{value}</dd>
              </div>
            ))}
          </dl>}

          {/* Só com o preço resolvido: até lá `courseIsFree` é falso, e um curso
              grátis lia "Paid access opens…", reembolso e vendedor enquanto o
              preço carregava (ou se a leitura falhasse). */}
          {pricingReady ? <ul className="grid gap-3 text-xs leading-5 text-[var(--color-ink-soft)]">
            <li className="flex gap-2.5">
              <Clock aria-hidden="true" size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
              <span>{courseIsFree ? t("publicCourses.freeAccess") : t("publicCourses.paidAccess")}</span>
            </li>
            {/* Só com um preço pago resolvido: com o preço carregando ou
                indisponível não há pagamento a processar. */}
            {!courseIsFree && hasPaidPrice ? (
              <li className="flex gap-2.5">
                <Lock aria-hidden="true" size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
                <span>{t("publicCourses.securePayment")}</span>
              </li>
            ) : null}
            {/* Risk reversal at the point of purchase. States the REAL policy
                (automaticRefundWindowDays = 7, progress < 50% — see requestRefund),
                never an invented "30-day guarantee" the platform doesn't honor. */}
            {!courseIsFree ? (
              <li className="flex gap-2.5">
                <ShieldCheck aria-hidden="true" size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
                <span>
                  <strong className="text-[var(--color-ink)]">{t("publicCourses.refundTitle")}</strong>{" "}
                  {t("publicCourses.refundBody")}
                </span>
              </li>
            ) : null}
            {/* Direct charges: the buyer's counterparty is the EDUCATOR, not
                SkillsetMind. The charge is created on the educator's own connected
                account (see /api/payments/checkout, `stripeAccount`) and we set no
                statement_descriptor override, so THEIR descriptor reaches the card
                statement. A buyer who does not expect that name disputes it, and
                the chargeback lands on the educator's balance. */}
            {!courseIsFree ? (
              <li className="flex gap-2.5">
                <Receipt aria-hidden="true" size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
                {/* Na página de venda, uma linha e "Learn more": o parágrafo
                    de três linhas empurrava o cartão. A frase inteira segue na
                    página (no <details>, sem sair dela); o alvo do toque cresce
                    para 44px sem afastar as outras linhas. Na página de compra,
                    logo antes de pagar, ela fica aberta. */}
                {checkoutOnly ? (
                  <span>
                    <strong className="text-[var(--color-ink)]">{t("publicCourses.sellerTitle")}</strong>{" "}
                    {t("publicCourses.sellerBody")}
                  </span>
                ) : (
                  <details className="group/seller min-w-0 [&_summary::-webkit-details-marker]:hidden">
                    <summary className="-my-3 cursor-pointer list-none py-3">
                      <strong className="text-[var(--color-ink)]">{t("publicCourses.sellerTitle")}</strong>{" "}
                      <span className="font-semibold text-[var(--color-primary)] underline underline-offset-2 group-open/seller:hidden">{t("publicCourses.sellerLearnMore")}</span>
                    </summary>
                    <p className="mt-1">{t("publicCourses.sellerBody")}</p>
                  </details>
                )}
              </li>
            ) : null}
          </ul> : null}
        </div>}

        {/* Na página de compra não há volta ao catálogo: o resumo do pedido
            leva ao curso. Sem o resumo (a leitura do servidor falhou), o
            cartão leva. Na página de venda a volta mora no alto da coluna. */}
        {checkoutOnly && !hideHeader ? (
          <Link
            href={`/courses/${encodeURIComponent(courseRef)}`}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center text-sm font-semibold text-[var(--color-primary)]"
          >{t("publicCourses.checkoutCourseDetails")}</Link>
        ) : null}
      </aside>
    </div>

    {/* No celular a coluna do cartao cai para o fim da pagina: para achar o
        preco e o botao era preciso rolar por todo o curriculo. Esta barra
        mantem os dois a mao e leva ao cartao. Em qualquer largura ela so
        aparece enquanto o botao do cartao esta fora da tela (no desktop, como
        um cartao no canto); com ele a vista, some: dois "Enroll" ao mesmo
        tempo, e a barra cobrindo o pe do cartao. `hidden` tira a barra da
        ordem do Tab; o pb-24 da pagina continua reservando o lugar dela.
        Antes da primeira medicao, a barra fica como era: a vista no celular. */}
    {!checkoutOnly ? <div
      className={`course-buy-float pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-3 ${
        enrollCardInView === null
          ? "lg:hidden"
          : enrollCardInView ? "hidden" : "lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[24rem] lg:px-0 lg:pb-0"
      }`}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]/95 px-4 py-3 shadow-[0_-6px_30px_rgba(15,39,68,0.18)] backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface)]/85">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">{t("publicCourses.priceEyebrow")}</p>
          <p className="display-title truncate text-xl leading-none text-[var(--color-primary)]">
            {/* Carregando: a mesma barra pulsante do cartão, na altura da
                linha do preço (a barra não muda de altura quando ele chega). */}
            {pricePending ? (
              <>
                <span aria-hidden="true" className="block h-5 w-20 animate-pulse rounded-md bg-[var(--color-surface-strong)]" />
                <span className="sr-only">{priceLabel}</span>
              </>
            ) : priceLabel}
          </p>
        </div>
        {viewerIsLearner ? (
          <Link
            href={classroomHref}
            className="button-solid inline-flex min-h-11 shrink-0 items-center px-3.5 py-2 text-xs"
          >{t("publicCourses.continueLearning")}</Link>
        ) : (
          <Link
            href="#enroll-card"
            className="button-solid inline-flex min-h-11 shrink-0 items-center px-3.5 py-2 text-xs"
          >{t("publicCourses.enroll")}</Link>
        )}
      </div>
    </div> : null}
    {!checkoutOnly ? (
      <CourseUnlockModal
        // Closes itself when access loads late: a learner who clicked a
        // padlock before their enrollment arrived must not keep a buy popup.
        course={isUnlockOpen && !viewerHasAccess ? course : null}
        onClose={closeUnlock}
        ctaHref="#enroll-card"
        // The buy card's own button text: resolved offer, discount code,
        // interval, locale and signed-in state. The popup never formats the
        // raw course price.
        ctaLabel={cardActionLabel}
        note={t(courseIsFree ? "publicCourses.unlockNoteFree" : "publicCourses.unlockNote")}
      />
    ) : null}
    </>
  );
}

type CourseDetailAction = {
  label: string;
  href: string;
};

// Só para erro de verdade ou curso fora do ar; carregar usa o esqueleto.
function CourseDetailState({
  title,
  detail,
  action,
  nested = false,
  lead = null,
  retry,
}: {
  title: string;
  detail: string;
  action?: CourseDetailAction;
  /** O servidor já pôs o h1 do curso na página: este título vira h2. */
  nested?: boolean;
  /** O cabeçalho do servidor (o único h1) segue no alto, acima do aviso. */
  lead?: ReactNode;
  /** Erro de leitura: o aviso ganha "Try again", e a saída vira link discreto. */
  retry?: { onRetry: () => void; busy: boolean };
}) {
  const { t } = useTranslation();
  const hasRealCourses = useHasRealCourses();
  const sectionRef = useRef<HTMLElement>(null);
  const resolvedAction = action ?? (hasRealCourses
    ? { label: t("publicCourses.openMarketplace"), href: "/courses" }
    : { label: t("publicPages.notFound.home"), href: "/" });
  const Heading = nested ? "h2" : "h1";

  // Sem o sobretítulo "Creator course": era vocabulário interno.
  return (
    <>
    {lead}
    <section ref={sectionRef} tabIndex={retry ? -1 : undefined} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
      <Heading className="display-title text-4xl text-[var(--color-ink)]">
        {title}
      </Heading>
      {retry ? (
        <>
          <LoadErrorAlert className="mt-4 max-w-2xl" focusRef={sectionRef} onRetry={retry.onRetry} busy={retry.busy}>
            {detail}
          </LoadErrorAlert>
          <Link
            href={resolvedAction.href}
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-primary)]! underline-offset-4 hover:underline"
          >
            {resolvedAction.label}
          </Link>
        </>
      ) : (
        <>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {detail}
          </p>
          <Link
            href={resolvedAction.href}
            className="button-solid mt-6 inline-flex px-5 py-2.5 text-sm"
          >
            {resolvedAction.label}
          </Link>
        </>
      )}
    </section>
    </>
  );
}

/**
 * Owner/admin-aware messaging for a course that exists but is not published.
 * Strangers never reach this — RLS rejects their read of an unpublished
 * course, which surfaces as the error state instead. So the only
 * viewers here are the course owner, an admin, or (rarely) an enrolled learner.
 */
function getUnpublishedCourseState(
  status: TeacherCourseStatus,
  viewer: { isOwner: boolean; isAdmin: boolean },
  t: (key: string) => string,
): { title: string; detail: string; action?: CourseDetailAction } {
  const opsAction: CourseDetailAction = {
    label: t("publicCourses.opsReview"),
    href: "/ops",
  };
  const teachAction: CourseDetailAction = {
    label: t("publicCourses.teachDashboard"),
    href: "/teach",
  };

  // in_review: the blocking step is admin approval, so an admin viewer (even if
  // they also own it) is routed to the moderation queue to publish it.
  if (status === "in_review") {
    if (viewer.isAdmin) {
      return {
        title: t("publicCourses.awaitingApproval"),
        detail:
          t("publicCourses.approveBody"),
        action: opsAction,
      };
    }

    if (viewer.isOwner) {
      return {
        title: t("publicCourses.underReview"),
        detail:
          t("publicCourses.reviewBody"),
        action: teachAction,
      };
    }
  }

  // inactive: it was public before; the blocking step is an admin republish.
  if (status === "inactive") {
    if (viewer.isAdmin) {
      return {
        title: t("publicCourses.unpublished"),
        detail:
          t("publicCourses.republishBody"),
        action: { ...opsAction, label: t("publicCourses.opsQueue") },
      };
    }

    if (viewer.isOwner) {
      return {
        title: t("publicCourses.currentlyUnpublished"),
        detail:
          t("publicCourses.contactRepublish"),
        action: teachAction,
      };
    }
  }

  // draft / needs_changes: nothing is in the moderation queue yet — the blocking
  // step belongs to the owner (build + submit, or revise + resubmit). Route the
  // owner (incl. an owner who is also an admin) to their teaching dashboard.
  if (viewer.isOwner) {
    if (status === "needs_changes") {
      return {
        title: t("publicCourses.needsChanges"),
        detail:
          t("publicCourses.changesBody"),
        action: teachAction,
      };
    }

    return {
      title: t("publicCourses.draft"),
      detail:
        t("publicCourses.draftBody"),
      action: teachAction,
    };
  }

  if (viewer.isAdmin) {
    return {
      title: t("publicCourses.notPublicYet"),
      detail:
        t("publicCourses.notSubmitted"),
      action: { ...opsAction, label: t("publicCourses.opsQueue") },
    };
  }

  // Fallback — unreachable for an unpublished course: RLS rejects the read for
  // non-owner/non-admin viewers, which surfaces as the error state.
  return {
    title: t("publicCourses.notPublic"),
    detail: t("publicCourses.unpublishedFallback"),
  };
}
