"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  LockKeyhole,
  MessageCircle,
  PlayCircle,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { CourseCommunityFeed } from "@/components/learn/course-community-feed";
import { CourseReviewPanel } from "@/components/learn/course-review-panel";
import { MembersAreaHero } from "@/components/learn/members-area-hero";
import { CourseSubscriptionCard } from "@/components/learn/course-subscription-card";
import { WatermarkedVideoPlayer } from "@/components/learn/watermarked-video-player";
import type { CourseAsset } from "@/domain/course-asset";
import { courseAssetKindLabels, formatCourseAssetSize } from "@/domain/course-asset";
import {
  getLessonUnlockState,
  type LessonUnlockState,
} from "@/domain/drip-policy";
import type { Enrollment } from "@/domain/enrollment";
import { getSafeExternalUrl } from "@/domain/external-url";
import type {
  CommunitySpace,
  Course,
  Lesson,
  LessonType,
} from "@/domain/learning";
import {
  getCourseProgressPercent,
  getNextCourseLesson,
} from "@/domain/lesson-progress";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import {
  recordLessonProgress,
  subscribeToCompletedLessons,
} from "@/lib/data/lesson-progress";
import {
  getProtectedCourseAssetObjectUrl,
  subscribeToCourseAssets,
} from "@/lib/data/course-assets";
import {
  addLessonComment,
  deleteLessonComment,
  subscribeToLessonComments,
  type LessonComment,
} from "@/lib/data/lesson-comments";
import {
  resolveLessonContent,
  subscribeToLessonContent,
  type LessonContent,
} from "@/lib/data/lesson-content";
import { track } from "@/lib/posthog/events";

type EnrolledCourseWorkspaceProps = {
  course: Course;
  enableFirestoreAssets?: boolean;
  previewExitHref?: string;
  previewMode?: boolean;
};

