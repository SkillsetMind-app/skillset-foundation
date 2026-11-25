"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  LockKeyhole,
  PlayCircle,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BunnyVideoPlayer } from "@/components/courses/bunny-video-player";
import { ClassroomLoading } from "@/components/learn/classroom-loading";
import { ClassroomTabs, useTabChanged, type ClassroomTabItem } from "@/components/learn/classroom-tabs";
import { CommunityFeed, type CommunityFeedLesson } from "@/components/learn/community-feed";
import { CourseMessagesPanel } from "@/components/learn/course-messages-panel";
import {
  CourseMaterialsPanel,
  groupReleasedMaterials,
  LessonAssetActions,
  MaterialAppHint,
  MaterialFileList,
} from "@/components/learn/course-materials-panel";
import { CoursePlaylist } from "@/components/learn/course-playlist";
import { CourseReviewPanel } from "@/components/learn/course-review-panel";
import { LessonComments } from "@/components/learn/lesson-comments";
import { LessonListOverlay } from "@/components/learn/lesson-list-overlay";
import { NextLessonCard } from "@/components/learn/next-lesson-card";
import { MembersAreaHero } from "@/components/learn/members-area-hero";
import { TrustedEmbedPlayer } from "@/components/learn/trusted-embed-player";
import { CourseSubscriptionCard } from "@/components/learn/course-subscription-card";
import { CourseUnlockModal, unlockCopyKeys } from "@/components/learn/course-unlock-modal";
import { VideoDock } from "@/components/learn/video-dock";
import {
  VideoWatermark,
} from "@/components/learn/watermarked-video-player";
import { ProtectedAssetPreview } from "@/components/shared/protected-asset-preview";
import { BusyLabel } from "@/components/ui/busy-label";
import { MilestoneSeal, useJustDone } from "@/components/ui/drawn-check";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { CourseAsset } from "@/domain/course-asset";
import {
  formatCourseAssetSize,
  getCourseAssetTitle,
  getModuleCoverAsset,
  getPrimaryLessonVideoAsset,
  isVideoAssetKind,
} from "@/domain/course-asset";
import { getCourseAssetKindLabel } from "@/lib/i18n/course-assets";
import type { CourseEvent } from "@/domain/course-event";
import {
  formatEventDateTime,
  getEventLiveState,
  getEventUpdatedAt,
  isCancelledEventShown,
  isValidExternalEventUrl,
} from "@/domain/course-event";
import {
  ClassroomLiveStrip,
  EventCalendarActions,
  noJoinLinkKey,
  useNow,
} from "@/components/learn/live-session-parts";
import {
  formatUnlockDate,
  getLessonUnlockState,
  type LessonUnlockState,
} from "@/domain/drip-policy";
import type { Enrollment } from "@/domain/enrollment";
import { getSafeExternalUrl, getSafeMediaUrl } from "@/domain/external-url";
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
import {
  classroomBasePath,
  classroomTabHref,
  type ClassroomTab,
} from "@/domain/classroom-tabs";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import { resolveLessonVideoSource } from "@/domain/teacher-course";
import {
  lessonPositionRef,
} from "@/lib/learn/lesson-position";
import { countOpenCommunityQuestions } from "@/lib/data/community-posts";
import { subscribeToCourseEvents } from "@/lib/data/course-events";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { subscribeToPublicProfile } from "@/lib/data/user-profiles";
import {
  recordLessonProgress,
  subscribeToCompletedLessons,
} from "@/lib/data/lesson-progress";
import {
  getProtectedCourseAssetObjectUrl,
  subscribeToCourseAssets,
} from "@/lib/data/course-assets";
import { linkify } from "@/lib/format/linkify";
import {
  resolveLessonContent,
  subscribeToLessonContent,
  type LessonContent,
} from "@/lib/data/lesson-content";
import { useCreatorAreaLink } from "@/components/learn/member-area-links";
import { track } from "@/lib/posthog/events";
import { scrollBehavior } from "@/lib/ui/scroll-behavior";
import { LessonQuiz } from "@/components/learn/lesson-quiz";
import { isTeacherAiEnabled } from "@/lib/ai/config";

// Lesson release by calendar (migration 20260915020000).
// Slack after the deadline: the device clock may be ahead of the database.
const RELEASE_GRACE_MS = 5_000;
// The database has not opened the lesson yet (clock ahead): tries again, with a cap.
const RELEASE_RETRY_MS = 30_000;
const RELEASE_RETRIES = 3;
// Window for the clock running ahead: near the deadline, "came back empty" may just be the
// database running late. Far from it, it is a lesson with no protected content.
const RELEASE_SKEW_WINDOW_MS = 2 * 60 * 1000;

// "l1@1700000000000|l2@" -> [{ id: "l1", unlocksAt: 1700000000000 }, { id: "l2", unlocksAt: null }]
function parseUnlockedKey(key: string): { id: string; unlocksAt: number | null }[] {
  if (key === "") {
    return [];
  }
  return key.split("|").map((part) => {
    const at = part.lastIndexOf("@");
    const time = part.slice(at + 1);
    return { id: part.slice(0, at), unlocksAt: time === "" ? null : Number(time) };
  });
}
// Distant deadlines are re-armed every 24h (setTimeout overflows above ~24
// days). A tick that opens nothing fetches nothing.
const MAX_RELEASE_WAIT_MS = 24 * 60 * 60 * 1000;

// `reload` is optional here: the tests that stub the data modules return
// only the unsubscribe function.
type ReloadableSubscription = (() => void) & { reload?: () => Promise<void> };

type EnrolledCourseWorkspaceProps = {
  course: Course;
  enableFirestoreAssets?: boolean;
  previewExitHref?: string;
  previewMode?: boolean;
  /** The shell is running under a teacher's own brand: hide every link that
   *  leads back into our platform (dashboard, public course page, credentials). */
  whitelabel?: boolean;
  /** Which classroom tab is open. It comes from the route: /learn/courses/<course> is
   *  the lesson; /learn/courses/<course>/<tab> is one of the others. Before, everything lived
   *  in the same scroll, with no address. */
  tab?: ClassroomTab;
  /** A community post opened in the drawer (.../community/q/<post>). */
  openPostId?: string | null;
  /** The enrollment that the parent (CreatorCourseWorkspace) already subscribes to. Without it the classroom
   *  fetched the same row again, behind one more wait screen. */
  enrollment?: Enrollment;
  /** The parent opened the classroom after a "Try again": focus goes to the classroom
   *  title on open, as in the "Try again" here (focusRoomAfterRetry). */
  focusTitleOnOpen?: boolean;
};

