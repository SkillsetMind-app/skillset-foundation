"use client";

import Link from "next/link";
import { Target } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { BunnyVideoPlayer } from "@/components/courses/bunny-video-player";
import {
  CourseInstructorCard,
  CourseReviewsSection,
} from "@/components/courses/course-social-proof";
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

type CreatorCourseDetailProps = {
  courseIdOverride?: string;
};

export function CreatorCourseDetail({ courseIdOverride }: CreatorCourseDetailProps = {}) {
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
    if (!landingCourseId) return;
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
  }, [landingCourseId]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [couponCode, setCouponCode] = useState("");
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
        setError("We could not load this course right now.");
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
    if (!resolvedCourseId || !hasBackendConfig || !freePreviewLessonId) {
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
  }, [resolvedCourseId, hasBackendConfig, freePreviewLessonId]);

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
          throw new Error(body.error || "Offers are temporarily unavailable.");
        }
        setOfferLoadError("");
        setOfferState({ courseId: resolvedCourseId, offers: body.offers ?? [] });
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setOfferLoadError(
          loadError instanceof Error
            ? loadError.message
            : "Offers are temporarily unavailable.",
        );
      });

    return () => controller.abort();
  }, [course?.status, resolvedCourseId]);

  if (!courseRef) {
    return (
      <CourseDetailState
        title="Course not selected."
        detail="Open the marketplace and choose a creator-published course."
      />
    );
  }

  if (!hasBackendConfig) {
    return (
      <CourseDetailState
        title="Course details are unavailable right now."
        detail="We could not connect to the course catalog. Refresh the page or try again shortly."
      />
    );
  }

  if (isLoading) {
    return (
      <CourseDetailState
        title="Loading course..."
        detail="We are checking the published course record."
      />
    );
  }

  if (error) {
    return <CourseDetailState title="Course unavailable." detail={error} />;
  }

  if (!course) {
    return (
      <CourseDetailState
        title="Course not found."
        detail="This course may be unavailable or no longer listed in the marketplace."
      />
    );
  }

  const isSellable = isCoursePubliclySellable(course.status);
  if (!isSellable) {
    const isOwner = user != null && course.ownerId === user.uid;
    const isAdmin = hasPermission({ roles: user?.roles }, "platform.accessAdmin");

    return (
      <CourseDetailState
        {...getUnpublishedCourseState(course.status, { isOwner, isAdmin })}
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
        ? "Pricing unavailable"
        : "Loading pricing..."
      : !resolvedPrice && hasExplicitOffer
        ? "Offer unavailable"
        : courseIsFree
      ? "Free"
      : resolvedPrice
      ? `${new Intl.NumberFormat("en", {
          style: "currency",
          currency: resolvedPrice.currency,
        }).format(resolvedPrice.amountMinor / 100)}${
          subscriptionInterval ? ` / ${subscriptionInterval}` : ""
        }`
      : "Pricing pending";
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
  const ratingLabel =
    course.ratingCount && course.ratingAverage
      ? `${course.ratingAverage.toFixed(1)} / 5 from ${course.ratingCount} review${course.ratingCount === 1 ? "" : "s"}`
      : "No learner reviews yet";
  const learningOutcomes = normalizeLearningOutcomes(course.learningOutcomes);

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
    } catch (checkoutError) {
      setCheckoutError(
        checkoutError instanceof Error && checkoutError.message
          ? checkoutError.message
          : "We could not start secure checkout. Try again or contact support.",
      );
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
    } catch (enrollmentError) {
      setCheckoutError(
        enrollmentError instanceof Error && enrollmentError.message
          ? enrollmentError.message
          : "We could not add this free course to your learning workspace. Try again or contact support.",
      );
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
      `/courses/${encodeURIComponent(courseRef)}${query ? `?${query}` : ""}`,
      { scroll: false },
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
      <section>
        <div className="primary-fill-card rounded-[20px] border border-[var(--color-line)] bg-[var(--color-primary)] p-8 text-white shadow-[var(--shadow-soft)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
            From an independent educator
          </p>
          <h1 className="display-title mt-4 text-6xl leading-tight">
            {course.title}
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-white/78">
            {course.summary}
          </p>
        </div>

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
          <section className="mt-8 rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              What you&apos;ll learn
            </p>
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

        <section
          id="free-preview"
          className="mt-8 rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Free preview
          </p>
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
                    || "This lesson is open so learners can judge the teaching style before enrolling."}
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
                >
                  Open preview resource
                </a>
              ) : null}
              {!previewLessonRawExternalUrl && previewVideoSource !== "upload" ? (
                <p className="rounded-[12px] bg-white p-4 text-xs leading-6 text-[var(--color-ink-soft)]">
                  Preview media can be attached by the educator as a video,
                  external lesson link, or text resource.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-5 rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
              This educator has not selected a public preview lesson yet.
            </p>
          )}
          <p className="mt-4 text-xs leading-6 text-[var(--color-ink-soft)]">
            Enroll to open the remaining {lockedLessonCount} lesson
            {lockedLessonCount === 1 ? "" : "s"} in this course.
          </p>
        </section>

        <section className="mt-8 rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Course structure
          </p>
          <div className="mt-5 grid gap-4">
            {course.modules.length === 0 ? (
              <p className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
                The course is approved, but the public curriculum preview is
                still being prepared.
              </p>
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
                          {lesson.type.replace("_", " ")}
                          {lesson.durationMinutes ? ` - ${lesson.durationMinutes} min` : ""}
                          {course.freePreviewLessonId === lesson.id ? " - preview" : ""}
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
      </section>

      <aside className="h-fit rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          At a glance
        </p>
        {offers.length > 1 ? (
          <fieldset className="mt-5 border-y border-[var(--color-line)] py-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
              Choose an offer
            </legend>
            <div className="mt-2 divide-y divide-[var(--color-line)]">
              {offers.map((offer) => {
                const price = offer.prices.find((entry) => entry.active !== false);
                const interval =
                  price?.paymentType === "subscription_monthly"
                    ? " / month"
                    : price?.paymentType === "subscription_yearly"
                      ? " / year"
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
                            ? "Free"
                            : `${new Intl.NumberFormat("en", {
                                style: "currency",
                                currency: price.currency,
                              }).format(price.amountMinor / 100)}${interval}`
                          : "Unavailable"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        <dl className="mt-5 grid gap-4">
          {[
            ["Category", course.category],
            // Don't leak the internal "in_review" state to buyers, and don't
            // falsely claim "Published" — an in_review course on sale is
            // truthfully "Available".
            ["Status", "Published"],
            ["Lessons", String(course.lessonCount)],
            ["Price", priceLabel],
            ["Rating", ratingLabel],
            [
              "Access",
              courseIsFree
                ? "Free enrollment"
                : checkoutEnabled
                  ? "Secure checkout"
                  : "Checkout pending",
            ],
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
          <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            Checkout was cancelled. Your card was not charged.
          </p>
        ) : null}

        {checkoutStatus === "success" ? (
          <p className="mt-5 info-notice">
            Payment received. Your course access opens automatically — usually within a few seconds.
          </p>
        ) : null}

        {checkoutError ? (
          <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {checkoutError}
          </p>
        ) : null}

        {offerLoadError || (pricingReady && hasExplicitOffer && !resolvedPrice) ? (
          <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {offerLoadError || "The selected offer is no longer available."}
          </p>
        ) : null}

        {authStatus !== "authenticated" ? (
          <div className="mt-6 grid gap-3">
            <Link href="/auth?mode=signup" className="button-solid w-full justify-center px-5 py-2.5 text-sm">
              Create account to enroll
            </Link>
            <Link href="/auth?mode=signin" className="button-outline w-full justify-center px-5 py-2.5 text-sm">
              Sign in
            </Link>
          </div>
        ) : (
          <>
            {canCheckout && !subscriptionInterval ? (
              <label className="mt-6 block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                  Coupon code
                </span>
                <input
                  value={couponCode}
                  onChange={(event) =>
                    setCouponCode(
                      event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9-]/g, "")
                        .slice(0, 32),
                    )
                  }
                  autoComplete="off"
                  placeholder="Optional"
                  className="mt-2 w-full rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
                />
              </label>
            ) : null}
            {canEnrollFree ? (
              <button
                type="button"
                onClick={handleFreeEnrollment}
                disabled={isEnrollingFree}
                className="button-solid mt-6 w-full px-5 py-2.5 text-sm disabled:opacity-60"
              >
                {isEnrollingFree ? "Adding to your workspace..." : "Enroll free"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCheckout}
                disabled={!canCheckout || isCheckingOut}
                className="button-solid mt-6 w-full px-5 py-2.5 text-sm disabled:opacity-60"
              >
                {isCheckingOut
                  ? "Opening secure checkout..."
                  : checkoutEnabled && hasPaidPrice
                    ? `${subscriptionInterval ? "Subscribe" : "Enroll"} for ${priceLabel}`
                    : "Checkout not available yet"}
              </button>
            )}
            {!checkoutEnabled ? (
              <p className="mt-3 rounded-[10px] border border-[rgba(24,58,94,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-xs leading-6 text-[var(--color-ink-soft)]">
                Checkout is not available yet. You can preview this course now
                and enroll once purchasing opens on SkillsetMind.
              </p>
            ) : null}
          </>
        )}

        <p className="mt-3 text-xs leading-6 text-[var(--color-ink-soft)]">
          {courseIsFree
            ? "Free enrollment attaches this course to your learning workspace immediately."
            : "Paid access opens automatically once your payment is confirmed — usually within seconds."}
        </p>

        {/* Risk reversal at the point of purchase. States the REAL policy
            (automaticRefundWindowDays = 7, progress < 50% — see requestRefund),
            never an invented "30-day guarantee" the platform doesn't honor. */}
        {!courseIsFree ? (
          <p className="mt-3 rounded-[10px] border border-[rgba(26,54,93,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-xs leading-6 text-[var(--color-ink-soft)]">
            <strong className="text-[var(--color-ink)]">
              7-day refund guarantee.
            </strong>{" "}
            Not the right fit? Request a refund within 7 days, as long as you
            have completed less than half the course.
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
            <strong className="text-[var(--color-ink)]">
              Sold by your instructor, not by SkillsetMind.
            </strong>{" "}
            This course is sold directly by the independent educator who
            publishes it. Your payment goes to their own Stripe account, so
            their name or business name — not &ldquo;SkillsetMind&rdquo; — is
            what may appear on your card statement.
          </p>
        ) : null}

        {/* Instructor identity: buyers were asked to pay without ever seeing
            WHO teaches the course. Renders only when the teacher has a
            published public profile (function-projected, never fabricated). */}
        <CourseInstructorCard teacherId={course.ownerId} />

        <Link
          href="/courses"
          className="mt-4 inline-flex w-full justify-center text-sm font-semibold text-[var(--color-primary)]"
        >
          Back to all courses
        </Link>
      </aside>
    </div>
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
  const resolvedAction = action ?? { label: "Open marketplace", href: "/courses" };

  return (
    <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Creator course
      </p>
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
): { title: string; detail: string; action?: CourseDetailAction } {
  const opsAction: CourseDetailAction = {
    label: "Review in moderation queue",
    href: "/ops",
  };
  const teachAction: CourseDetailAction = {
    label: "Open teaching dashboard",
    href: "/teach",
  };

  // in_review: the blocking step is admin approval, so an admin viewer (even if
  // they also own it) is routed to the moderation queue to publish it.
  if (status === "in_review") {
    if (viewer.isAdmin) {
      return {
        title: "This course is awaiting approval.",
        detail:
          "It was submitted for review but is not public yet. Approve publication from the moderation queue to take it live.",
        action: opsAction,
      };
    }

    if (viewer.isOwner) {
      return {
        title: "This course is under review.",
        detail:
          "You submitted it for approval. SkillsetMind publishes it once review is complete — you'll be notified. Track its status from your teaching dashboard.",
        action: teachAction,
      };
    }
  }

  // inactive: it was public before; the blocking step is an admin republish.
  if (status === "inactive") {
    if (viewer.isAdmin) {
      return {
        title: "This course is unpublished.",
        detail:
          "It was published before and is currently inactive. Republish it from the moderation queue to make it public again.",
        action: { ...opsAction, label: "Open moderation queue" },
      };
    }

    if (viewer.isOwner) {
      return {
        title: "This course is currently unpublished.",
        detail:
          "It is not visible to learners right now. Contact SkillsetMind support if you need it republished.",
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
        title: "This course needs changes before it goes live.",
        detail:
          "A reviewer asked for updates. Make the requested changes and resubmit it for approval from your teaching dashboard.",
        action: teachAction,
      };
    }

    return {
      title: "This course is still a draft.",
      detail:
        "Finish building it and submit it for review from your teaching dashboard. It becomes public once SkillsetMind approves it.",
      action: teachAction,
    };
  }

  if (viewer.isAdmin) {
    return {
      title: "This course is not public yet.",
      detail:
        "The educator has not submitted it for review, so there is nothing in the moderation queue to approve. It will appear here once they submit it.",
      action: { ...opsAction, label: "Open moderation queue" },
    };
  }

  // Fallback — unreachable for an unpublished course: RLS rejects the read for
  // non-owner/non-admin viewers, which surfaces as the error state.
  return {
    title: "Course is not public.",
    detail: "This course may still be in review, inactive, or unavailable.",
  };
}