export function EnrolledCourseWorkspace({
  course,
  enableFirestoreAssets = false,
  previewExitHref,
  previewMode = false,
}: EnrolledCourseWorkspaceProps) {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  // Stripe's success_url carries ?checkout=success while the webhook is still
  // creating the enrollment — show "finalizing" instead of "Enrollment
  // required" during that gap (the realtime listener opens the workspace).
  const cameFromCheckout = searchParams?.get("checkout") === "success";
  const [checkoutGraceExpired, setCheckoutGraceExpired] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [isLoading, setIsLoading] = useState(!previewMode);
  const [progressState, setProgressState] = useState<{
    key: string | null;
    lessonIds: string[];
    ready: boolean;
  }>({
    key: null,
    lessonIds: [],
    ready: false,
  });
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [assetsState, setAssetsState] = useState<{
    assets: CourseAsset[];
    key: string | null;
    ready: boolean;
  }>({
    assets: [],
    key: null,
    ready: false,
  });
  // B1: gated lesson content streamed from courses/{id}/lessonContent. Merged
  // onto the rendered lesson, preferring the subcollection value and falling
  // back to the inline course-doc field for un-migrated courses.
  const [lessonContentState, setLessonContentState] = useState<{
    content: Map<string, LessonContent>;
    key: string | null;
    ready: boolean;
  }>({
    content: new Map(),
    key: null,
    ready: false,
  });
  const [error, setError] = useState("");
  const previewEnrollment: Enrollment = {
    id: `preview__${course.id}`,
    userId: user?.uid ?? "preview",
    courseId: course.id,
    courseSlug: course.slug,
    courseTitle: course.title,
    courseCategory: course.category,
    courseImage: course.image,
    status: "active",
    source: "admin",
    progressPercent: 0,
    lastLessonId: null,
  };
  const workspaceEnrollment = previewMode ? previewEnrollment : enrollment;
  const progressKey = workspaceEnrollment?.id ?? null;

  useEffect(() => {
    if (!cameFromCheckout) {
      return;
    }

    // After 90s without an enrollment the webhook is genuinely stuck — switch
    // the copy from "opening..." to a keep-the-page-open/support message.
    const timer = window.setTimeout(() => setCheckoutGraceExpired(true), 90_000);

    return () => window.clearTimeout(timer);
  }, [cameFromCheckout]);

  useEffect(() => {
    if (previewMode) {
      return;
    }

    if (!user) {
      return;
    }

    return subscribeToEnrollment(
      user.uid,
      course.slug,
      (nextEnrollment) => {
        setEnrollment(nextEnrollment);
        setIsLoading(false);
      },
      () => {
        setError("We could not confirm your enrollment for this course.");
        setIsLoading(false);
      },
    );
  }, [course.slug, previewMode, user]);

  useEffect(() => {
    if (previewMode || !workspaceEnrollment) {
      return;
    }

    return subscribeToCompletedLessons(
      workspaceEnrollment.id,
      (lessonIds) => {
        setProgressState({
          key: workspaceEnrollment.id,
          lessonIds,
          ready: true,
        });
      },
      () => {
        setError("We could not load lesson progress for this course.");
        setProgressState({
          key: workspaceEnrollment.id,
          lessonIds: [],
          ready: true,
        });
      },
    );
  }, [previewMode, workspaceEnrollment]);

  useEffect(() => {
    if (!enableFirestoreAssets || !workspaceEnrollment) {
      return;
    }

    return subscribeToCourseAssets(
      course.id,
      (assets) => {
        setAssetsState({
          assets,
          key: course.id,
          ready: true,
        });
      },
      () => {
        setError("We could not load lesson assets for this course.");
        setAssetsState({
          assets: [],
          key: course.id,
          ready: true,
        });
      },
    );
  }, [course.id, enableFirestoreAssets, workspaceEnrollment]);

  // B1: subscribe to the gated lesson-content subcollection for the active
  // course. Only meaningful for an enrolled (or preview) viewer, who passes the
  // enrollment gate in firestore.rules; a permission error degrades gracefully
  // to inline fallback rather than blocking the workspace.
  useEffect(() => {
    if (!workspaceEnrollment) {
      return;
    }

    return subscribeToLessonContent(
      course.id,
      (content) => {
        setLessonContentState({ content, key: course.id, ready: true });
      },
      () => {
        // Soft-fail: preserve whatever content we already loaded for this course
        // — never clobber it to an empty Map, or a transient rules/permission
        // hiccup would permanently blank an enrolled learner's lessons. Mark
        // ready so the workspace stops showing the loading state; pre-strip, the
        // inline course-doc fallback still covers any lesson without a doc.
        setLessonContentState((prev) =>
          prev.key === course.id
            ? { ...prev, ready: true }
            : { content: new Map(), key: course.id, ready: true },
        );
      },
    );
  }, [course.id, workspaceEnrollment]);

  // LESSON_STARTED — fires when the learner navigates to a lesson card.
  // Preview mode (teacher impersonating learner view) is excluded so the
  // funnel doesn't get polluted by author QA sessions.
  // Hook must live BEFORE the early returns to satisfy react-hooks/rules.
  useEffect(() => {
    if (previewMode) return;
    if (!selectedLessonId) return;
    const lessons = course.modules.flatMap((m) => m.lessons);
    const position = lessons.findIndex((l) => l.id === selectedLessonId);
    if (position < 0) return;
    track.lessonStarted({
      course_id: course.id,
      lesson_id: selectedLessonId,
      position: position + 1,
    });
  }, [selectedLessonId, course.id, course.modules, previewMode]);

  if (isLoading) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">Loading course workspace...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/learn" className="button-solid px-4 py-2.5 text-sm">
            Back to my learning
          </Link>
          <Link
            href={`/courses/${course.slug}`}
            className="button-outline px-4 py-2.5 text-sm"
          >
            Open course page
          </Link>
        </div>
      </section>
    );
  }

  if (!workspaceEnrollment) {
    if (cameFromCheckout) {
      return (
        <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Payment received
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {checkoutGraceExpired
              ? "Almost there — enrollment is taking longer than usual."
              : "Opening your course..."}
          </h3>
          <p role="status" className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {checkoutGraceExpired
              ? "Your payment went through and is safe. Keep this page open: it opens automatically the moment your enrollment is confirmed. If nothing happens in a few minutes, contact support with your payment receipt."
              : "Your payment is confirmed. We are setting up your course access right now; this page opens automatically in a few seconds."}
          </p>
        </section>
      );
    }

    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Enrollment required
        </p>
        <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          This private workspace opens after enrollment.
        </h3>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Open the public course page first, then add the course to your learning
          workspace.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/courses/${course.slug}`} className="button-solid px-4 py-2.5 text-sm">
            Open course page
          </Link>
          <Link href="/learn" className="button-outline px-4 py-2.5 text-sm">
            Back to My Learning
          </Link>
        </div>
      </section>
    );
  }

  const completedLessonIds = progressState.lessonIds;
  const isProgressLoading = Boolean(
    !previewMode
      && workspaceEnrollment
      && (!progressState.ready || progressState.key !== progressKey),
  );
  const progressPercent = getCourseProgressPercent(course, completedLessonIds);
  const nextLesson = getNextCourseLesson(course, completedLessonIds)?.lesson ?? null;
  const allLessons = course.modules.flatMap((module) => module.lessons);
  const lessonUnlockStateById = new Map(
    allLessons.map((lesson) => [
        lesson.id,
        getLessonUnlockState(course, lesson, workspaceEnrollment, completedLessonIds),
    ]),
  );
  const selectedLesson =
    allLessons.find((lesson) => lesson.id === selectedLessonId)
    ?? nextLesson
    ?? allLessons[0]
    ?? null;
  const selectedLessonUnlockState = selectedLesson
    ? lessonUnlockStateById.get(selectedLesson.id)
      ?? { unlocked: true, unlocksAt: null, reason: "available" }
    : null;
  // B1: prefer the gated subcollection content for the rendered lesson; fall
  // back to the inline course-doc field when the subcollection doc is absent
  // (un-migrated course, or content not yet streamed).
  const lessonContentMap =
    lessonContentState.key === course.id
      ? lessonContentState.content
      : null;
  // Post-strip the lesson body/resource live only in the gated subcollection, so
  // gate the panel on the subscription being ready to avoid a blank flash before
  // the first snapshot. Pre-strip the inline fallback already covers this.
  const isLessonContentLoading = Boolean(
    workspaceEnrollment
      && (!lessonContentState.ready || lessonContentState.key !== course.id),
  );
  const resolvedSelectedLesson: Lesson | null = selectedLesson
    ? {
        ...selectedLesson,
        ...resolveLessonContent(
          lessonContentMap?.get(selectedLesson.id),
          selectedLesson,
        ),
      }
    : null;
  const selectedLessonAssets =
    assetsState.key === course.id && selectedLesson
      ? assetsState.assets.filter((asset) => asset.lessonId === selectedLesson.id)
      : [];
  const courseLevelAssets =
    assetsState.key === course.id
      ? assetsState.assets.filter(
          (asset) =>
            !asset.lessonId
            && !asset.moduleId
            && asset.kind !== "course_cover",
        )
      : [];
  const assetCountByLessonId = new Map<string, number>();
  const thumbnailByLessonId = new Map<string, CourseAsset>();
  const coverByModuleId = new Map<string, CourseAsset>();
  const totalLessonCount = allLessons.length;
  const completedLessonCount = completedLessonIds.length;
  const selectedModule = selectedLesson
    ? course.modules.find((module) =>
        module.lessons.some((lesson) => lesson.id === selectedLesson.id),
      ) ?? null
    : null;
  const selectedLessonNumber = selectedLesson
    ? allLessons.findIndex((lesson) => lesson.id === selectedLesson.id) + 1
    : 0;
  // Members-area hero cover: the teacher's chosen members_cover CourseAsset
  // (resolved to a protected object URL inside the hero band). Only available
  // once Firestore assets are streamed (enableFirestoreAssets); otherwise the
  // hero falls back to the course image.
  const membersCoverAsset =
    course.membersCoverAssetId && assetsState.key === course.id
      ? assetsState.assets.find(
          (asset) =>
            asset.id === course.membersCoverAssetId
            && asset.kind === "members_cover",
        )
      : undefined;

  if (assetsState.key === course.id) {
    for (const asset of assetsState.assets) {
      if (asset.lessonId) {
        assetCountByLessonId.set(
          asset.lessonId,
          (assetCountByLessonId.get(asset.lessonId) ?? 0) + 1,
        );
      }

      if (asset.kind === "lesson_thumbnail" && asset.lessonId) {
        thumbnailByLessonId.set(asset.lessonId, asset);
      }

      if (asset.kind === "module_cover" && asset.moduleId) {
        coverByModuleId.set(asset.moduleId, asset);
      }
    }
  }

  async function toggleLessonCompletion(lessonId: string, completed: boolean) {
    if (previewMode) {
      setError("Preview mode is read-only. Student progress is not saved here.");
      return;
    }

    if (!user || !workspaceEnrollment) {
      return;
    }

    const unlockState = lessonUnlockStateById.get(lessonId);

    if (unlockState && !unlockState.unlocked) {
      setError("This lesson is still locked by the course release schedule.");
      return;
    }

    setError("");
    setActiveLessonId(lessonId);

    try {
      // Progress is computed server-side: recordLessonProgress validates the
      // lesson, writes the marker via the Admin SDK, and returns the
      // authoritative progressPercent. The completedLessons subscription
      // refreshes the UI checkmarks from the resulting Firestore write.
      const result = await recordLessonProgress(
        workspaceEnrollment.id,
        lessonId,
        !completed,
      );

      if (!completed) {
        // LESSON_COMPLETED — fired only on the mark→complete transition.
        // unmark (toggling off) is treated as a correction, not a milestone.
        const position = allLessons.findIndex((l) => l.id === lessonId);
        track.lessonCompleted({
          course_id: course.id,
          lesson_id: lessonId,
          position: position >= 0 ? position + 1 : 0,
        });
      }

      if (!completed && result.progressPercent >= 100) {
        // COURSE_COMPLETED — the course is finished (100% is the server's
        // authoritative figure, not a guess). The certificate is no longer
        // auto-issued here: the learner claims it from the credentials page,
        // where they enter the full legal name printed on the credential
        // (captured once, then permanently locked). credentialIssued fires
        // there, when a certificate actually exists.
        track.courseCompleted({
          course_id: course.id,
          lessons_completed: result.completedLessonCount,
        });
      }
    } catch {
      setError("We could not update lesson progress. Please try again.");
    } finally {
      setActiveLessonId(null);
    }
  }

  return (
    <div className="member-classroom">
      <MembersAreaHeroBand
        course={course}
        coverAsset={membersCoverAsset}
        progressPercent={previewMode ? null : progressPercent}
      />

      {previewMode ? (
        <section className="member-preview-banner">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--color-primary)]">
              Preview mode - this is how students will see your course.
            </p>
            {previewExitHref ? (
              <Link href={previewExitHref} className="button-outline px-4 py-2 text-xs">
                Exit preview
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Slim action strip below the members hero — the hero already carries the
          cover, title, description and progress, so this keeps only what it does
          not: the at-a-glance chips and the primary continue/certificate CTAs. */}
      <section className="member-classroom-actions flex flex-wrap items-center justify-between gap-4 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="member-meta-chip">
            <BookOpen size={14} aria-hidden />
            {course.modules.length} module{course.modules.length === 1 ? "" : "s"}
          </span>
          <span className="member-meta-chip">
            <PlayCircle size={14} aria-hidden />
            {totalLessonCount} lesson{totalLessonCount === 1 ? "" : "s"}
          </span>
          <span className="member-meta-chip">
            <Clock size={14} aria-hidden />
            {course.durationLabel}
          </span>
          <span className="member-meta-chip">
            {completedLessonCount} of {totalLessonCount} complete
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {nextLesson ? (
            <button
              type="button"
              onClick={() => setSelectedLessonId(nextLesson.id)}
              className="button-solid inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            >
              <PlayCircle size={16} aria-hidden />
              Continue watching
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const firstLessonId = course.modules[0]?.lessons[0]?.id;
                if (firstLessonId) {
                  setSelectedLessonId(firstLessonId);
                }
              }}
              className="button-outline inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            >
              <PlayCircle size={16} aria-hidden />
              Watch again
            </button>
          )}
          {progressPercent === 100 ? (
            <Link
              href="/learn/credentials"
              className="button-accent inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            >
              <Award size={16} aria-hidden />
              Get certificate
            </Link>
          ) : null}
        </div>
      </section>

      <div className="member-classroom-layout">
        <section className="member-classroom-player">
        {error ? (
          <p className="mb-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : null}
        {selectedLesson && resolvedSelectedLesson ? (
          <LessonContentPanel
            assets={selectedLessonAssets}
            completed={completedLessonIds.includes(selectedLesson.id)}
            courseId={course.id}
            enableFirestoreAssets={enableFirestoreAssets}
            isLoadingAssets={Boolean(
              enableFirestoreAssets
                && (!assetsState.ready || assetsState.key !== course.id),
            )}
            isLoadingContent={isLessonContentLoading}
            isSaving={activeLessonId === selectedLesson.id}
            lesson={resolvedSelectedLesson}
            unlockState={selectedLessonUnlockState}
            previewMode={previewMode}
            onToggleComplete={() =>
              toggleLessonCompletion(
                selectedLesson.id,
                completedLessonIds.includes(selectedLesson.id),
              )
            }
          />
        ) : null}
        </section>

        <aside className="member-classroom-sidebar">
          <div className="member-sidebar-card member-sidebar-card--dark">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">
              Now playing
            </p>
            <h4 className="mt-3 text-xl font-semibold text-white">
              {selectedLesson?.title ?? "No lesson selected"}
            </h4>
            <p className="mt-3 text-sm leading-6 text-white/70">
              {selectedModule
                ? `Module: ${selectedModule.title}`
                : "Select a lesson from the curriculum below."}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="member-dark-stat">
                <span>Lesson</span>
                <strong>{selectedLessonNumber || "-"}/{totalLessonCount || "-"}</strong>
              </div>
              <div className="member-dark-stat">
                <span>Files</span>
                <strong>{selectedLesson ? assetCountByLessonId.get(selectedLesson.id) ?? 0 : 0}</strong>
              </div>
            </div>
          </div>
          {!previewMode
            && workspaceEnrollment.source === "subscription"
            && workspaceEnrollment.subscriptionId ? (
            <CourseSubscriptionCard
              key={workspaceEnrollment.subscriptionId}
              courseId={course.id}
              subscriptionId={workspaceEnrollment.subscriptionId}
            />
          ) : null}
          <div className="member-sidebar-card">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              Continue learning
            </p>
            <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
              {nextLesson?.title ?? "All lessons complete"}
            </h4>
            <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
              Progress is saved against this enrollment and resumes from the next incomplete lesson.
            </p>
            {nextLesson ? (
              <button
                type="button"
                onClick={() => setSelectedLessonId(nextLesson.id)}
                className="button-solid mt-4 px-4 py-2.5 text-sm"
              >
                Continue
              </button>
            ) : (
              <Link href="/learn/credentials" className="button-solid mt-4 px-4 py-2.5 text-sm">
                View credential
              </Link>
            )}
          </div>
          <div className="member-sidebar-card">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              Workspace links
            </p>
            <div className="mt-4 grid gap-2">
              <Link href="/learn" className="member-sidebar-link">
                Back to My Learning
              </Link>
              <Link href={`/courses/${course.slug}`} className="member-sidebar-link">
                Public course page
              </Link>
              {progressPercent === 100 ? (
                <Link href="/learn/credentials" className="member-sidebar-link">
                  Credential status
                </Link>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      <section className="member-module-deck">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Curriculum
            </p>
            <h3 className="display-title mt-2 text-3xl text-[var(--color-ink)]">
              Modules and lessons
            </h3>
          </div>
          <p className="text-sm font-semibold text-[var(--color-ink-soft)]">
            Select any available lesson to open it in the player above.
          </p>
        </div>

        <div className="mt-6 grid gap-5">
          {course.modules.map((module, moduleIndex) => {
            const moduleCompletedCount = module.lessons.filter((lesson) =>
              completedLessonIds.includes(lesson.id),
            ).length;

            return (
              <article key={module.id} className="member-module-row">
                <div className="member-module-row__head">
                  <div className="member-module-row__cover">
                    <ProtectedAssetCover
                      asset={coverByModuleId.get(module.id)}
                      fallbackLabel={module.title}
                      compact
                    />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                      Module {moduleIndex + 1}
                    </p>
                    <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
                      {module.title}
                    </h4>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
                      {module.summary}
                    </p>
                  </div>
                  <span className="member-module-progress">
                    {moduleCompletedCount}/{module.lessons.length} complete
                  </span>
                </div>

                <div className="member-lesson-strip">
                  {module.lessons.map((lesson) => {
                    const unlockState =
                      lessonUnlockStateById.get(lesson.id)
                      ?? { unlocked: true, unlocksAt: null, reason: "available" };
                    const isCompleted = completedLessonIds.includes(lesson.id);
                    const selected = selectedLesson?.id === lesson.id;
                    const fileCount = assetCountByLessonId.get(lesson.id) ?? 0;

                    return (
                      <article
                        key={lesson.id}
                        className={`member-lesson-card ${selected ? "member-lesson-card--active" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedLessonId(lesson.id)}
                          className="block w-full text-left"
                        >
                          <div className="relative">
                            <ProtectedAssetCover
                              asset={thumbnailByLessonId.get(lesson.id)}
                              fallbackLabel={lesson.title}
                              compact
                            />
                            <span className="member-play-badge">
                              {unlockState.unlocked ? (
                                <PlayCircle size={16} aria-hidden />
                              ) : (
                                <LockKeyhole size={15} aria-hidden />
                              )}
                            </span>
                          </div>
                          <p className="mt-3 line-clamp-2 font-semibold text-[var(--color-ink)]">
                            {lesson.title}
                          </p>
                          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                            {lessonTypeLabels[lesson.type]}
                          </p>
                          {!unlockState.unlocked ? (
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent-fg)]">
                              {formatUnlockMessage(unlockState)}
                            </p>
                          ) : null}
                        </button>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="member-lesson-chip">
                            <Clock size={12} aria-hidden />
                            {lesson.duration}
                          </span>
                          {fileCount ? (
                            <span className="member-lesson-chip">
                              <Download size={12} aria-hidden />
                              {fileCount} file{fileCount === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          {isCompleted ? (
                            <span className="member-lesson-chip member-lesson-chip--done">
                              <CheckCircle2 size={12} aria-hidden />
                              Done
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            toggleLessonCompletion(
                              lesson.id,
                              isCompleted,
                            )
                          }
                          disabled={
                            previewMode
                            ||
                            !unlockState.unlocked
                            || isProgressLoading
                            || activeLessonId === lesson.id
                          }
                          className="button-outline mt-3 w-full px-3 py-2 text-[11px] disabled:opacity-60"
                        >
                          {activeLessonId === lesson.id
                            ? "Saving..."
                              : previewMode
                                ? "Preview only"
                                : isCompleted
                              ? "Mark incomplete"
                              : !unlockState.unlocked
                                ? "Locked"
                              : "Mark complete"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {enableFirestoreAssets ? (
        <CourseAssetResourceList
          assets={courseLevelAssets}
          isLoading={Boolean(
            enableFirestoreAssets
              && (!assetsState.ready || assetsState.key !== course.id),
          )}
        />
      ) : null}

      {course.communityEnabled && !previewMode ? (
        <CourseCommunitySection course={course} />
      ) : null}

      <CourseReviewPanel
        courseId={course.id}
        progressPercent={progressPercent}
        previewMode={previewMode}
      />
    </div>
  );
}

// Teacher-opt-in community, rendered inside the members area (product decision
// 2026-07-02: community lives here, not on a separate hub page). The space is
// keyed by course.id — the same key CreatorCourseCommunity uses — so both
// mounts read and write the same community_posts rows.
function CourseCommunitySection({ course }: { course: Course }) {
  const space: CommunitySpace = {
    id: `creator-${course.id}`,
    courseSlug: course.id,
    name: `${course.title} community`,
    description:
      "A course-linked space for announcements, questions, resources, and cohort discussion.",
    visibility: "enrolled_only",
    categories: ["announcement", "discussion", "question", "resource"],
  };

  return (
    <section className="member-resource-panel">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          Course community
        </p>
        <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
          Connect with other students in this course
        </h4>
      </div>
      <div className="mt-4">
        <CourseCommunityFeed space={space} />
      </div>
    </section>
  );
}

function MembersAreaHeroBand({
  course,
  coverAsset,
  progressPercent,
}: {
  course: Course;
  coverAsset?: CourseAsset;
  progressPercent: number | null;
}) {
  // Resolve the members_cover asset to a protected object URL, mirroring
  // ProtectedAssetCover (mount-guard + revoke on unmount/asset change).
  // Keyed by assetId so a stale resolve is ignored in render without a
  // synchronous setState clear (react-hooks/set-state-in-effect).
  const [objectUrlState, setObjectUrlState] = useState<{
    assetId: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!coverAsset || !coverAsset.contentType.startsWith("image/")) {
      return undefined;
    }

    let isMounted = true;
    let nextObjectUrl: string | null = null;

    getProtectedCourseAssetObjectUrl(coverAsset)
      .then((url) => {
        nextObjectUrl = url;

        if (isMounted) {
          setObjectUrlState({
            assetId: coverAsset.id,
            url,
          });
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;

      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [coverAsset]);

  const objectUrl =
    coverAsset && objectUrlState?.assetId === coverAsset.id
      ? objectUrlState.url
      : null;

  return (
    <MembersAreaHero
      theme={course.membersTheme ?? "dark"}
      coverUrl={objectUrl ?? course.image ?? null}
      title={course.membersTitle ?? course.title}
      subtitle={course.membersSubtitle ?? null}
      description={course.membersDescription ?? course.summary ?? null}
      progressPercent={progressPercent}
      backHref="/learn"
    />
  );
}

const lessonTypeLabels: Record<LessonType, string> = {
  video: "Video lesson",
  text: "Text lesson",
  quiz: "Quiz",
  assignment: "Assignment",
  live_recording: "Live recording",
  download: "Download",
  external_embed: "External embed",
};

const lessonTypeDescriptions: Record<LessonType, string> = {
  video: "Secure video playback will appear here when the instructor attaches the lesson media.",
  text: "Written lesson content will appear here when the instructor publishes the lesson body.",
  quiz: "Quiz questions and passing rules will appear here when assessment tools are connected.",
  assignment: "Assignment instructions, submission upload, and review status will appear here in the assignment module.",
  live_recording: "Recorded live sessions will appear here after the instructor uploads or links the replay.",
  download: "Downloadable files and supporting materials will appear here after upload.",
  external_embed: "External learning embeds will appear here when the instructor connects a trusted provider link.",
};

function formatUnlockMessage(unlockState: LessonUnlockState) {
  if (unlockState.unlocked) {
    return "Available";
  }

  if (unlockState.reason === "previous_lesson_required") {
    return "Complete the previous lesson to unlock";
  }

  if (unlockState.unlocksAt) {
    return `Unlocks ${new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(unlockState.unlocksAt)}`;
  }

  return "Locked";
}

function CourseAssetResourceList({
  assets,
  isLoading,
}: {
  assets: CourseAsset[];
  isLoading: boolean;
}) {
  return (
    <section className="member-resource-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Course resources
          </p>
          <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
            General files and visuals attached to this course
          </h4>
        </div>
        <span className="member-meta-chip">
          <FileText size={14} aria-hidden />
          {assets.length} file{assets.length === 1 ? "" : "s"}
        </span>
      </div>
      {isLoading ? (
        <p className="mt-4 rounded-[10px] bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
          Loading course resources...
        </p>
      ) : assets.length === 0 ? (
        <p className="mt-4 rounded-[10px] bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
          No general course resources are attached yet.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="rounded-[14px] border border-[var(--color-line)] bg-white p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    {asset.fileName}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {courseAssetKindLabels[asset.kind]} - {formatCourseAssetSize(asset.size)}
                  </p>
                </div>
                <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                  {asset.isPreview ? "Preview" : "Enrolled"}
                </span>
              </div>
              <ProtectedAssetPreview asset={asset} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LessonContentPanel({
  assets,
  completed,
  courseId,
  enableFirestoreAssets,
  isLoadingAssets,
  isLoadingContent,
  isSaving,
  lesson,
  previewMode,
  unlockState,
  onToggleComplete,
}: {
  assets: CourseAsset[];
  completed: boolean;
  courseId: string;
  enableFirestoreAssets: boolean;
  isLoadingAssets: boolean;
  isLoadingContent: boolean;
  isSaving: boolean;
  lesson: Lesson;
  previewMode: boolean;
  unlockState: LessonUnlockState | null;
  onToggleComplete: () => void;
}) {
  const locked = Boolean(unlockState && !unlockState.unlocked);
  // The lesson body + resource link live in the gated subcollection post-strip;
  // while that subscription is still loading and nothing has resolved yet, show
  // a loading state instead of the "not attached" empty copy.
  const lessonContentPending =
    isLoadingContent && !lesson.contentText && !lesson.externalUrl;
  const primaryHostedVideo = locked
    ? null
    : assets.find(
        (asset) =>
          (asset.kind === "lesson_video" || asset.kind === "live_recording")
          && asset.contentType.startsWith("video/"),
      ) ?? null;
  const supportingAssets = assets.filter(
    (asset) =>
      asset.kind !== "lesson_thumbnail"
      && (!primaryHostedVideo || asset.id !== primaryHostedVideo.id),
  );
  const trustedEmbed = locked || primaryHostedVideo
    ? null
    : getTrustedLessonEmbed(lesson.externalUrl);
  const safeLessonExternalUrl = getSafeExternalUrl(lesson.externalUrl);

  return (
    <div className="member-lesson-panel">
      <div className="member-lesson-panel__head">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {lessonTypeLabels[lesson.type]}
          </p>
          <h4 className="display-title mt-2 text-3xl text-[var(--color-ink)]">
            {lesson.title}
          </h4>
        </div>
        <span className="member-meta-chip">
          <Clock size={14} aria-hidden />
          {lesson.duration}
        </span>
      </div>

      <div className="member-video-stage">
        {locked ? (
          <div className="member-video-empty">
            <LockKeyhole size={28} aria-hidden />
            <h5>Lesson locked</h5>
            <p>{unlockState ? formatUnlockMessage(unlockState) : "Locked"}</p>
          </div>
        ) : primaryHostedVideo ? (
          <ProtectedAssetPreview asset={primaryHostedVideo} />
        ) : trustedEmbed ? (
          <iframe
            src={trustedEmbed.embedUrl}
            title={lesson.title}
            className="aspect-video w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : lessonContentPending ? (
          <div className="member-video-empty">
            <PlayCircle size={34} aria-hidden />
            <h5>Loading lesson content...</h5>
            <p>Fetching this lesson&apos;s media and notes.</p>
          </div>
        ) : (
          <div className="member-video-empty">
            <PlayCircle size={34} aria-hidden />
            <h5>{lesson.type === "text" ? "Text-first lesson" : "Media not attached yet"}</h5>
            <p>
              {lesson.type === "text"
                ? "Read the lesson notes below and use the discussion area if you need context."
                : "When the instructor uploads a video or connects an embed, it plays here."}
            </p>
          </div>
        )}
      </div>

      <div className="member-lesson-body">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            Lesson content
          </p>
          {lesson.isPreview ? (
            <span className="rounded-[8px] border border-[rgba(178,34,52,0.18)] bg-[rgba(178,34,52,0.05)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-fg)]">
              Free preview
            </span>
          ) : null}
        </div>
        {!locked && lesson.description ? (
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink)]">
            {lesson.description}
          </p>
        ) : null}
        {!locked && lessonContentPending ? (
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            Loading lesson content...
          </p>
        ) : null}
        {!locked && lesson.contentText ? (
          <div className="mt-4 whitespace-pre-line rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {lesson.contentText}
          </div>
        ) : null}
        {!locked && safeLessonExternalUrl && !trustedEmbed ? (
          <a
            href={safeLessonExternalUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="button-outline mt-4 inline-flex px-4 py-2.5 text-sm"
          >
            Open instructor resource
          </a>
        ) : null}
        <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
          {lessonTypeDescriptions[lesson.type]}
        </p>
        {!locked && enableFirestoreAssets ? (
          <LessonAssetList assets={supportingAssets} isLoading={isLoadingAssets} />
        ) : null}
        {!locked ? (
          <LessonDiscussion
            courseId={courseId}
            lessonId={lesson.id}
            previewMode={previewMode}
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={onToggleComplete}
        disabled={previewMode || locked || isSaving}
        className="button-solid mt-5 px-4 py-2.5 text-sm disabled:opacity-60"
      >
        {previewMode
          ? "Preview only"
          : locked
          ? "Lesson locked"
          : isSaving
            ? "Saving..."
            : completed
              ? "Mark as incomplete"
              : "Mark complete"}
      </button>
    </div>
  );
}

function LessonDiscussion({
  courseId,
  lessonId,
  previewMode,
}: {
  courseId: string;
  lessonId: string;
  previewMode: boolean;
}) {
  const { user } = useAuth();
  const [comments, setComments] = useState<LessonComment[]>([]);
  const [commentsKey, setCommentsKey] = useState("");
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const currentKey = `${courseId}:${lessonId}`;
  const isReady = previewMode || commentsKey === currentKey;

  useEffect(() => {
    if (previewMode) {
      return undefined;
    }

    return subscribeToLessonComments(
      courseId,
      lessonId,
      (nextComments) => {
        setComments(nextComments);
        setCommentsKey(`${courseId}:${lessonId}`);
      },
      () => {
        setError("We could not load this lesson discussion.");
        setCommentsKey(`${courseId}:${lessonId}`);
      },
    );
  }, [courseId, lessonId, previewMode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user || previewMode || body.trim().length < 3) {
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await addLessonComment({
        courseId,
        lessonId,
        authorId: user.uid,
        // No email fallback: lesson comments are readable by every enrolled
        // learner, so an email-as-name leaked the author's address.
        authorName: user.displayName || "Skillset learner",
        body,
      });
      setBody("");
    } catch {
      setError("We could not publish your comment.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (!user || previewMode) {
      return;
    }

    setError("");

    try {
      await deleteLessonComment(courseId, commentId);
    } catch {
      setError("We could not delete that comment.");
    }
  }

  return (
    <div className="mt-5 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle size={15} className="text-[var(--color-accent-fg)]" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              Lesson discussion
            </p>
          </div>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Ask questions or leave context tied to this specific lesson.
          </p>
        </div>
        <span className="rounded-[8px] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-primary)]">
          {comments.length} comment{comments.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        {!isReady ? (
          <p className="rounded-[10px] bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
            Loading comments...
          </p>
        ) : comments.length === 0 ? (
          <p className="rounded-[10px] bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
            No comments yet. Start the discussion for this lesson.
          </p>
        ) : (
          comments.map((comment) => (
            <article
              key={comment.id}
              className="rounded-[10px] border border-[var(--color-line)] bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                  {comment.authorName}
                </p>
                {user?.uid === comment.authorId ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteComment(comment.id)}
                    className="text-xs font-semibold text-[var(--color-accent-fg)] hover:text-[var(--color-primary)]"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--color-ink)]">
                {comment.body}
              </p>
            </article>
          ))
        )}
      </div>

      {error ? (
        <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      <form className="mt-4 grid gap-3" onSubmit={handleSubmit}>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={previewMode || isSaving}
          rows={3}
          aria-label="Write a comment for this lesson"
          placeholder={
            previewMode
              ? "Preview mode does not publish comments."
              : "Write a question, note, or useful comment..."
          }
          className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]"
        />
        <button
          type="submit"
          disabled={previewMode || isSaving || body.trim().length < 3}
          className="button-outline w-fit px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isSaving ? "Publishing..." : "Publish comment"}
        </button>
      </form>
    </div>
  );
}

function LessonAssetList({
  assets,
  isLoading,
}: {
  assets: CourseAsset[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <p className="mt-4 rounded-[10px] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink-soft)]">
        Loading lesson assets...
      </p>
    );
  }

  if (assets.length === 0) {
    return (
      <p className="mt-4 rounded-[10px] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink-soft)]">
        No files are attached to this lesson yet.
      </p>
    );
  }

  return (
    <div className="mt-5 grid gap-3">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                  {asset.fileName}
                </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                <FileText size={13} aria-hidden />
                <span>{courseAssetKindLabels[asset.kind]} - {formatCourseAssetSize(asset.size)}</span>
              </div>
            </div>
            <span className="rounded-[8px] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
              {asset.isPreview ? "Preview" : "Enrolled"}
            </span>
          </div>

          <ProtectedAssetPreview asset={asset} />
        </div>
      ))}
    </div>
  );
}

function ProtectedAssetCover({
  asset,
  compact = false,
  fallbackLabel,
}: {
  asset?: CourseAsset;
  compact?: boolean;
  fallbackLabel: string;
}) {
  const [objectUrlState, setObjectUrlState] = useState<{
    assetId: string;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!asset || !asset.contentType.startsWith("image/")) {
      return undefined;
    }

    let isMounted = true;
    let nextObjectUrl: string | null = null;

    getProtectedCourseAssetObjectUrl(asset)
      .then((url) => {
        nextObjectUrl = url;

        if (isMounted) {
          setObjectUrlState({
            assetId: asset.id,
            url,
          });
        }
      })
      .catch(() => {
        return undefined;
      });

    return () => {
      isMounted = false;

      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [asset]);

  const sizeClass = compact ? "aspect-video" : "aspect-[16/10]";
  const objectUrl =
    asset && objectUrlState?.assetId === asset.id ? objectUrlState.url : null;

  if (objectUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={objectUrl}
        alt={fallbackLabel}
        className={`${sizeClass} w-full rounded-[10px] object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} grid w-full place-items-center rounded-[10px] border border-[rgba(26,54,93,0.10)] bg-[linear-gradient(135deg,rgba(26,54,93,0.12),rgba(178,34,52,0.08))] px-3 text-center`}
    >
      <span className="line-clamp-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
        {fallbackLabel}
      </span>
    </div>
  );
}

function ProtectedAssetPreview({ asset }: { asset: CourseAsset }) {
  const { user } = useAuth();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const viewerLabel =
    user?.email
    || user?.displayName
    || "Skillset learner";

  useEffect(() => {
    let isMounted = true;
    let nextObjectUrl: string | null = null;

    getProtectedCourseAssetObjectUrl(asset)
      .then((url) => {
        nextObjectUrl = url;

        if (isMounted) {
          setObjectUrl(url);
        }
      })
      .catch(() => {
        if (isMounted) {
          setError("Asset access is protected. Try again after refreshing your session.");
        }
      });

    return () => {
      isMounted = false;

      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [asset]);

  if (error) {
    return (
      <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-3 py-2 text-sm font-semibold text-[var(--color-accent-fg)]">
        {error}
      </p>
    );
  }

  if (!objectUrl) {
    return (
      <p className="mt-3 rounded-[10px] bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
        Preparing protected asset...
      </p>
    );
  }

  if (asset.contentType.startsWith("video/")) {
    return (
      <WatermarkedVideoPlayer
        fileName={asset.fileName}
        src={objectUrl}
        viewerLabel={viewerLabel}
      />
    );
  }

  if (asset.contentType.startsWith("image/")) {
    return (
      <div className="mt-3 grid gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={objectUrl}
          alt={asset.fileName}
          className="max-h-72 w-full rounded-[10px] object-cover"
        />
        <ProtectedAssetActions asset={asset} objectUrl={objectUrl} />
      </div>
    );
  }

  if (asset.contentType === "application/pdf") {
    return (
      <div className="mt-3 grid gap-3">
        <iframe
          src={objectUrl}
          title={asset.fileName}
          className="h-80 w-full rounded-[10px] border border-[var(--color-line)] bg-white"
        />
        <ProtectedAssetActions asset={asset} objectUrl={objectUrl} />
      </div>
    );
  }

  return <ProtectedAssetActions asset={asset} objectUrl={objectUrl} />;
}

function ProtectedAssetActions({
  asset,
  objectUrl,
}: {
  asset: CourseAsset;
  objectUrl: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <a
        href={objectUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="button-outline px-4 py-2 text-xs"
      >
        Open file
      </a>
      <a
        href={objectUrl}
        download={asset.fileName}
        className="button-solid px-4 py-2 text-xs"
      >
        Download
      </a>
    </div>
  );
}