export function EnrolledCourseWorkspace({
  course,
  enableFirestoreAssets = false,
  previewExitHref,
  previewMode = false,
  whitelabel = false,
  tab = "lesson",
  openPostId = null,
  enrollment: parentEnrollment,
  focusTitleOnOpen = false,
}: EnrolledCourseWorkspaceProps) {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  // Stripe's success_url carries ?checkout=success while the webhook is still
  // creating the enrollment — show "finalizing" instead of "Enrollment
  // required" during that gap (the realtime listener opens the workspace).
  const cameFromCheckout = searchParams?.get("checkout") === "success";
  const [checkoutGraceExpired, setCheckoutGraceExpired] = useState(false);
  const [enrollmentRecheck, setEnrollmentRecheck] = useState(0);
  const [ownEnrollment, setEnrollment] = useState<Enrollment | null>(null);
  const enrollment = parentEnrollment ?? ownEnrollment;
  const hasParentEnrollment = Boolean(parentEnrollment);
  const [isLoading, setIsLoading] = useState(!previewMode && !hasParentEnrollment);
  // The creator's area, when they have a public profile: that is where the
  // lesson's "back" goes (the way out stays a single one). Outside the preview.
  const creatorArea = useCreatorAreaLink(previewMode ? null : course.instructorId, course.id);
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
  // The current lesson goes in the address (?lesson=…). Before, it lived only in state:
  // reloading or going back in the browser opened the "first uncompleted lesson",
  // not the one the person was watching; and a shared link never opened the
  // same lesson. The parameter is read on mount and rewritten on each selection.
  const router = useRouter();
  const pathname = usePathname() ?? "";
  // "/learn/courses/<course>" — without the tab. Switching lesson from a tab
  // (Community, Materials...) takes you back to the lesson, it does not write ?lesson= on the tab.
  const basePath = classroomBasePath(pathname, tab);
  const lessonParam = searchParams?.get("lesson") ?? null;
  // The choice keeps the parameter that was in the address when it was made. The
  // choice holds while the address is that one (the router has not written yet) or
  // is already the choice itself (it wrote). If the address changes to something else from
  // outside (back/forward, new link), the lesson becomes the one in the address —
  // derived, with no effect syncing state (the same design as the sidebar's
  // `sectionChoice`).
  const [lessonChoice, setLessonChoice] = useState<{
    seenParam: string | null;
    id: string | null;
  }>({ seenParam: lessonParam, id: lessonParam });
  const selectedLessonId =
    lessonChoice.seenParam === lessonParam || lessonChoice.id === lessonParam
      ? lessonChoice.id
      : lessonParam;

  // The only way to switch lessons: state + address + scroll to the player.
  // Before, the switch could happen off screen (the learner scrolled down to the discussion,
  // the video ended, the next lesson came in up top) — they came back and
  // found another video without knowing why. Now the page scrolls to the player
  // on every switch, including the automatic advance.
  function selectLesson(lessonId: string) {
    setLessonChoice({ seenParam: lessonParam, id: lessonId });
    // The "Next lesson" countdown and the error notice belonged to the lesson left
    // behind. If still pending, the countdown would pull the learner to another lesson later
    // (even from a text lesson, where the card does not even show).
    setNextUp(null);
    setActionError("");

    const params = new URLSearchParams(searchParams?.toString() ?? "");
    // The Stripe return marker must not ride along into every lesson URL: a
    // copied, bookmarked or reopened link would look like a fresh purchase.
    params.delete("checkout");
    params.set("lesson", lessonId);
    router.replace(`${basePath}?${params.toString()}`, { scroll: false });

    window.requestAnimationFrame(() => {
      document
        .getElementById("member-lesson-player")
        ?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    });
  }
  const [lessonListOpen, setLessonListOpen] = useState(false);
  // How many of the course's questions are still without an accepted answer. It becomes the number
  // next to the Community tab.
  //
  // WHY THIS EXISTS
  //
  // The tab bar already knew how to show a number (Materials shows one), but
  // Community never did: someone in a lesson had no way to know that
  // a question was waiting — the tab looked the same, answered or not. One
  // read when the classroom opens, only the columns of the rule, without duplicating the feed.
  const [openQuestionCount, setOpenQuestionCount] = useState(0);
  const communityEnabled = Boolean(course.communityEnabled) && !previewMode;
  // The feed uses `course.id` as course_slug (see CourseCommunitySection); the
  // counter has to read the SAME key, otherwise it always counts zero.
  const communityKey = course.id;
  useEffect(() => {
    if (!communityEnabled) {
      return;
    }

    let active = true;
    countOpenCommunityQuestions(communityKey)
      .then((count) => {
        if (active) {
          setOpenQuestionCount(count);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [communityEnabled, communityKey]);
  // End of the video: the next lesson is proposed in a card over the player (5 s,
  // Watch now / Cancel) instead of switching silently. When the learner
  // accepts, the following lesson opens with autoplay — only that one, only this time.
  const [nextUp, setNextUp] = useState<Lesson | null>(null);
  const [autoplayLessonId, setAutoplayLessonId] = useState<string | null>(null);
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
  // One failure per read. The error card stays while ANY one is
  // failing: the classroom never opens with empty progress or without the materials that the
  // failed read left in place. Each good read clears only its own
  // failure; "Try again" re-reads all the ones that failed, through the same channels.
  // Progress and materials remember WHOSE read failed (the enrollment, the course): the
  // failure of a subscription that already ended does not hold the card.
  const [failedReads, setFailedReads] = useState<{
    enrollment: boolean;
    progress: string | null;
    assets: string | null;
  }>({ enrollment: false, progress: null, assets: null });
  const enrollmentSubscription = useRef<ReloadableSubscription | null>(null);
  const progressSubscription = useRef<ReloadableSubscription | null>(null);
  const errorCardRef = useRef<HTMLElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const focusRoomAfterRetry = useRef(focusTitleOnOpen);
  // Error from an ACTION (complete/undo a lesson): a notice inside the player, the classroom
  // stays. `error` above is a load error and swaps the whole classroom for the error card —
  // a momentary failure on save used to throw the learner out of the lesson.
  const [actionError, setActionError] = useState("");
  // The preview's fake enrollment NEEDS a stable identity.
  //
  // WHY THIS EXISTS
  //
  // It is the only enrollment the teacher's preview has, and three effects
  // below declare `workspaceEnrollment` as a dependency — the OBJECT, not the
  // id. Built on every render, this literal got a new identity on every
  // render, and two of those effects open a Supabase subscription and write state
  // in the callback. New state -> render -> new object -> cancel and resubscribe
  // -> callback -> new state. A closed loop, with no stop condition.
  //
  // The teacher opened the preview of their own course and the tab hammered the database
  // endlessly: request quota, realtime channel churn, the tab
  // freezing and the phone battery draining — with nothing on screen saying
  // what was going on.
  //
  // `useMemo` over the fields that really make up the enrollment: as long as the
  // course and the person are the same, the identity is the same.
  const previewEnrollment: Enrollment = useMemo(
    () => ({
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
    }),
    [
      course.id,
      course.slug,
      course.title,
      course.category,
      course.image,
      user?.uid,
    ],
  );
  const workspaceEnrollment = previewMode ? previewEnrollment : enrollment;
  // The channels and the progress depend on the enrollment ID, not the object:
  // completing a lesson writes to enrollments, and the enrollment arrives again through
  // realtime as another object, which would resubscribe everything and swap the attachments.
  const enrollmentId = workspaceEnrollment?.id ?? null;
  // Clock for lesson release (see the "Release by calendar" block).
  // It ticks on mount, when the enrollment and the progress arrive, at the next
  // deadline + slack and when coming back to the tab.
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    if (!cameFromCheckout) {
      return;
    }

    // After 90s without an enrollment the webhook is genuinely stuck — switch
    // the copy from "opening..." to a keep-the-page-open/support message.
    const timer = window.setTimeout(() => setCheckoutGraceExpired(true), 90_000);

    return () => window.clearTimeout(timer);
  }, [cameFromCheckout]);

  // Safety net for the gap between paying and the enrollment showing up.
  //
  // The screen promises the buyer, in so many words: "Keep this page open: it
  // opens automatically the moment your enrollment is confirmed." Until now, the
  // ONLY thing able to keep that promise was `postgres_changes` — a
  // WebSocket. A phone tab in the background, a corporate proxy or flaky wi-fi
  // silently drop that socket: the channel stays "subscribed" and
  // simply never fires. The promise turned into a lie and the buyer — who
  // had already paid — stayed on that screen forever, not knowing that reloading
  // was enough. This is the main purchase path and it was the only one of the two
  // workspaces with no fallback at all.
  //
  // Incrementing the counter re-runs the subscription below, which re-emits its single
  // read. The deps are the stop conditions: the enrollment arrived, or the
  // component unmounted. The 90s grace period only changes the pace.
  useEffect(() => {
    if (previewMode || !cameFromCheckout || enrollment) {
      return;
    }

    const interval = window.setInterval(
      () => setEnrollmentRecheck((tick) => tick + 1),
      checkoutGraceExpired ? 20_000 : 5_000,
    );

    return () => window.clearInterval(interval);
  }, [cameFromCheckout, checkoutGraceExpired, enrollment, previewMode]);

  useEffect(() => {
    if (previewMode || hasParentEnrollment) {
      return;
    }

    if (!user) {
      return;
    }

    const current = subscribeToEnrollment(
      user.uid,
      course.slug,
      (nextEnrollment) => {
        setEnrollment(nextEnrollment);
        setFailedReads((reads) => (reads.enrollment ? { ...reads, enrollment: false } : reads));
        setIsLoading(false);
        // Enrollment that arrives after mount (checkout): the mount clock
        // stayed behind and lesson 1 would show up locked.
        setClockNow(Date.now());
      },
      () => {
        focusRoomAfterRetry.current = false;
        setFailedReads((reads) => ({ ...reads, enrollment: true }));
        setIsLoading(false);
      },
    );
    enrollmentSubscription.current = current;
    return () => {
      enrollmentSubscription.current = null;
      current();
    };
  }, [course.slug, enrollmentRecheck, hasParentEnrollment, previewMode, user]);

  useEffect(() => {
    if (previewMode || !enrollmentId) {
      return;
    }

    const current = subscribeToCompletedLessons(
      enrollmentId,
      (lessonIds) => {
        setProgressState({
          key: enrollmentId,
          lessonIds,
          ready: true,
        });
        setFailedReads((reads) => (reads.progress === enrollmentId ? { ...reads, progress: null } : reads));
        setClockNow(Date.now());
      },
      () => {
        focusRoomAfterRetry.current = false;
        setFailedReads((reads) => ({ ...reads, progress: enrollmentId }));
        setProgressState({
          key: enrollmentId,
          lessonIds: [],
          ready: true,
        });
        setClockNow(Date.now());
      },
    );
    progressSubscription.current = current;
    return () => {
      progressSubscription.current = null;
      current();
    };
  }, [enrollmentId, previewMode]);

  // Release by calendar (migration 20260915020000). RLS only hands over the
  // text, the link and the material of a lesson that has already opened, and nothing in the database changes
  // when it opens, so realtime does not wake up. The classroom tracks the set
  // of lessons opened by the clock (clockNow) and the set of completed ones.
  // When either changes, it asks both channels for a one-off reload, without
  // resubscribing them. A tick or a return to the tab that opens nothing fetches nothing.
  const assetsSubscription = useRef<ReloadableSubscription | null>(null);
  const contentSubscription = useRef<ReloadableSubscription | null>(null);
  const latestAssets = useRef<CourseAsset[]>([]);
  const latestContent = useRef<Map<string, LessonContent>>(new Map());
  // Survives the effects re-running: the last snapshot seen, the lessons that
  // the clock opened and the database has not delivered yet, and the retry timer.
  // A change in the middle of the 30s window does not cancel the pending retry.
  const release = useRef({
    snapshot: null as { courseId: string; unlocked: string; completed: string } | null,
    pending: new Map<string, { unlocksAt: number | null; tries: number }>(),
    retryTimer: undefined as number | undefined,
  });
  // Lessons whose opening reload is in flight: the panel shows "loading" only
  // for them, never for the ones that were already open. When that reload comes back,
  // the lesson leaves here and the screen shows the real state (the queue's new retries
  // go on behind the scenes, without "loading").
  const [releasingLessonIds, setReleasingLessonIds] = useState<ReadonlySet<string>>(() => new Set());

  // The starting snapshot only goes out after the database delivered the first load:
  // it compares the screen clock with what actually arrived.
  const releaseDataReady =
    lessonContentState.ready
    && lessonContentState.key === course.id
    && (!enableFirestoreAssets || (assetsState.ready && assetsState.key === course.id));
  // In the preview the teacher already reads everything (they are the owner): nothing to track.
  let unlockedKey: string | null = null;
  let nextUnlockAt: number | null = null;
  if (
    !previewMode
    && workspaceEnrollment
    && progressState.ready
    && progressState.key === enrollmentId
    && releaseDataReady
  ) {
    const unlocked: string[] = [];
    for (const lesson of course.modules.flatMap((module) => module.lessons)) {
      const state = getLessonUnlockState(
        course,
        lesson,
        workspaceEnrollment,
        progressState.lessonIds,
        new Date(clockNow),
      );
      if (state.unlocked) {
        // The deadline goes along in the key: the clock-ahead window uses it.
        unlocked.push(`${lesson.id}@${state.unlocksAt?.getTime() ?? ""}`);
      } else if (state.unlocksAt) {
        nextUnlockAt = Math.min(nextUnlockAt ?? Number.POSITIVE_INFINITY, state.unlocksAt.getTime());
      }
    }
    unlockedKey = unlocked.join("|");
  }
  // The completed list already arrives sorted (subscribeToCompletedLessons).
  const completedKey = progressState.lessonIds.join("|");

  // Next deadline + slack. A distant deadline: wakes up in 24h, opens nothing, fetches
  // nothing, and re-arms (clockNow changed).
  useEffect(() => {
    if (nextUnlockAt === null) {
      return;
    }

    const wait = Math.min(Math.max(0, nextUnlockAt - Date.now()), MAX_RELEASE_WAIT_MS);
    const timer = window.setTimeout(() => setClockNow(Date.now()), wait + RELEASE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [clockNow, nextUnlockAt]);

  // A background tab's timer runs late: on coming back, it checks the clock.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setClockNow(Date.now());
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Course switch (a tab that lives a long time) or leaving: forgets the queue and the timer.
  useEffect(() => {
    const tracker = release.current;
    return () => {
      window.clearTimeout(tracker.retryTimer);
      tracker.retryTimer = undefined;
      tracker.pending.clear();
      tracker.snapshot = null;
    };
  }, [course.id]);

  // The reload only goes out when the set of open lessons or the completed one changes.
  // Layout effect: the lesson that opens in this render enters the queue (and the panel
  // shows "loading") before paint, without flashing the empty notice.
  // ponytail: jsdom does not tell a layout effect from a passive effect (act
  // runs both before returning), so no test guards this choice.
  // Swapping to useEffect brings back one frame of the empty notice.
  useLayoutEffect(() => {
    if (unlockedKey === null) {
      return;
    }

    const tracker = release.current;
    const previous = tracker.snapshot;
    tracker.snapshot = { courseId: course.id, unlocked: unlockedKey, completed: completedKey };
    const unlocked = parseUnlockedKey(unlockedKey);

    // The thumbnail is public and already came with the lesson locked: it does not count.
    const delivered = (lessonId: string) =>
      latestContent.current.has(lessonId)
      || latestAssets.current.some(
        (asset) => asset.lessonId === lessonId && asset.kind !== "lesson_thumbnail",
      );
    // Turns the "loading" on or off for the given lessons (only them).
    const markReleasing = (lessonIds: string[], on: boolean) => {
      if (lessonIds.length === 0) {
        return;
      }
      setReleasingLessonIds((current) => {
        const next = new Set(current);
        for (const lessonId of lessonIds) {
          if (on) {
            next.add(lessonId);
          } else {
            next.delete(lessonId);
          }
        }
        return next;
      });
    };
    // Takes out of the queue the lesson that arrived, or that already used its attempts, and arms the
    // next attempt if a lesson is left. Device clock ahead: up to 3
    // attempts near the deadline (2 min window). Outside it, or for a lesson with no
    // deadline (sequential), just one: a lesson that comes back empty is a lesson with no protected
    // content (text only in the curriculum, quiz, embed with no row).
    const settle = () => {
      const checkedAt = Date.now();
      for (const [lessonId, entry] of tracker.pending) {
        const inSkewWindow =
          entry.unlocksAt !== null && checkedAt - entry.unlocksAt <= RELEASE_SKEW_WINDOW_MS;
        if (delivered(lessonId) || entry.tries >= (inSkewWindow ? RELEASE_RETRIES : 1)) {
          tracker.pending.delete(lessonId);
        }
      }
      if (tracker.pending.size > 0 && tracker.retryTimer === undefined) {
        tracker.retryTimer = window.setTimeout(() => {
          tracker.retryTimer = undefined;
          for (const entry of tracker.pending.values()) {
            entry.tries += 1;
          }
          void reload();
        }, RELEASE_RETRY_MS);
      }
    };
    const reload = async () => {
      await Promise.all([
        contentSubscription.current?.reload?.(),
        assetsSubscription.current?.reload?.(),
      ]);
      settle();
    };

    if (!previous || previous.courseId !== course.id) {
      // Starting snapshot: a lesson the clock opened a moment ago and the database did not
      // deliver (clock already ahead at mount) enters the queue.
      const now = Date.now();
      for (const { id, unlocksAt } of unlocked) {
        if (unlocksAt !== null && now - unlocksAt <= RELEASE_SKEW_WINDOW_MS && !delivered(id)) {
          tracker.pending.set(id, { unlocksAt, tries: 0 });
        }
      }
      settle();
      return;
    }
    if (previous.unlocked === unlockedKey && previous.completed === completedKey) {
      return;
    }

    const before = new Set(parseUnlockedKey(previous.unlocked).map(({ id }) => id));
    for (const { id, unlocksAt } of unlocked) {
      if (!before.has(id) && !tracker.pending.has(id)) {
        tracker.pending.set(id, { unlocksAt, tries: 0 });
      }
    }
    // "Loading" only while the reload that opened the lesson is in flight. After
    // it the screen shows the real state; the new attempts go on behind the scenes and,
    // if the content arrives in one of them, it simply shows up.
    const opened = unlocked.filter(({ id }) => !before.has(id)).map(({ id }) => id);
    markReleasing(opened, true);
    void reload().finally(() => markReleasing(opened, false));
  }, [completedKey, course.id, unlockedKey]);

  useEffect(() => {
    if (!enableFirestoreAssets || !enrollmentId) {
      return;
    }

    latestAssets.current = [];
    const subscription = subscribeToCourseAssets(
      course.id,
      (assets) => {
        latestAssets.current = assets;
        setAssetsState({
          assets,
          key: course.id,
          ready: true,
        });
        setFailedReads((reads) => (reads.assets === course.id ? { ...reads, assets: null } : reads));
      },
      () => {
        focusRoomAfterRetry.current = false;
        setFailedReads((reads) => ({ ...reads, assets: course.id }));
        setAssetsState({
          assets: [],
          key: course.id,
          ready: true,
        });
      },
    );
    assetsSubscription.current = subscription;
    return subscription;
  }, [course.id, enableFirestoreAssets, enrollmentId]);

  // B1: subscribe to the gated lesson content for the active course. Only
  // meaningful for an enrolled (or preview) viewer, who passes the enrollment
  // gate in RLS; a permission error degrades gracefully to inline fallback
  // rather than blocking the workspace.
  useEffect(() => {
    if (!enrollmentId) {
      return;
    }

    latestContent.current = new Map();
    const subscription = subscribeToLessonContent(
      course.id,
      (content) => {
        latestContent.current = content;
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
    contentSubscription.current = subscription;
    return subscription;
  }, [course.id, enrollmentId]);

  // The course's live sessions. The subscription used to live inside the tab, which
  // always showed and, with no session scheduled, opened an empty page. Up
  // here it decides whether the tab exists. "Now" is sampled when the list arrives
  // (the render has to be pure).
  const [liveState, setLiveState] = useState<{ events: CourseEvent[]; now: number; failed: boolean }>({
    events: [],
    now: 0,
    failed: false,
  });
  const eventsSubscription = useRef<ReloadableSubscription | null>(null);
  // Only with an enrollment: without it the classroom does not open, and there is nothing to subscribe to.
  useEffect(() => {
    if (previewMode || !enrollmentId) {
      return;
    }

    const current = subscribeToCourseEvents(
      course.id,
      (events) => setLiveState({ events, now: Date.now(), failed: false }),
      // The schedule is auxiliary: on error, the classroom opens the same, with no notice. Only the
      // sessions tab says it failed and offers "Try again" (never "no
      // sessions"); what had already arrived stays.
      () => setLiveState((state) => ({ events: state.events, now: Date.now(), failed: true })),
      // A canceled one shows up marked in the sessions tab, instead of vanishing.
      { includeCancelled: true },
    );
    eventsSubscription.current = current;
    return () => {
      eventsSubscription.current = null;
      // `?.`: before, the effect returned the subscription directly, and a test stub
      // with no return passed without an error.
      current?.();
    };
  }, [course.id, enrollmentId, previewMode]);
  // They stay in view until they end (the common window from course-event.ts);
  // a canceled one, for 7 days after the scheduled time.
  const upcomingEvents = liveState.events.filter((event) =>
    event.status === "cancelled"
      ? isCancelledEventShown(event.startsAt, liveState.now)
      : getEventLiveState(event.startsAt, liveState.now, event.type) !== "over",
  );

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

  // The lesson check and the 100% badge only move when the learner completes with the
  // classroom open: the first load of the progress is the baseline.
  const justCompletedIds = useJustDone(
    progressState.lessonIds,
    progressState.ready && progressState.key === enrollmentId,
  );
  // A new panel only on a tab switch (see useTabChanged).
  const tabChanged = useTabChanged(tab);

  // The failures that count now: one from a subscription that already ended does not count.
  const enrollmentFailed = failedReads.enrollment;
  const progressFailed = !previewMode && enrollmentId !== null && failedReads.progress === enrollmentId;
  const assetsFailed = enableFirestoreAssets && enrollmentId !== null && failedReads.assets === course.id;
  const error = enrollmentFailed
    ? "learn.classroom.workspace.enrollmentError"
    : progressFailed
      ? "learn.classroom.workspace.progressLoadError"
      : assetsFailed
        ? "learn.classroom.workspace.assetsError"
        : "";

  // The error card disappears when "Try again" works: focus goes to the
  // classroom title, instead of falling on <body>. A failure along the way disarms it.
  useEffect(() => {
    if (error || isLoading || !focusRoomAfterRetry.current) {
      return;
    }
    focusRoomAfterRetry.current = false;
    const title = roomRef.current?.querySelector<HTMLElement>("h1");
    if (title) {
      title.tabIndex = -1;
      title.focus();
    }
  }, [error, isLoading]);

  if (isLoading) {
    // The classroom's one loading state, the same the route file and the
    // creator workspace paint, so a student never sees the wait change look.
    // With the lesson in the address the classroom opens on the short header, not the cover (the
    // isCourseHome calculation, without the progress, which has not arrived yet).
    return (
      <ClassroomLoading
        label={t("learnWave2.courseLoading.title")}
        short={Boolean(lessonParam) && !previewMode && tab !== "about"}
      />
    );
  }

  if (error) {
    // "Try again" re-reads ALL the reads that failed, through the same channels.
    return (
      <section ref={errorCardRef} tabIndex={-1} className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <LoadErrorAlert
          focusRef={errorCardRef}
          onRetry={() => {
            focusRoomAfterRetry.current = true;
            return Promise.all([
              enrollmentFailed ? enrollmentSubscription.current?.reload?.() : undefined,
              progressFailed ? progressSubscription.current?.reload?.() : undefined,
              assetsFailed ? assetsSubscription.current?.reload?.() : undefined,
            ]);
          }}
        >
          {t(error)}
        </LoadErrorAlert>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/learn" className="button-solid px-4 py-2.5 text-sm">
            {t("learn.classroom.workspace.backToLearning")}
          </Link>
          {/* Whitelabel: our public course page is not a way out. */}
          {whitelabel ? null : (
            <Link
              href={`/courses/${course.slug}`}
              className="button-outline px-4 py-2.5 text-sm"
            >
              {t("learn.classroom.workspace.openCourse")}
            </Link>
          )}
        </div>
      </section>
    );
  }

  if (!workspaceEnrollment) {
    if (cameFromCheckout) {
      return (
        <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("learn.classroom.workspace.paymentReceived")}
          </p>
          {/* h1: while the enrollment has not arrived, this section is the whole
              page — the MembersAreaHero, which brings the course h1, only renders
              later. The buyer who had just paid was left in a document whose
              only heading was a loose h3. */}
          <h1 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {checkoutGraceExpired
              ? t("learn.classroom.workspace.enrollmentDelayed")
              : t("learn.classroom.workspace.openingCourse")}
          </h1>
          <p role="status" className="mt-4 flex max-w-2xl items-start gap-2 text-sm leading-7 text-[var(--color-ink-soft)]">
            {/* Up to 90s waiting for the enrollment: the ring says something is
                in motion. It goes away when the wait runs out (then the text asks for action). */}
            {checkoutGraceExpired ? null : (
              <Loader2 size={18} aria-hidden className="mt-1.5 shrink-0 motion-safe:animate-spin" />
            )}
            {checkoutGraceExpired
              ? t("learn.classroom.workspace.delayedDetails")
              : t("learn.classroom.workspace.openingDetails")}
          </p>
        </section>
      );
    }

    // No enrollment: the same buy popup as the course page and the members
    // area (cover + buy button to the course page), instead of a full page
    // "enrollment required" with a link out. Public course fields only: no
    // lesson content or video is fetched without an enrollment.
    return (
      <>
        <h1 className="sr-only">{course.title}</h1>
        <CourseUnlockModal
          course={{
            id: course.id,
            title: course.title,
            summary: course.summary,
            category: course.category,
            coverImageUrl: getSafeMediaUrl(course.image),
            priceAmountMinor: course.priceAmountMinor,
            currency: course.currency,
          }}
          ctaHref={`/courses/${course.slug}`}
          // No price here: the modal's fallback formats the raw course price
          // in English. The course page owns the real, resolved price. The
          // verb (and the modal's note) still follow it: buy, enroll free, or
          // the neutral "Unlock course" when the price is unknown.
          ctaLabel={t(unlockCopyKeys(course.priceAmountMinor).label)}
          secondaryLink={{ href: "/learn", label: t("learn.classroom.workspace.backToLearning") }}
          onClose={() => router.push("/learn")}
        />
      </>
    );
  }

  const completedLessonIds = progressState.lessonIds;
  const progressReady = progressState.ready && progressState.key === enrollmentId;
  const progressPercent = getCourseProgressPercent(course, completedLessonIds);
  const nextLesson = getNextCourseLesson(course, completedLessonIds)?.lesson ?? null;
  const allLessons = course.modules.flatMap((module) => module.lessons);
  const lessonUnlockStateById = new Map(
    allLessons.map((lesson) => [
        lesson.id,
        // The reload clock (clockNow): the lesson opens on screen together with the fetch.
        getLessonUnlockState(course, lesson, workspaceEnrollment, completedLessonIds, new Date(clockNow)),
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
  // Sequential locked: the lesson that still has to be completed (name + button on screen).
  const previousRequiredLesson =
    allLessons.find((lesson) => lesson.id === selectedLessonUnlockState?.previousLessonId) ?? null;
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
  // The lesson the clock just opened and whose content is still arriving (only
  // it: the other open lessons stay as they were).
  const selectedLessonReleasing = Boolean(
    selectedLesson && releasingLessonIds.has(selectedLesson.id),
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
  // Materials tab: the files of all the already released lessons (and the ones for the whole
  // course), by module and lesson. A locked lesson does not go in.
  const materialGroups = groupReleasedMaterials(
    course.modules,
    assetsState.key === course.id ? assetsState.assets : [],
    (lessonId) => lessonUnlockStateById.get(lessonId)?.unlocked === true,
  );
  const assetCountByLessonId = new Map<string, number>();
  const thumbnailUrlByLessonId = new Map<string, string>();
  const thumbnailDateByLessonId = new Map<string, number>();
  const courseLessonIds = new Set(allLessons.map((lesson) => lesson.id));
  // Navigation uses public cover images only, never signed private assets.
  const moduleCoverAssets = assetsState.key === course.id
    ? assetsState.assets.filter((asset) => asset.courseId === course.id
      && asset.kind === "module_cover"
      && asset.contentType.startsWith("image/")
      && getSafeMediaUrl(asset.downloadUrl))
    : [];
  const totalLessonCount = allLessons.length;
  // Same calculation as getCourseProgressPercent: only lessons that exist in the course.
  const completedLessonCount = allLessons.filter((lesson) =>
    completedLessonIds.includes(lesson.id),
  ).length;
  const selectedModule = selectedLesson
    ? course.modules.find((module) =>
        module.lessons.some((lesson) => lesson.id === selectedLesson.id),
      ) ?? null
    : null;
  // A single criterion for the certificate, in the hero and in the tab bar. White label
  // hides every link that goes back to the platform.
  // An e-book does not issue a certificate (issue_skillset_certificate refuses).
  const productFormat = course.productFormat ?? "course";
  const certificateHref =
    progressPercent === 100 && !whitelabel && productFormat !== "ebook"
      ? "/learn/credentials"
      : null;
  const selectedLessonNumber = selectedLesson
    ? allLessons.findIndex((lesson) => lesson.id === selectedLesson.id) + 1
    : 0;
  const showModulePosters = course.modules.some((module) =>
    getSafeMediaUrl(getModuleCoverAsset(module, moduleCoverAssets)?.downloadUrl),
  );
  const moduleSummary = selectedModule?.summary?.trim() ? (
    <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--ma-ink-soft)] [overflow-wrap:anywhere]">
      {selectedModule.summary}
    </p>
  ) : null;
  // Sequential navigation. selectedLessonNumber is already the 1-based position
  // in the flattened curriculum, so the neighbours are just its edges. Locked
  // lessons stay reachable, exactly like clicking one in the sidebar strip: the
  // panel is what shows the lock, not the navigation.
  const previousInOrder =
    selectedLessonNumber > 1 ? allLessons[selectedLessonNumber - 2] : null;
  const nextInOrder =
    selectedLessonNumber > 0 ? allLessons[selectedLessonNumber] ?? null : null;
  // The next one opens on a DATE (deadline drip): completing this one does not unlock it.
  // The button below used to say "Next lesson" and did nothing; now it says when
  // it opens. (Sequential does not come in here: completing this one is what opens the
  // next, and completeAndFindNext already handles that.)
  const nextUnlockState = nextInOrder ? lessonUnlockStateById.get(nextInOrder.id) : undefined;
  const nextOpensAt =
    nextUnlockState && !nextUnlockState.unlocked && nextUnlockState.reason === "scheduled"
      ? nextUnlockState.unlocksAt
      : null;
  // Members-area hero cover: the teacher's chosen members_cover CourseAsset
  // (resolved to a protected object URL inside the hero band). Only available
  // once the course assets are streamed (enableFirestoreAssets); otherwise the
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
      if (
        asset.courseId === course.id
        && asset.kind === "lesson_thumbnail"
        && asset.lessonId
        && courseLessonIds.has(asset.lessonId)
        && asset.contentType.startsWith("image/")
      ) {
        // Thumbnails are public-media assets. Never sign private content to
        // fill the navigation; absent/unsafe URLs keep its existing fallback.
        const url = getSafeMediaUrl(asset.downloadUrl);
        const parsedDate = Date.parse(String(asset.createdAt ?? ""));
        const date = Number.isNaN(parsedDate) ? -Infinity : parsedDate;
        if (url && (!thumbnailUrlByLessonId.has(asset.lessonId)
          || date > thumbnailDateByLessonId.get(asset.lessonId)!)) {
          thumbnailUrlByLessonId.set(asset.lessonId, url);
          thumbnailDateByLessonId.set(asset.lessonId, date);
        }
      }
      if (asset.lessonId) {
        assetCountByLessonId.set(
          asset.lessonId,
          (assetCountByLessonId.get(asset.lessonId) ?? 0) + 1,
        );
      }
    }
  }
  // An OPEN lesson with no cover of its own and with a YouTube link: the video's
  // own cover. A locked lesson gets none: its link never reaches the page (RLS
  // hides it), and even a link in the curriculum does not become a cover while it is
  // closed. Vimeo and Bunny are left out. The id already comes clean
  // ([a-zA-Z0-9_-]) from getTrustedLessonEmbed; the CSP (img-src https:) already covers
  // i.ytimg.com.
  for (const lesson of allLessons) {
    if (thumbnailUrlByLessonId.has(lesson.id) || !lessonUnlockStateById.get(lesson.id)?.unlocked) {
      continue;
    }
    // With no content object, no cover: the teacher's preview may receive
    // null from here (preview-tabs.test.tsx stubs it that way) and the classroom must not crash.
    const content = resolveLessonContent(lessonContentMap?.get(lesson.id), lesson);
    if (!content) {
      continue;
    }
    const embed = getTrustedLessonEmbed(content?.externalUrl);
    if (embed?.provider === "youtube") {
      thumbnailUrlByLessonId.set(lesson.id, `https://i.ytimg.com/vi/${embed.videoId}/hqdefault.jpg`);
    }
  }
  // Returns whether the write worked: whoever advances to the next lesson depends on
  // this (see completeAndFindNext).
  async function toggleLessonCompletion(lessonId: string, completed: boolean): Promise<boolean> {
    if (previewMode) {
      setActionError("creatorEditor.preview.readOnly");
      return false;
    }

    if (!user || !workspaceEnrollment) {
      return false;
    }

    const unlockState = lessonUnlockStateById.get(lessonId);

    if (unlockState && !unlockState.unlocked) {
      setActionError("learn.classroom.workspace.lessonLockedError");
      return false;
    }

    setActionError("");
    setActiveLessonId(lessonId);

    try {
      // Progress is computed server-side: recordLessonProgress calls the
      // record_lesson_progress RPC, which validates the lesson, writes the
      // marker, and returns the authoritative progressPercent. The
      // completedLessons subscription refreshes the UI checkmarks from the
      // resulting write.
      const result = await recordLessonProgress(
        workspaceEnrollment.id,
        lessonId,
        !completed,
      );

      if (!completed) {
        // Saved: the lesson goes straight into the completed list, without waiting for
        // realtime. Otherwise, in a sequential course, "complete and continue" opened the
        // next one as locked until the channel delivered the write. Same order as the
        // subscription (sort), so the completed key does not change again.
        setProgressState((current) =>
          current.lessonIds.includes(lessonId)
            ? current
            : { ...current, lessonIds: [...current.lessonIds, lessonId].sort() },
        );
      }

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
      return true;
    } catch {
      setActionError("learn.classroom.workspace.progressSaveError");
      return false;
    } finally {
      setActiveLessonId(null);
    }
  }

  // Hotmart parity: watching to the end completes the lesson and rolls into the
  // next one. That single write also fixes "resume where you left off" — the
  // mount-time fallback already opens getNextCourseLesson (first incomplete),
  // it just never had anything to resume from while completion was manual.
  //
  // Completes the current lesson (if missing) and returns the next one, only if it opened.
  async function completeAndFindNext(): Promise<Lesson | null> {
    // Preview writes are hard-blocked upstream; calling through would only
    // surface "Preview mode is read-only" at the end of every clip.
    if (previewMode || !selectedLesson) {
      return null;
    }

    const endedLessonId = selectedLesson.id;

    if (
      !completedLessonIds.includes(endedLessonId)
      && !(await toggleLessonCompletion(endedLessonId, false))
    ) {
      // Did not save: nothing advances. Before, the next one was proposed anyway and,
      // in a sequential course, opened locked and the server denied the video. The
      // error notice is already in the player.
      return null;
    }

    if (!nextInOrder) {
      return null;
    }

    // Recomputed with the lesson we just finished, otherwise a sequential-drip
    // course always reads the next lesson as locked (the state in
    // lessonUnlockStateById predates this completion) and the chain stops on
    // the very courses auto-advance matters most for. Still locked (date drip)?
    // Complete this one and stop, rather than dropping the student on a lock
    // panel.
    const nextUnlockState = getLessonUnlockState(
      course,
      nextInOrder,
      workspaceEnrollment,
      [...completedLessonIds, endedLessonId],
      // The same clock as the panel and the reload.
      new Date(clockNow),
    );

    return nextUnlockState.unlocked ? nextInOrder : null;
  }

  async function handleLessonEnded() {
    const next = await completeAndFindNext();
    if (next) {
      // Does not switch silently: the "Next lesson" card over the video counts 5 s
      // with "Watch now" and "Cancel". With no action, the next one starts playing.
      setNextUp(next);
    }
  }

  // The learner accepted (or let the time run out): switches lesson and asks for autoplay
  // — allowed because they already interacted with the page.
  function playNextUp() {
    if (!nextUp) {
      return;
    }
    setNextUp(null);
    setAutoplayLessonId(nextUp.id);
    selectLesson(nextUp.id);
  }

  // The button under the lesson is an explicit request: it goes straight to the next one, without the
  // 5 s countdown (that is for the end of the video, when nobody clicked anything).
  async function completeAndGoNext() {
    const next = await completeAndFindNext();
    if (next) {
      selectLesson(next.id);
    }
  }

  // The cover is the course home page — first visit (no lesson in the address
  // and no progress), the teacher's preview, or the "About" tab. On every
  // lesson, a short header: back, title, progress. Before, the whole cover
  // (image, description, button) pushed the video down on EVERY lesson.
  const isCourseHome =
    previewMode
    || tab === "about"
    || (!lessonParam && completedLessonIds.length === 0);

  // Back goes up ONE level — it does not jump to the end of the hallway.
  //
  // WHY THIS EXISTS
  //
  // Inside a tab (Materials, Community, Messages, Review, About) the
  // "←" went straight to "My courses": someone who opened the community to ask a
  // question about the lesson was thrown out of the whole course and had to find the
  // course, find the lesson and scroll again. Now, from a tab it goes back to the
  // LESSON (the same one, through ?lesson=); from the lesson, then yes, to the course list.
  const inClassroomTab = tab !== "lesson";
  const backHref = inClassroomTab
    ? classroomTabHref(basePath, "lesson", selectedLesson?.id ?? null)
    : creatorArea?.href ?? "/learn";
  const backLabel = inClassroomTab
    ? t("learn.membersHero.backToLesson")
    : creatorArea
      ? t("learn.memberArea.backToArea").replace("{name}", () => creatorArea.name)
      : t("learn.membersHero.back");

  // With no lesson, the classroom opens on what the product delivers: the community, or the
  // lives tab of the live event. The Lessons tab leaves the bar (it would repeat the
  // same screen); in any other case with no lesson it shows the empty notice.
  const emptyDefaultTab: ClassroomTab | null =
    totalLessonCount > 0 || tab !== "lesson"
      ? null
      : productFormat === "community" && communityEnabled
        ? "community"
        : productFormat === "live_event" && !previewMode
          ? "lives"
          : null;
  const activeTab = emptyDefaultTab ?? tab;
  // A live event after its date: the tab stays, with "already happened" and the
  // recording (the lesson the teacher adds), if there is one.
  const sessionAlreadyHappened =
    productFormat === "live_event"
    && liveState.events.some(
      (event) => event.status !== "cancelled" && Date.parse(event.startsAt) <= liveState.now,
    );

  // The tabs this course has. Materials only when the course files are
  // read (courses published by a teacher); lives, community and messages do not
  // exist in the preview — and community only if the teacher turned it on.
  const classroomTabs: ClassroomTabItem[] = [
    ...(emptyDefaultTab ? [] : [{ id: "lesson" as const, label: t("creatorEditor.preview.tabs.lesson") }]),
    ...(enableFirestoreAssets
      ? [{ id: "materials" as const, label: t("creatorEditor.preview.tabs.materials"), count: materialGroups.count }]
      : []),
    ...(!previewMode && (upcomingEvents.length > 0 || activeTab === "lives" || productFormat === "live_event")
      ? [{ id: "lives" as const, label: t("creatorEditor.preview.tabs.lives") }]
      : []),
    ...(communityEnabled
      ? [{ id: "community" as const, label: t("creatorEditor.preview.tabs.community"), count: openQuestionCount }]
      : []),
    ...(previewMode ? [] : [{ id: "messages" as const, label: t("creatorEditor.preview.tabs.messages") }]),
    { id: "review", label: t("creatorEditor.preview.tabs.review") },
    { id: "about", label: t("creatorEditor.preview.tabs.about") },
  ];

  return (
    <div
      ref={roomRef}
      className="member-classroom"
      data-members-theme={course.membersTheme ?? "light"}
    >
      {isCourseHome ? (
        <MembersAreaHeroBand
          course={course}
          coverAsset={membersCoverAsset}
          progressPercent={previewMode || totalLessonCount === 0 ? null : progressPercent}
          completedCount={previewMode || totalLessonCount === 0 ? null : completedLessonCount}
          totalCount={previewMode || totalLessonCount === 0 ? null : totalLessonCount}
          certificateHref={previewMode ? null : certificateHref}
          backHref={backHref}
          backTo={inClassroomTab ? "lesson" : "courses"}
          backLabel={backLabel}
          // The lesson the classroom would open (the one in the address, otherwise the first not
          // completed): the same calculation as selectedLesson, with no new read.
          primaryAction={
            // Only with the progress in hand: before it, someone who had already started saw
            // "Start lesson 1" flash. The preview has no progress.
            selectedLesson && (previewMode || progressReady)
              ? {
                  href: classroomTabHref(basePath, "lesson", selectedLesson.id),
                  label: productFormat === "ebook"
                    ? t("learn.membersHero.openFile")
                    : completedLessonIds.length === 0 && selectedLesson.id === allLessons[0]?.id
                      ? t("learn.membersHero.start")
                      : t("learn.membersHero.continue").replace("{title}", () => selectedLesson.title),
                }
              : null
          }
        />
      ) : (
        <header className="member-classroom-head">
          {/* On the phone only the arrow stays in view (the label is still the
                  link name): "← Maria Fernanda's members area" squeezed the course
                  name until it vanished. */}
          <Link href={backHref} className="member-classroom-head__back">
            ← <span className="max-[640px]:sr-only">{backLabel}</span>
          </Link>
          <div className="member-classroom-head__main">
            {/* The COURSE name, not the members area title: that one is the
                    cover greeting, and whoever filled it with their own name left
                    the whole classroom without saying which course it was. */}
            <h1 className="member-classroom-head__title">
              {course.title}
            </h1>
            {activeTab === "lesson" && selectedLesson ? (
              <LessonStepper
                previous={previousInOrder}
                next={nextInOrder}
                nextLocked={Boolean(
                  nextInOrder
                    && lessonUnlockStateById.get(nextInOrder.id)?.unlocked === false,
                )}
                onSelect={selectLesson}
              />
            ) : null}
          </div>
          {/* The house bar (ui/progress-bar), in the course colors: the track on the
                  course line comes from the classroom CSS, the fill from the accent. It
                  slides to the new mark (transform), instead of jumping. */}
          <ProgressBar
            value={progressPercent}
            label={t("learn.paths.percentComplete").replace("{percent}", () => String(progressPercent))}
            className="member-classroom-head__progress"
            fillClassName="bg-[var(--ma-accent)]"
          />
          <span className="member-classroom-head__percent inline-flex items-center gap-1">
            {progressPercent}%
            {/* The milestone: the bar reached the end (the same badge as the builder). */}
            {progressPercent === 100 ? <MilestoneSeal animate={justCompletedIds.size > 0} /> : null}
          </span>
        </header>
      )}

      {previewMode ? (
        <section className="member-preview-banner">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--color-primary)]">
              {t("creatorEditor.preview.banner")}
            </p>
            {previewExitHref ? (
              <Link href={previewExitHref} className="button-outline px-4 py-2 text-xs">
                {t("creatorEditor.preview.exit")}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* The "Lesson tools" strip used to live here: chips with course numbers and three
              buttons ("Current lesson", "Resources", "Discussion") that only SCROLLED the
              page — they looked like navigation and led nowhere, and there was no
              way back from where they scrolled. It became the tab bar: each one is an
              address. */}
      <ClassroomTabs
        basePath={basePath}
        active={activeTab}
        lessonId={selectedLesson?.id ?? null}
        tabs={classroomTabs}
        // On the cover at 100% the certificate is already the hero's main action (same
        // conditions as the MembersAreaHeroBand above); here it would be the same
        // "Get certificate" twice on the same screen.
        certificateHref={
          isCourseHome && !previewMode && totalLessonCount > 0 ? null : certificateHref
        }
      />

      {/* A session starting or live: the strip stays on ALL tabs. Beside
              the reads, not inside them: with the schedule failing, the classroom opens
              the same (the strip uses what has already arrived). */}
      {previewMode ? null : <ClassroomLiveStrip events={liveState.events} />}

      {/* A single grid item for the open tab: on a tab switch it comes in
              rising 8px (motion-panel-in); on page load, still. The fixed
              class carries the 24px breathing room up to the classroom frame (globals.css): without
              it the panels touched the edge and the video went past the screen on the
              phone. */}
      <div className={tabChanged ? "member-classroom-body motion-panel-in" : "member-classroom-body"}>
      {activeTab === "lesson" && totalLessonCount === 0 ? (
        <section className="member-resource-panel">
          <p className="text-sm text-[var(--color-ink-soft)]">{t("learn.classroom.workspace.noLessons")}</p>
        </section>
      ) : null}

      {activeTab === "lesson" && totalLessonCount > 0 ? (
      <div className="member-classroom-layout">
        <section id="member-lesson-player" className="member-classroom-player">
        {actionError ? (
          <InlineAlert tone="error" className="mb-5">
            {t(actionError)}
          </InlineAlert>
        ) : null}
        {selectedLesson && resolvedSelectedLesson ? (
          <LessonContentPanel
            assets={selectedLessonAssets}
            courseId={course.id}
            enrollmentId={workspaceEnrollment?.id ?? null}
            enableFirestoreAssets={enableFirestoreAssets}
            isLoadingAssets={
              Boolean(
                enableFirestoreAssets
                  && (!assetsState.ready || assetsState.key !== course.id),
              )
              // A lesson with text in its own curriculum already has something to show: the
              // player stays on "Text-first lesson", not on "loading".
              || (selectedLessonReleasing && !resolvedSelectedLesson?.contentText?.trim())
            }
            // A lesson released now with the text already in the curriculum: nothing to wait for
            // (the same criterion as isLoadingAssets above).
            isLoadingContent={
              isLessonContentLoading
              || (selectedLessonReleasing && !resolvedSelectedLesson?.contentText?.trim())
            }
            lesson={resolvedSelectedLesson}
            onEnded={handleLessonEnded}
            unlockState={selectedLessonUnlockState}
            previousRequiredLesson={previousRequiredLesson}
            underHero={isCourseHome}
            onSelectLesson={selectLesson}
            previewMode={previewMode}
            lessonComments={
              // At the end of the panel, after the material (Hotmart parity, P3):
              // the community feed filtered by this lesson. It disappears on its own
              // when the course community is turned off.
              <LessonComments
                course={course}
                lesson={{ id: selectedLesson.id, number: selectedLessonNumber }}
                basePath={basePath}
                previewMode={previewMode}
              />
            }
            autoplay={autoplayLessonId === selectedLesson.id}
            nextUp={nextUp}
            onPlayNextUp={playNextUp}
            onCancelNextUp={() => setNextUp(null)}
          />
        ) : null}
        {selectedLesson ? (
          // Sticky so the four actions stay reachable however long the lesson
          // body and its discussion run — the bar every member area the student
          // already uses keeps pinned to the bottom.
          // bg-inherit picks up the player surface, which the members theme
          // repaints, so the bar follows the course theme with no fork.
          // The negative margins cancel the card padding (16px on the phone,
          // 24px above 768): pinned to the foot of the screen, the bar covers the card
          // edge to edge, with no text passing by the sides.
          <nav
            aria-label={t("creatorEditor.preview.lessonNavigation")}
            className="sticky bottom-0 z-20 -mx-4 mt-5 flex flex-wrap items-center justify-center gap-3 border-t border-[var(--color-line)] bg-inherit px-4 py-3 md:-mx-6 md:px-6"
          >
            {/* "Previous" used to live here, alone, with no "next" beside it. Both
                    now sit next to the title (LessonStepper), once only. */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <button
                type="button"
                onClick={() => setLessonListOpen(true)}
                // From 1181px up the playlist is already beside the video (the
                // layout becomes a single column at max-width: 1180px).
                className="button-outline flex-1 px-4 py-2.5 text-sm sm:flex-none min-[1181px]:hidden"
              >
                {t("creatorEditor.preview.allLessons").replace("{count}", () => String(totalLessonCount))}
              </button>
              {/* One action instead of "Mark complete" + "Next": completing
                  and advancing is a single intent, and it gives every backend
                  the same auto-advance semantics even where the player never
                  reports "ended". Un-marking still lives on the lesson cards
                  in the curriculum strip.
                  Last lesson done: the action is the certificate, not a
                  "Completed" button that does nothing. */}
              {!previewMode
                && certificateHref
                && !nextInOrder
                && completedLessonIds.includes(selectedLesson.id) ? (
                <Link
                  href={certificateHref}
                  className="button-solid flex-1 px-4 py-2.5 text-sm sm:flex-none"
                >
                  {t("learn.classroom.workspace.certificate")}
                </Link>
              ) : (
              <button
                type="button"
                onClick={completeAndGoNext}
                disabled={
                  previewMode
                  || Boolean(
                    selectedLessonUnlockState
                      && !selectedLessonUnlockState.unlocked,
                  )
                  || activeLessonId === selectedLesson.id
                  || ((!nextInOrder || Boolean(nextOpensAt)) && completedLessonIds.includes(selectedLesson.id))
                }
                className="button-solid flex-1 px-4 py-2.5 text-sm sm:flex-none"
              >
                {/* "Saving..." only applies outside the preview and with the lesson open,
                        as before; both labels in the same cell, so the button does not
                        change width on completing. */}
                <BusyLabel
                  busy={
                    !previewMode
                    && !(selectedLessonUnlockState && !selectedLessonUnlockState.unlocked)
                    && activeLessonId === selectedLesson.id
                  }
                  idle={
                    previewMode
                      ? t("creatorEditor.preview.only")
                      : selectedLessonUnlockState
                          && !selectedLessonUnlockState.unlocked
                        ? t("learn.classroom.lesson.locked")
                        : completedLessonIds.includes(selectedLesson.id)
                          ? nextInOrder
                            ? nextOpensAt
                              // "Next lesson · Unlocks Nov 24, 2026": the same sentence
                              // as the playlist, saying which lesson it is about.
                              ? `${t("learn.classroom.nextLesson.title")} · ${t("learn.classroom.lesson.unlocks").replace("{date}", () => formatUnlockDate(nextOpensAt, locale))}`
                              : t("learn.classroom.nextLesson.title")
                            : t("learn.classroom.curriculum.completed")
                          : nextInOrder && !nextOpensAt
                            ? t("learn.classroom.workspace.completeAndNext")
                            : t("learn.classroom.workspace.complete")
                  }
                  busyText={t("learn.classroom.workspace.saving")}
                />
              </button>
              )}
            </div>
          </nav>
        ) : null}
        </section>

        {/* Beside the video lives the PLAYLIST — not a card of numbers
                ("Lesson 3/12 · Files 2"), nor "Continue" (the current lesson is already
                highlighted), nor "workspace links" (the only way out is "← My courses"
                at the top; the sales page does not belong in the classroom). */}
        <aside className="member-classroom-sidebar min-w-0">
          {/* Without module art the posters were just number + title: the same
                  groups as the playlist right below. The module description stays. */}
          {showModulePosters ? (
            <nav className="min-w-0 max-w-full" aria-label={t("learn.classroom.curriculum.modules")}>
              <h2 className="mb-2 text-sm font-semibold text-[var(--ma-ink)]">
                {t("learn.classroom.curriculum.modules")}
              </h2>
              <ol className="flex min-w-0 max-w-full gap-3 overflow-x-scroll p-1 [scrollbar-width:auto]">
                {course.modules.map((module, moduleIndex) => {
                  const coverUrl = getSafeMediaUrl(getModuleCoverAsset(module, moduleCoverAssets)?.downloadUrl);
                  const targetLesson = module.lessons.find((lesson) => !completedLessonIds.includes(lesson.id))
                    ?? module.lessons[0];
                  const isCurrent = selectedModule?.id === module.id;
                  return (
                    <li key={module.id} className="shrink-0">
                      <button
                        type="button"
                        className="group block w-[120px] rounded-md text-left text-[var(--ma-ink)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--ma-accent-ink)] disabled:cursor-default disabled:opacity-60 sm:w-[160px]"
                        aria-label={t("learn.classroom.curriculum.openModule").replace("{title}", () => module.title)}
                        aria-current={isCurrent ? "true" : undefined}
                        disabled={!targetLesson}
                        onClick={() => { if (targetLesson) selectLesson(targetLesson.id); }}
                      >
                        <span className={`relative block aspect-[2/3] w-full overflow-hidden rounded-md border-2 bg-[var(--ma-surface-2)] ${isCurrent ? "border-[var(--ma-accent-ink)]" : "border-transparent group-hover:border-[var(--ma-line)]"}`}>
                          {coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-3xl font-semibold text-[var(--ma-ink-soft)]">
                              {moduleIndex + 1}
                            </span>
                          )}
                        </span>
                        <span className="mt-2 block text-sm font-semibold [overflow-wrap:anywhere]">{module.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {moduleSummary}
            </nav>
          ) : moduleSummary}
          <CoursePlaylist
            thumbnailUrlByLessonId={thumbnailUrlByLessonId}
            modules={course.modules}
            selectedLessonId={selectedLesson?.id ?? null}
            completedLessonIds={completedLessonIds}
            unlockStateById={lessonUnlockStateById}
            onSelect={selectLesson}
            onUncomplete={
              previewMode
                ? undefined
                : (lessonId) => toggleLessonCompletion(lessonId, true)
            }
            justCompletedIds={justCompletedIds}
          />
          {!previewMode
            && workspaceEnrollment.source === "subscription"
            && workspaceEnrollment.subscriptionId ? (
            <CourseSubscriptionCard
              key={workspaceEnrollment.subscriptionId}
              courseId={course.id}
              subscriptionId={workspaceEnrollment.subscriptionId}
            />
          ) : null}
        </aside>
      </div>
      ) : null}

      {/* The other tabs. Before, ALL of this came after the curriculum, in the same
              scroll (4 to 6 screens tall), with no address. Now only the open tab
              renders — and it has its own path. */}
      {activeTab === "materials" && enableFirestoreAssets ? (
        <CourseMaterialsPanel
          groups={materialGroups}
          isLoading={Boolean(
            enableFirestoreAssets
              && (!assetsState.ready || assetsState.key !== course.id),
          )}
        />
      ) : null}

      {activeTab === "lives" && !previewMode ? (
        <CourseEventsAgenda
          upcoming={upcomingEvents}
          now={liveState.now}
          failed={liveState.failed}
          onRetry={() => eventsSubscription.current?.reload?.()}
          alreadyHappened={sessionAlreadyHappened}
          replayHref={allLessons[0] ? classroomTabHref(basePath, "lesson", allLessons[0].id) : null}
        />
      ) : null}

      {activeTab === "community" && communityEnabled ? (
        <CourseCommunitySection
          course={course}
          currentLesson={
            selectedLesson
              ? { id: selectedLesson.id, title: selectedLesson.title, number: selectedLessonNumber }
              : null
          }
          openPostId={openPostId}
        />
      ) : null}

      {activeTab === "messages" && !previewMode ? <CourseMessagesPanel courseId={course.id} whitelabel={whitelabel} /> : null}

      {activeTab === "review" ? (
        <CourseReviewPanel
          courseId={course.id}
          progressPercent={progressPercent}
          // With no lesson track (another type, or no lesson) there is no 50% to
          // reach. Same rule as submit_course_review.
          requiresProgress={productFormat === "course" && totalLessonCount > 0}
          previewMode={previewMode}
        />
      ) : null}

      {/* Subscription: outside the lesson track (community or event with no lesson, and
              the other tabs) the cancel card comes here. Before, it only existed
              beside the curriculum, and whoever subscribed to a product with no lesson had
              nowhere to cancel. */}
      {!(activeTab === "lesson" && totalLessonCount > 0)
        && !previewMode
        && workspaceEnrollment.source === "subscription"
        && workspaceEnrollment.subscriptionId ? (
        <section className="member-resource-panel" data-subscription-panel>
          <CourseSubscriptionCard
            key={workspaceEnrollment.subscriptionId}
            courseId={course.id}
            subscriptionId={workspaceEnrollment.subscriptionId}
          />
        </section>
      ) : null}
      </div>

      {lessonListOpen ? (
        <LessonListOverlay
          thumbnailUrlByLessonId={thumbnailUrlByLessonId}
          modules={course.modules}
          selectedLessonId={selectedLesson?.id ?? null}
          completedLessonIds={completedLessonIds}
          unlockStateById={lessonUnlockStateById}
          onSelect={selectLesson}
          onClose={() => setLessonListOpen(false)}
        />
      ) : null}
    </div>
  );
}

// Upcoming live sessions for THIS course, right where the student studies.
// Events are keyed by course.id in course_events.course_slug (the convention
// teacher-event-studio writes). The workspace subscribes and only lists the tab
// when there is a session; opened by its address with none, it says so.
function CourseEventsAgenda({
  upcoming: listed,
  now,
  failed = false,
  onRetry,
  alreadyHappened = false,
  replayHref = null,
}: {
  upcoming: CourseEvent[];
  now: number;
  failed?: boolean;
  onRetry?: () => Promise<unknown> | void;
  alreadyHappened?: boolean;
  replayHref?: string | null;
}) {
  const { t, locale } = useTranslation();
  // The clock that ticks: "Happening now" and "Join now" show up right away, without
  // reloading (before, the "now" stopped at the moment the list arrived).
  const clock = useNow();
  const panelRef = useRef<HTMLElement>(null);
  const upcoming = listed.filter(
    (event) => event.status === "cancelled" || getEventLiveState(event.startsAt, clock, event.type) !== "over",
  );

  // now = 0: the first read has not come back yet. We cannot say "none".
  if (now === 0) {
    return null;
  }

  // The read failed: the error and "Try again", never "no sessions scheduled"
  // (for whoever bought a live event, the session is the whole product).
  if (failed) {
    return (
      <section ref={panelRef} tabIndex={-1} className="member-resource-panel">
        <LoadErrorAlert focusRef={panelRef} onRetry={() => onRetry?.()}>
          {t("learnWave2.agenda.loadError")}
        </LoadErrorAlert>
      </section>
    );
  }

  if (upcoming.length === 0) {
    return (
      <section className="member-resource-panel">
        <p className="text-sm text-[var(--color-ink-soft)]">
          {t(alreadyHappened ? "learnWave2.agenda.happened" : "learnWave2.agenda.empty")}
        </p>
        {alreadyHappened && replayHref ? (
          <Link href={replayHref} className="button-outline mt-4 inline-flex items-center gap-2 px-5 py-2.5 text-sm">
            <PlayCircle size={16} aria-hidden />
            {t("learnWave2.agenda.replay")}
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <section className="member-resource-panel">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {t("learnWave2.agenda.eyebrow")}
        </p>
        <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
          {t("learnWave2.agenda.title")}
        </h4>
      </div>
      <ul className="mt-4 grid gap-3">
        {upcoming.map((event) => {
          // A deadline is never "live" nor "Join now" (getEventLiveState):
          // it shows up as a due date, with "Open link".
          const isDeadline = event.type === "deadline";
          const state = getEventLiveState(event.startsAt, clock, event.type);
          const isLiveNow = state === "live";
          // From 15 min before onward, the join button gets highlighted.
          const isJoinTime = isLiveNow || state === "startingSoon";
          const isCancelled = event.status === "cancelled";
          const date = formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"));
          const when = isDeadline ? t("platform.events.dueBy").replace("{when}", () => date) : date;
          const updatedAt = isCancelled ? null : getEventUpdatedAt(event);
          const joinUrl = isValidExternalEventUrl(event.externalUrl)
            ? event.externalUrl
            : null;

          return (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border fine-rule bg-[var(--color-surface-soft)] px-5 py-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="member-meta-chip">
                    {t(`creatorPanel.events.type.${event.type}`)}
                  </span>
                  {isCancelled ? (
                    <span className="member-meta-chip">{t("creatorPanel.events.status.cancelled")}</span>
                  ) : isLiveNow ? (
                    <span className="rounded-full bg-[rgba(178,34,52,0.1)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent-fg)]">
                      {t("learnWave2.agenda.now")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--color-primary)]">
                  {event.title}
                </p>
                <p className="mt-1 text-xs font-semibold text-[var(--color-ink-soft)]">
                  {isCancelled ? <s>{when}</s> : when}
                </p>
                {updatedAt ? (
                  <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                    {t("learnWave2.eventsHub.updated").replace("{date}", () =>
                      formatEventDateTime(updatedAt, locale, t("platform.events.datePending")),
                    )}
                  </p>
                ) : null}
              </div>
              {/* Canceled: no join link and no calendar. */}
              {isCancelled ? null : joinUrl ? (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${isJoinTime ? "button-accent" : "button-outline"} inline-flex items-center gap-2 px-5 py-2.5 text-sm`}
                >
                  <PlayCircle size={16} aria-hidden />
                  {t(isDeadline ? "platform.events.openLink" : isJoinTime ? "learnWave2.agenda.join" : "learnWave2.agenda.open")}
                </a>
              ) : (
                <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
                  {t(noJoinLinkKey(event.type))}
                </span>
              )}
              {!isCancelled && state === "upcoming" ? (
                <div className="basis-full">
                  <EventCalendarActions event={event} joinUrl={joinUrl} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Teacher-opt-in community, rendered inside the members area (product decision
// 2026-07-02: community lives here, not on a separate hub page). The space is
// keyed by course.id — the same key the teacher's inbox (/teach/.../community)
// uses — so both read and write the same community_posts rows.
function CourseCommunitySection({
  course,
  currentLesson,
  openPostId,
}: {
  course: Course;
  currentLesson: CommunityFeedLesson | null;
  openPostId: string | null;
}) {
  const { t } = useTranslation();
  // Who the teacher is. The feed marks their answers ("· Instructor"), puts
  // their answer first in the card and names the filter "From <name>".
  // Without this the teacher was just another member and the filter said "the
  // instructor". The name comes from the public projection (public_profiles), the same as the
  // storefront — nothing beyond what any visitor already sees.
  const instructorId = course.instructorId ?? null;
  const [instructor, setInstructor] = useState<{
    forId: string | null;
    name: string | null;
  }>({ forId: null, name: null });
  useEffect(() => {
    if (!instructorId) return;
    return subscribeToPublicProfile(
      instructorId,
      (profile) => setInstructor({ forId: instructorId, name: profile?.displayName ?? null }),
      () => setInstructor({ forId: instructorId, name: null }),
    );
  }, [instructorId]);
  const instructorName = instructor.forId === instructorId ? instructor.name : null;
  const instructorIds = useMemo(() => (instructorId ? [instructorId] : []), [instructorId]);
  // The course owner who is also enrolled moderates from here (pin, delete).
  // The database checks again (owns_course_reference).
  const { user } = useAuth();
  const canModerate = Boolean(user && instructorId && user.uid === instructorId);

  const space: CommunitySpace = {
    id: `creator-${course.id}`,
    courseSlug: course.id,
    name: `${course.title} community`,
    description:
      t("learnWave2.agenda.communityDescription"),
    visibility: "enrolled_only",
    categories: ["announcement", "discussion", "question", "resource"],
  };

  // The simplified community (mockup 5): the feed has its own header; the
  // panel with a headline ("Course community / Connect with other students")
  // repeated the tab and pushed the feed down.
  return (
    <section className="member-resource-panel">
      <CommunityFeed
        space={space}
        currentLesson={currentLesson}
        openPostId={openPostId}
        instructorName={instructorName}
        instructorIds={instructorIds}
        canModerate={canModerate}
      />
    </section>
  );
}

function MembersAreaHeroBand({
  course,
  coverAsset,
  progressPercent,
  completedCount,
  totalCount,
  certificateHref,
  backHref,
  backTo,
  backLabel,
  primaryAction,
}: {
  course: Course;
  coverAsset?: CourseAsset;
  progressPercent: number | null;
  completedCount: number | null;
  totalCount: number | null;
  certificateHref: string | null;
  backHref: string;
  primaryAction: { href: string; label: string } | null;
  /** Back goes up one level: from the About tab, to the lesson; from the lesson, to /learn. */
  backTo: "courses" | "lesson";
  backLabel: string;
}) {
  // Resolve the members_cover asset to a protected object URL with the same
  // mount guard and revoke-on-unmount pattern used by protected previews.
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
      theme={course.membersTheme ?? "light"}
      coverUrl={objectUrl ?? course.image ?? null}
      title={course.membersTitle ?? course.title}
      // Own title on the cover (often the teacher's name) and no
      // subtitle: the course name goes on the line below, otherwise the cover nowhere
      // said which course this is.
      subtitle={
        course.membersSubtitle
          ?? (course.membersTitle && course.membersTitle !== course.title ? course.title : null)
      }
      description={course.membersDescription ?? course.summary ?? null}
      progressPercent={progressPercent}
      completedCount={completedCount}
      totalCount={totalCount}
      certificateHref={certificateHref}
      backHref={backHref}
      backTo={backTo}
      backLabel={backLabel}
      primaryAction={primaryAction}
    />
  );
}

const lessonTypeLabels: Record<LessonType, string> = {
  video: "learn.classroom.lesson.types.video",
  text: "learn.classroom.lesson.types.text",
  quiz: "learn.classroom.lesson.types.quiz",
  assignment: "learn.classroom.lesson.types.assignment",
  live_recording: "learn.classroom.lesson.types.live_recording",
  download: "learn.classroom.lesson.types.download",
  external_embed: "learn.classroom.lesson.types.external_embed",
};

function formatUnlockMessage(
  unlockState: LessonUnlockState,
  locale: string,
  t: (key: string) => string,
  // Sequential: the name of the lesson that still has to be completed, when it is known which one.
  previousTitle: string | null = null,
) {
  if (unlockState.unlocked) {
    return t("learn.classroom.lesson.available");
  }

  if (unlockState.reason === "previous_lesson_required") {
    return previousTitle
      ? t("learn.classroom.lesson.previousRequiredNamed").replace("{title}", () => previousTitle)
      : t("learn.classroom.lesson.previousRequired");
  }

  if (unlockState.unlocksAt) {
    const date = formatUnlockDate(unlockState.unlocksAt, locale);
    return t("learn.classroom.lesson.unlocks").replace("{date}", () => date);
  }

  return t("learn.classroom.curriculum.locked");
}

// Previous / next beside the title (Hotmart parity, §4.3). The neighbor calculation
// already existed (previousInOrder / nextInOrder); the "previous" button in the
// bottom bar lived alone, with no "next". Here both, once only.
// Disabled = aria-disabled (still focusable; the screen reader hears
// "unavailable") and the click does nothing: a blocked next one NEVER opens from
// here — the padlock belongs to the panel, not to navigation. The automatic advance at the end
// of the video (NextLessonCard) stays as it is.
function LessonStepper({
  previous,
  next,
  nextLocked,
  onSelect,
}: {
  previous: Lesson | null;
  next: Lesson | null;
  nextLocked: boolean;
  onSelect: (lessonId: string) => void;
}) {
  const { t } = useTranslation();
  const steps = [
    { key: "previous", lesson: previous, disabled: !previous, Icon: ChevronLeft },
    { key: "next", lesson: next, disabled: !next || nextLocked, Icon: ChevronRight },
  ] as const;

  return (
    <div className="member-classroom-head__nav">
      {steps.map(({ key, lesson, disabled, Icon }) => (
        <button
          key={key}
          type="button"
          className="member-classroom-head__nav-button"
          aria-disabled={disabled || undefined}
          aria-label={
            lesson
              ? t(`learn.classroom.navigation.${key}Titled`).replace("{title}", () => lesson.title)
              : t(`learn.classroom.navigation.${key}`)
          }
          onClick={() => {
            if (!disabled && lesson) {
              onSelect(lesson.id);
            }
          }}
        >
          <Icon aria-hidden="true" size={18} strokeWidth={2.25} />
        </button>
      ))}
    </div>
  );
}

// "Mark complete" used to live at the end of this panel. It now sits in the
// sticky lesson action bar with Previous / All lessons / Next, so the student
// never has to scroll past the discussion to find it.
function LessonContentPanel({
  assets,
  autoplay = false,
  courseId,
  enrollmentId,
  enableFirestoreAssets,
  isLoadingAssets,
  isLoadingContent,
  lesson,
  lessonComments = null,
  nextUp = null,
  onCancelNextUp,
  onEnded,
  onPlayNextUp,
  onSelectLesson,
  previewMode,
  previousRequiredLesson = null,
  underHero = false,
  unlockState,
}: {
  assets: CourseAsset[];
  /** The lesson's course: the quiz is read by course + lesson (the lesson id alone is not unique). */
  courseId: string;
  /** The lesson opened through the "Next lesson" card: it starts playing on its own. */
  autoplay?: boolean;
  /** The learner's enrollment: without it (teacher's preview) the video position
    *  does not go to the database, only to the browser. */
  enrollmentId: string | null;
  enableFirestoreAssets: boolean;
  isLoadingAssets: boolean;
  /** Lesson proposed at the end of the video; the 5 s card sits over the player. */
  nextUp?: Lesson | null;
  onCancelNextUp?: () => void;
  onPlayNextUp?: () => void;
  isLoadingContent: boolean;
  lesson: Lesson;
  /** Lesson comments (the filtered community feed), at the end of the panel.
    *  The panel knows nothing about community: whoever assembles it is the classroom, which has the base
    *  path and the lesson number. */
  lessonComments?: ReactNode;
  onEnded: () => void;
  /** Opens another lesson in the classroom (the "Go to that lesson" button on the locked lesson). */
  onSelectLesson?: (lessonId: string) => void;
  previewMode: boolean;
  /** Sequential locked: the lesson that still has to be completed before this one. */
  previousRequiredLesson?: Pick<Lesson, "id" | "title"> | null;
  /** The course cover is above the panel (first visit, preview, About). */
  underHero?: boolean;
  unlockState: LessonUnlockState | null;
}) {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const viewerId = user?.uid ?? null;
  const locked = Boolean(unlockState && !unlockState.unlocked);
  // The lesson body + resource link live in the gated subcollection post-strip;
  // while that subscription is still loading and nothing has resolved yet, show
  // a loading state instead of the "not attached" empty copy.
  const lessonContentPending =
    isLoadingContent && !lesson.contentText && !lesson.externalUrl;
  // What plays is the MOST RECENT video of the lesson, not the first in the list.
  // fetchCourseAssets orders by the attachment order (position, name), so
  // a `.find()` here picked by list order: whoever re-recorded and uploaded
  // `final-v2.mp4` over `aula-01.mp4` through "file uploaded" and the learners
  // kept seeing the old take, with no way to change it.
  const primaryHostedVideo = locked
    ? null
    : getPrimaryLessonVideoAsset(assets);
  const supportingAssets = assets.filter(
    (asset) =>
      asset.kind !== "lesson_thumbnail"
      && (!primaryHostedVideo || asset.id !== primaryHostedVideo.id),
  );
  const trustedEmbed = locked ? null : getTrustedLessonEmbed(lesson.externalUrl);
  const resolvedVideoSource = resolveLessonVideoSource({
    declared: lesson.videoSource,
    hasVideoAsset: Boolean(primaryHostedVideo),
    hasTrustedEmbed: Boolean(trustedEmbed),
  });
  const safeLessonExternalUrl = getSafeExternalUrl(lesson.externalUrl);
  const hasPlayableVideo =
    !locked
    && ((resolvedVideoSource === "upload" && Boolean(primaryHostedVideo))
      || (resolvedVideoSource === "youtube" && Boolean(trustedEmbed)));
  // With no video, what decides the notice is the lesson BODY, not the type: a new lesson
  // is born as "video" and the teacher no longer changes the type (decision of Sep 14). A
  // reading-only lesson cannot say "Media not attached yet". The description does not
  // count: almost every video lesson has a one-line summary. The old "text"
  // type still holds.
  // The e-book lesson ("download") is the file, listed right below.
  const isTextFirstLesson =
    lesson.type === "text"
    || lesson.type === "download"
    || Boolean(lesson.contentText?.trim());
  // A ready reading lesson: no video box at all. Before, an empty
  // 260-520px box stayed there saying "read the notes below", with the
  // comments between it and the notes. Now the text comes first, and then the
  // comments. (Locked or loading, the box keeps its notice: in an
  // old course the video link arrives with the protected content, and deciding
  // "text only" before that made the page jump.)
  // A file-only lesson (PDF, e-book, mind map): no video and with a file
  // to download. It used to be "Media not attached yet" on top of the PDF, and the lesson
  // looked broken; now it is the file with a big download button. It holds
  // for the e-book's "download" lesson and for the ordinary lesson that only has a file.
  const lessonFiles = supportingAssets.filter((asset) => asset.kind === "lesson_material");
  const otherSupportingAssets = supportingAssets.filter((asset) => asset.kind !== "lesson_material");
  const contentReady = !locked && !hasPlayableVideo && !isLoadingContent && !isLoadingAssets;
  const fileOnly = contentReady && lessonFiles.length > 0;
  const textOnly = contentReady && (isTextFirstLesson || fileOnly);
  // The type told by what the lesson shows, not by the field: a new lesson is born
  // "video" (above), and a reading-only or file-only lesson said "VIDEO
  // LESSON" at the top.
  const shownType: LessonType =
    lesson.type === "video" && fileOnly
      ? "download"
      : lesson.type === "video" && textOnly
        ? "text"
        : lesson.type;
  // In the teacher's preview no position is saved: they are not the learner.
  // Memoized because the reference is an object: a new one on every render would reopen
  // the lesson (and the funnel's "opened" event) on every frame.
  const resume = useMemo(
    () =>
      previewMode ? null : lessonPositionRef(viewerId, enrollmentId, lesson.id),
    [enrollmentId, lesson.id, previewMode, viewerId],
  );

  const lessonBody = (
      <div id="member-lesson-content" className="member-lesson-body">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {t("learn.classroom.lesson.content")}
          </p>
          {lesson.isPreview ? (
            <span className="rounded-chip border border-[rgba(178,34,52,0.18)] bg-[rgba(178,34,52,0.05)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-fg)]">
              {t("learn.classroom.lesson.freePreview")}
            </span>
          ) : null}
        </div>
        {!locked && lesson.description ? (
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink)]">
            {lesson.description}
          </p>
        ) : null}
        {/* Dashes in place of a second "Loading lesson content...": the
                loading notice is a single one, the video box's. */}
        {!locked && lessonContentPending ? <SkeletonLines /> : null}
        {!locked && lesson.contentText ? (
          <div className="mt-4 whitespace-pre-line rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {linkify(lesson.contentText)}
          </div>
        ) : null}
        {!locked && safeLessonExternalUrl && !trustedEmbed ? (
          <a
            href={safeLessonExternalUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="button-outline mt-4 inline-flex px-4 py-2.5 text-sm"
          >
            {t("learn.classroom.lesson.openResource")}
          </a>
        ) : null}
        {isTeacherAiEnabled && !locked && !fileOnly ? <LessonQuiz key={lesson.id} courseId={courseId} lessonId={lesson.id} /> : null}
        {fileOnly ? (
          <>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("learn.classroom.lesson.fileOnlyHint")}
            </p>
            <MaterialFileList files={lessonFiles} large />
            {otherSupportingAssets.length > 0 ? (
              <LessonAssetList assets={otherSupportingAssets} isLoading={false} />
            ) : null}
          </>
        ) : !locked && enableFirestoreAssets ? (
          <LessonAssetList assets={supportingAssets} isLoading={isLoadingAssets} />
        ) : null}
      </div>
  );

  return (
    // F-02: the panel says it is loading while the content or the attachments
    // have not arrived; the announcement is a single one, the stage's (the comments do not repeat it).
    <div className="member-lesson-panel" aria-busy={!locked && (isLoadingContent || isLoadingAssets) ? true : undefined}>
      <div className="member-lesson-panel__head">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t(lessonTypeLabels[shownType])}
          </p>
          {/* h2: the lesson is the main section under the course h1 (before h4, and
                  the subsections h5). Under the cover, which already carries the course's 56px title,
                  the lesson's goes in the body text face, at 18px: one big
                  serif per screen. In the short header the serif stays with the lesson. */}
          <h2
            className={`mt-2 text-[var(--color-ink)] ${underHero ? "text-lg font-semibold" : "display-title text-3xl"}`}
          >
            {lesson.title}
          </h2>
        </div>
        {/* With no real duration (the "Self-paced" fallback from published-courses)
                there is no clock to show: the duration is no longer typed in. */}
        {/\d/.test(lesson.duration) ? (
          <span className="member-meta-chip">
            <Clock size={14} aria-hidden />
            {lesson.duration}
          </span>
        ) : null}
      </div>

      {textOnly ? null : (
      <VideoDock title={lesson.title} enabled={hasPlayableVideo} closeLabel={t("learn.classroom.lesson.closeMiniPlayer")}>
      <div className="member-video-stage relative">
        {nextUp && onPlayNextUp && onCancelNextUp ? (
          <NextLessonCard
            lesson={nextUp}
            onPlay={onPlayNextUp}
            onCancel={onCancelNextUp}
          />
        ) : null}
        {locked ? (
          <div className="member-video-empty">
            <LockKeyhole size={28} aria-hidden />
            <h3>{t("learn.classroom.lesson.locked")}</h3>
            <p>
              {unlockState
                ? formatUnlockMessage(unlockState, locale, t, previousRequiredLesson?.title ?? null)
                : t("learn.classroom.curriculum.locked")}
            </p>
            {previousRequiredLesson && onSelectLesson ? (
              <button
                type="button"
                onClick={() => onSelectLesson(previousRequiredLesson.id)}
                className="button-outline mt-3 px-4 py-2 text-sm"
              >
                {t("learn.classroom.lesson.goToPreviousLesson")}
              </button>
            ) : null}
          </div>
        ) : resolvedVideoSource === "upload" && primaryHostedVideo?.bunnyVideoId ? (
          <VideoWatermark>
            <BunnyVideoPlayer
              assetId={primaryHostedVideo.id}
              title={lesson.title}
              onEnded={onEnded}
              autoplay={autoplay}
              resume={resume}
            />
          </VideoWatermark>
        ) : resolvedVideoSource === "upload" && primaryHostedVideo ? (
          <ProtectedAssetPreview
            asset={primaryHostedVideo}
            onEnded={onEnded}
            resume={resume}
          />
        ) : resolvedVideoSource === "youtube" && trustedEmbed ? (
          <VideoWatermark>
            <TrustedEmbedPlayer
              embedUrl={trustedEmbed.embedUrl}
              provider={trustedEmbed.provider}
              title={lesson.title}
              onEnded={onEnded}
              autoplay={autoplay}
            />
          </VideoWatermark>
        ) : isLoadingContent || isLoadingAssets ? (
          // With the attachments still arriving, the video lesson flashed "Media not
          // attached yet" before the player appeared.
          // Loading = a stage in the 16:9 shape of the player that is coming (nothing jumps
          // when it arrives) and just a spinning ring. The play icon and the sentence
          // stay for "Media not attached yet": before, the two boxes were
          // identical. The text still goes to the screen reader, in a single notice.
          <div className="member-video-empty member-video-empty--loading" role="status">
            <Loader2 size={32} aria-hidden className="motion-safe:animate-spin" />
            <h3 className="sr-only">{t("learn.classroom.lesson.loading")}</h3>
          </div>
        ) : (
          <div className="member-video-empty">
            <PlayCircle size={34} aria-hidden />
            <h3>{t("learn.classroom.lesson.mediaMissing")}</h3>
            <p>{t("learn.classroom.lesson.mediaDetails")}</p>
          </div>
        )}
      </div>
      </VideoDock>
      )}

      {/* "Lesson information" is gone: it repeated type (above), duration (the chip),
              module (the lesson list) and files (the list below); the date of
              a locked lesson stays in the stage notice.
              The teacher's material (description, notes, files, quiz) comes right
              under the lesson, and the comments last. In the video lesson the body
              used to sit under an endless list of comments. */}
      {lessonBody}

      {/* Locked lesson: no comments. */}
      {!locked ? lessonComments : null}
    </div>
  );
}

// Wait rows for the lesson body and the files. Hidden from the screen
// reader: the loading notice is a single one, the video box's. Color from the course
// palette with a fallback to the platform's, the same as ClassroomLoading.
const skeletonWidths = ["w-full", "w-[92%]", "w-3/5"];

function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="mt-4 grid gap-2">
      {skeletonWidths.slice(0, count).map((width) => (
        <span
          key={width}
          className={`block h-3 ${width} rounded-sm bg-[var(--ma-line,var(--color-surface-strong))] motion-safe:animate-pulse`}
        />
      ))}
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
  const { t } = useTranslation();
  if (isLoading) {
    // A dash, not the "Loading lesson assets..." pill: it was identical to
    // "No files are attached" and added one more "Loading" on the screen.
    return <SkeletonLines count={1} />;
  }

  if (assets.length === 0) {
    return (
      <p className="mt-4 rounded-md bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink-soft)]">
        {t("learn.classroom.resources.emptyLesson")}
      </p>
    );
  }

  return (
    <div className="mt-5 grid gap-3">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {getCourseAssetTitle(asset)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                <FileText size={13} aria-hidden />
                <span>{getCourseAssetKindLabel(asset.kind, t)} - {formatCourseAssetSize(asset.size)}</span>
              </div>
              <MaterialAppHint fileName={asset.fileName} />
            </div>
            {/* "Preview" only applies to video (the sample lesson). The "Enrolled"
                    badge is gone: it applied to every attachment and said nothing. */}
            {asset.isPreview && isVideoAssetKind(asset.kind) ? (
              <span className="rounded-chip bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                {t("learn.classroom.resources.preview")}
              </span>
            ) : null}
          </div>

          <LessonAssetActions asset={asset} />
        </div>
      ))}
    </div>
  );
}
