"use client";

import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";

import { useTranslation } from "@/components/i18n/i18n-provider";

import Link from "next/link";
import { Star, Target } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { BunnyVideoPlayer } from "@/components/courses/bunny-video-player";
import {
  CourseInstructorCard,
  CourseReviewsSection,
  useInstructorProfile,
} from "@/components/courses/course-social-proof";
import { UserAvatar } from "@/components/shared/user-avatar";
import { getSafeExternalUrl } from "@/domain/external-url";
import { CourseLandingBlocks } from "@/components/courses/course-landing-blocks";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import type { CourseLanding } from "@/lib/data/course-landings";
import { emptyCourseLanding, getCourseLanding } from "@/lib/data/course-landings";
import {
  resolveCoursePrice,
  type ProductOffer,
} from "@/domain/product-pricing";
import type { TeacherCourse, TeacherCourseStatus } from "@/domain/teacher-course";
import {
  isCoursePubliclySellable,
  normalizeLearningOutcomes,
  resolveLessonVideoSource,
} from "@/domain/teacher-course";
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
import { PaymentRequestError } from "@/lib/payments/client-fetch";

type CreatorCourseDetailProps = {
  courseIdOverride?: string;
  /** A página já renderizou título e resumo no servidor (mesmo padrão de PlatformShell). */
  hideHeader?: boolean;
  checkoutOnly?: boolean;
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
}: CreatorCourseDetailProps = {}) {
  const { t, locale } = useTranslation();
  const { status: authStatus, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
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

  useEffect(() => {
    if (!courseRef || !hasBackendConfig) {
      return;
    }

    return subscribeToViewableTeacherCourse(
      courseRef,
      (nextCourse) => {
        setCourse(nextCourse);
        setIsLoading(false);
      },
      () => {
        setError("publicCourses.courseLoadError");
        setIsLoading(false);
      },
    );
  }, [courseRef, hasBackendConfig]);

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
  }, [course?.status, resolvedCourseId]);

  if (!courseRef) {
    return (
      <CourseDetailState
        title={t("publicCourses.notSelected")}
        detail={t("publicCourses.chooseCourse")}
      />
    );
  }

  if (!hasBackendConfig) {
    return (
      <CourseDetailState
        title={t("publicCourses.detailsUnavailable")}
        detail={t("publicCourses.connectionError")}
      />
    );
  }

  if (isLoading) {
    return (
      <CourseDetailState
        title={t("publicCourses.loadingCourse")}
        detail={t("publicCourses.checkingCourse")}
      />
    );
  }

  if (error) {
    return <CourseDetailState title={t("publicCourses.unavailable")} detail={t(error)} />;
  }

  if (!course) {
    return (
      <CourseDetailState
        title={t("publicCourses.notFound")}
        detail={t("publicCourses.notListed")}
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
  const canCheckout =
    pricingReady
    && checkoutEnabled
    && authStatus === "authenticated"
    && Boolean(user)
    && Boolean(resolvedPrice)
    && (resolvedPrice?.amountMinor ?? 0) > 0;
  const hasPaidPrice =
    pricingReady && Boolean(resolvedPrice) && (resolvedPrice?.amountMinor ?? 0) > 0;
  const canEnrollFree =
    pricingReady
    && authStatus === "authenticated"
    && Boolean(user)
    && courseIsFree;
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
  const hasRating = Boolean(course.ratingCount && course.ratingAverage);
  const learningOutcomes = normalizeLearningOutcomes(course.learningOutcomes);
  // Duracao real do curso, somada das aulas. Sem minuto declarado em nenhuma
  // aula o dado simplesmente nao aparece — nao se estima tempo de curso.
  const totalMinutes = course.modules.reduce(
    (sum, module) =>
      sum
      + module.lessons.reduce(
        (lessonSum, lesson) => lessonSum + (lesson.durationMinutes ?? 0),
        0,
      ),
    0,
  );
  const durationLabel =
    totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60 ? ` ${totalMinutes % 60}m` : ""}`
      : totalMinutes > 0
        ? `${totalMinutes} min`
        : null;
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
  const returnTo = `${coursePath}${returnParams.size ? `?${returnParams}` : ""}`;
  const enrollLabel = courseIsFree
    ? t("publicCourses.enrollFree")
    : pricingReady && hasPaidPrice
      ? `${subscriptionInterval ? t("publicCourses.subscribe") : t("publicCourses.enroll")} — ${priceLabel}`
      : t("publicCourses.enroll");
  // Secoes que EXISTEM nesta pagina. Um menu que oferece "Reviews" para um
  // curso sem resenha leva a pessoa para lugar nenhum, entao cada item so
  // entra quando a secao correspondente vai ser desenhada.
  const sectionLinks: [string, string][] = [
    [t("publicCourses.overview"), "#overview"],
    ...(learningOutcomes.length > 0
      ? ([[t("publicCourses.outcomes"), "#what-you-will-learn"]] as [string, string][])
      : []),
    [t("publicCourses.preview"), "#free-preview"],
    [t("publicCourses.curriculum"), "#curriculum"],
    ...(hasRating ? ([[t("publicCourses.reviews"), "#reviews"]] as [string, string][]) : []),
    ...(instructorProfile
      ? ([[t("publicCourses.instructor"), "#instructor"]] as [string, string][])
      : []),
  ];

  async function handleCheckout() {
    if (!course || !resolvedPrice || !canCheckout || !checkoutEnabled) {
      return;
    }

    const checkoutCourseId = course.id;
    setCheckoutError("");
    setIsCheckingOut(true);

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
    <div className={checkoutOnly ? "mx-auto grid w-full min-w-0 max-w-2xl gap-6" : "grid gap-8 pb-24 lg:grid-cols-[1.15fr_0.85fr] lg:pb-0"}>
      <section className="min-w-0">
        {hideHeader ? null : (
          <div
            id="overview"
            className="primary-fill-card scroll-mt-24 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-primary)] p-8 text-white shadow-[var(--shadow-soft)]"
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
            {instructorName ? (
              <Link
                href={`/instructors/${encodeURIComponent(course.ownerId)}`}
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-[var(--color-ink)] underline-offset-4 hover:underline"
              >
                <UserAvatar
                  name={instructorName}
                  photoURL={instructorProfile?.photoURL}
                  size="sm"
                />
                {instructorName}
              </Link>
            ) : null}
            {instructorProfile?.credentials?.[0] ? (
              <span className="min-w-0 truncate">
                {instructorProfile.credentials[0]}
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
          onEnrol={handleCheckout}
        />

        {learningOutcomes.length > 0 ? (
          <section
            id="what-you-will-learn"
            className="mt-8 scroll-mt-24 rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.outcomes")}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {learningOutcomes.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-white text-[var(--color-primary)]">
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

        <section
          id="free-preview"
          className="mt-8 scroll-mt-24 rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.preview")}</p>
          {previewLesson ? (
            <div className="mt-5 grid gap-4 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                  {previewLesson.moduleTitle}
                </p>
                <h2 className="display-title mt-2 text-4xl leading-tight text-[var(--color-primary)]">
                  {previewLesson.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                  {previewLesson.description
                    || t("publicCourses.previewDescription")}
                </p>
              </div>
              {previewLessonContentText ? (
                <div className="rounded-[12px] bg-white p-4 text-sm leading-7 text-[var(--color-ink)]">
                  {previewLessonContentText}
                </div>
              ) : null}
              {previewLessonEmbed ? (
                <div className="overflow-hidden rounded-[12px] border border-[var(--color-line)] bg-[var(--color-primary)]">
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
                <div className="overflow-hidden rounded-[12px] border border-[var(--color-line)] bg-[var(--color-primary)]">
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
              {!previewLessonRawExternalUrl && previewVideoSource !== "upload" ? (
                <p className="rounded-[12px] bg-white p-4 text-xs leading-6 text-[var(--color-ink-soft)]">{t("publicCourses.previewMedia")}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-5 rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">{t("publicCourses.noPreview")}</p>
          )}
          <p className="mt-4 text-xs leading-6 text-[var(--color-ink-soft)]">
            {t(lockedLessonCount === 1 ? "publicCourses.lockedOne" : "publicCourses.lockedMany").replace("{count}", String(lockedLessonCount))}
          </p>
        </section>

        <section
          id="curriculum"
          className="mt-8 scroll-mt-24 rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.structure")}</p>
          <div className="mt-5 grid gap-4">
            {course.modules.length === 0 ? (
              <p className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">{t("publicCourses.curriculumPending")}</p>
            ) : (
              course.modules.map((module) => (
                <div
                  key={module.id}
                  className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4"
                >
                  <h2 className="text-sm font-semibold text-[var(--color-ink)]">
                    {module.title}
                  </h2>
                  <div className="mt-4 grid gap-2">
                    {module.lessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        className="flex items-center justify-between gap-3 rounded-[10px] bg-white px-3 py-2 text-xs text-[var(--color-ink-soft)]"
                      >
                        <span className="font-semibold text-[var(--color-ink)]">
                          {lesson.title}
                        </span>
                        <span className="shrink-0 text-right uppercase tracking-[0.16em]">
                          {t(`publicCourses.lessonTypes.${lesson.type}`)}
                          {lesson.durationMinutes ? ` - ${lesson.durationMinutes} min` : ""}
                          {course.freePreviewLessonId === lesson.id ? ` - ${t("publicCourses.previewShort")}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

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
        id="enroll-card"
        className="min-w-0 h-fit scroll-mt-24 self-start rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] lg:sticky lg:top-24"
      >
        {/* O preco era a quarta de seis linhas de uma lista "At a glance",
            entre "Status: Published" e "Access: Secure checkout" — vocabulario
            interno que o comprador nao precisa ler. Agora ele e o numero
            grande no topo do cartao. */}
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.access")}</p>
        <p className="display-title mt-1 flex flex-wrap items-baseline gap-2 text-4xl leading-none text-[var(--color-primary)]">
          <span>{priceLabel}</span>
          {billingSuffix ? (
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)] [font-family:var(--font-sans)]">
              · {billingSuffix}
            </span>
          ) : null}
        </p>

        <div className="mt-5 h-px bg-[var(--color-line)]" />
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
        {/* Status e Access sairam: "Published" e o estado interno do curso e
            "Secure checkout" e como a plataforma cobra — nenhum dos dois ajuda
            a decidir. O preco virou o numero grande acima, e a nota subiu para
            a assinatura do instrutor. */}
        <dl className="mt-5 grid gap-4">
          {[
            [t("publicCourses.category"), getCourseCategoryLabel(course.category, t)],
            [t("publicCourses.lessons"), String(course.lessonCount)],
            ...(durationLabel ? [[t("publicCourses.duration"), durationLabel]] : []),
          ].map(([label, value]) => (
            <div
              key={label}
              className="border-b border-[var(--color-line)] pb-4 last:border-b-0 last:pb-0"
            >
              <dt className="text-xs uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                {label}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {checkoutStatus === "cancelled" ? (
          <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">{t("publicCourses.cancelled")}</p>
        ) : null}

        {checkoutStatus === "success" ? (
          <p className="mt-5 info-notice">{t("publicCourses.paymentReceived")}</p>
        ) : null}

        {checkoutError ? (
          <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {t(checkoutError)}
          </p>
        ) : null}

        {offerLoadError || (pricingReady && hasExplicitOffer && !resolvedPrice) ? (
          <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {offerLoadError ? t(offerLoadError) : t("publicCourses.selectedOfferUnavailable")}
          </p>
        ) : null}

        {authStatus !== "authenticated" ? (
          // Visitante: o botao principal diz o que ele faz e quanto custa, e
          // leva a criar conta. `returnTo` traz a pessoa de volta a ESTE curso
          // depois de entrar, em vez de deixa-la na home.
          <div className="mt-6 grid gap-3">
            <Link
              href={`/auth?mode=signup&returnTo=${encodeURIComponent(returnTo)}`}
              className="button-solid w-full justify-center px-5 py-2.5 text-sm"
            >
              {enrollLabel}
            </Link>
            <Link
              href={`/auth?mode=signin&returnTo=${encodeURIComponent(returnTo)}`}
              className="button-outline w-full justify-center px-5 py-2.5 text-sm"
            >{t("publicCourses.signIn")}</Link>
          </div>
        ) : (
          <>
            {canEnrollFree ? (
              <button
                type="button"
                onClick={handleFreeEnrollment}
                disabled={isEnrollingFree}
                className="button-solid mt-6 w-full px-5 py-2.5 text-sm disabled:opacity-60"
              >
                {isEnrollingFree ? t("publicCourses.addingCourse") : t("publicCourses.enrollFree")}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCheckout}
                disabled={!canCheckout || isCheckingOut}
                className="button-solid mt-6 w-full px-5 py-2.5 text-sm disabled:opacity-60"
              >
                {isCheckingOut
                  ? t("publicCourses.openingCheckout")
                  : checkoutEnabled && hasPaidPrice
                    ? enrollLabel
                    : t("publicCourses.checkoutUnavailable")}
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
                    className="mt-2 w-full rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
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
              <p className="mt-3 rounded-[10px] border border-[rgba(24,58,94,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-xs leading-6 text-[var(--color-ink-soft)]">{t("publicCourses.checkoutLater")}</p>
            ) : null}
          </>
        )}

        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
          {courseIsFree
            ? t("publicCourses.freeAccess")
            : t("publicCourses.paidAccess")}
        </p>

        {/* Risk reversal at the point of purchase. States the REAL policy
            (automaticRefundWindowDays = 7, progress < 50% — see requestRefund),
            never an invented "30-day guarantee" the platform doesn't honor. */}
        {!courseIsFree ? (
          <p className="mt-3 rounded-[10px] border border-[rgba(26,54,93,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-xs leading-6 text-[var(--color-ink-soft)]">
            <strong className="text-[var(--color-ink)]">{t("publicCourses.refundTitle")}</strong>{" "}
            {t("publicCourses.refundBody")}
          </p>
        ) : null}

        {/* Direct charges: the buyer's counterparty is the EDUCATOR, not
            SkillsetMind. The charge is created on the educator's own connected
            account (see /api/payments/checkout, `stripeAccount`) and we set no
            statement_descriptor override, so THEIR descriptor reaches the card
            statement. A buyer who does not expect that name disputes it, and
            the chargeback lands on the educator's balance. */}
        {!courseIsFree ? (
          <p className="mt-3 rounded-[10px] border border-[rgba(26,54,93,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-xs leading-6 text-[var(--color-ink-soft)]">
            <strong className="text-[var(--color-ink)]">{t("publicCourses.sellerTitle")}</strong>{" "}
            {t("publicCourses.sellerBody")}
          </p>
        ) : null}

        <Link
          href="/courses"
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center text-sm font-semibold text-[var(--color-primary)]"
        >{t("publicCourses.backCourses")}</Link>
      </aside>
    </div>

    {/* No celular a coluna do cartao cai para o fim da pagina: para achar o
        preco e o botao era preciso rolar por todo o curriculo. Esta barra
        mantem os dois a mao e leva ao cartao. Escondida a partir de lg, onde
        o cartao ja acompanha a rolagem na coluna lateral. */}
    {!checkoutOnly ? <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-3 lg:hidden">
      <div className="pointer-events-auto flex items-center gap-3 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)]/95 px-4 py-3 shadow-[0_-6px_30px_rgba(15,39,68,0.18)] backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface)]/85">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">{t("publicCourses.access")}</p>
          <p className="display-title truncate text-xl leading-none text-[var(--color-primary)]">
            {priceLabel}
          </p>
        </div>
        <Link
          href="#enroll-card"
          className="button-solid inline-flex min-h-11 shrink-0 items-center px-3.5 py-2 text-xs"
        >{t("publicCourses.enroll")}</Link>
      </div>
    </div> : null}
    </>
  );
}

type CourseDetailAction = {
  label: string;
  href: string;
};

function CourseDetailState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: CourseDetailAction;
}) {
  const { t } = useTranslation();
  const resolvedAction = action ?? { label: t("publicCourses.openMarketplace"), href: "/courses" };

  return (
    <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.creatorCourse")}</p>
      <h1 className="display-title mt-3 text-4xl text-[var(--color-ink)]">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
      <Link
        href={resolvedAction.href}
        className="button-solid mt-6 inline-flex px-5 py-2.5 text-sm"
      >
        {resolvedAction.label}
      </Link>
    </section>
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
