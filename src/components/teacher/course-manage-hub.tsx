"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Circle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { CoverThumbnail } from "@/components/shared/cover-thumbnail";
import { ShortId } from "@/components/shared/short-id";
import { StatusChip } from "@/components/shared/status-chip";
import { BusyLabel } from "@/components/ui/busy-label";
import { DrawnCheck } from "@/components/ui/drawn-check";
import {
  CourseActionsMenu,
  DeleteOrArchiveCourseDialog,
} from "@/components/teacher/course-actions";
import {
  CouponsPanel,
  PanelCard,
  TaxPanel,
} from "@/components/teacher/course-commerce-panels";
import { BuilderSkeleton } from "@/components/teacher/builder-skeleton";
import { CourseShareLink } from "@/components/teacher/course-share-link";
import { SupportDetails } from "@/components/teacher/support-details";
import { CourseOffersPanel } from "@/components/teacher/course-offers-panel";
import { CourseOverviewPanel, StatCard } from "@/components/teacher/course-overview-panel";
import { ReadinessGroups } from "@/components/teacher/readiness-groups";
import { CourseStudentRoster } from "@/components/teacher/course-student-roster";
import { CourseLandingEditor } from "@/components/teacher/course-landing-editor";
import { SalesPageEditor } from "@/components/teacher/sales-page-editor";
import { useConfirm } from "@/components/teacher/use-confirm";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { PlanId } from "@/data/plans";
import { planById, refundWindowDays } from "@/data/plans";
import {
  effectiveLimit,
  formatLimit,
  lowestPlanWithQuota,
  quotaStatus,
} from "@/domain/entitlements";
import { usePublishGates } from "@/components/teacher/use-publish-gates";
import type { CourseAsset } from "@/domain/course-asset";
import {
  countLessonFiles,
  getCourseReadiness,
  getLessonIdsWithMedia,
  upcomingSessionsOf,
  type CourseReadinessItem,
} from "@/domain/course-readiness";
import {
  getCoursePricingShape,
  type CoursePricingShape,
} from "@/domain/product-pricing";
import type { TeacherCourse } from "@/domain/teacher-course";
import { teacherCanPublishCourse } from "@/domain/teacher-course";
import { useStorefrontPath } from "@/components/teacher/use-storefront-path";
import { countLabel } from "@/lib/i18n/count-label";
import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";
import {
  setOwnCourseFeatured,
  subscribeToTeacherCourse,
  subscribeToTeacherCourses,
} from "@/lib/data/teacher-courses";
import { fetchCourseAssets } from "@/lib/data/course-assets";
import { subscribeToTeacherCourseEvents } from "@/lib/data/course-events";

// Per-course management central (Hotmart-style "product hub"): one place with
// the publish checklist, the course's real settings, and the commerce surfaces.
// Sections that aren't built yet render as honest roadmap cards — never as
// fake-active features (platform "no fake data" rule).

type Translate = (key: string) => string;

// Hotmart product hub tab order (macro IA) — labels resolved at render so they
// follow the active locale. Tabs that mirror a sidebar entry reuse its key.
const manageSections = [
  { id: "overview", labelKey: "creatorPanel.hub.sections.overview" },
  { id: "links", labelKey: "creatorPanel.hub.sections.links" },
  { id: "basic", labelKey: "creatorPanel.hub.sections.basic" },
  { id: "pricing", labelKey: "creatorPanel.hub.sections.pricing" },
  { id: "members", labelKey: "creatorPanel.hub.sections.members" },
  { id: "students", labelKey: "creatorPanel.hub.sections.students" },
  { id: "page", labelKey: "creatorPanel.hub.sections.page" },
  { id: "content", labelKey: "creatorPanel.hub.sections.content" },
  { id: "coupons", labelKey: "platform.nav.coupons" },
  { id: "tax", labelKey: "creatorPanel.hub.sections.tax" },
  { id: "tools", labelKey: "creatorPanel.hub.sections.tools" },
  { id: "sales", labelKey: "platform.nav.sales" },
] as const;

const roadmapSections = [
  {
    id: "assistant",
    labelKey: "creatorPanel.hub.roadmap.assistantLabel",
    titleKey: "creatorPanel.hub.roadmap.assistantTitle",
    descriptionKey: "creatorPanel.hub.roadmap.assistantDescription",
  },
] as const;

type SectionId = (typeof manageSections)[number]["id"] | (typeof roadmapSections)[number]["id"];

const hubMenuItemClass =
  "flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]";

// Each checklist row only DESCRIBED the pending item ("Add at least one module")
// and led nowhere: the person read what was missing and had to hunt for
// where to fix it. Here lives the destination of each row, always the screen that EDITS the
// field. The "basic" and "pricing" cards of the hub itself are read-only — their button
// already sends to the builder —, so we point straight there and
// save one click. `outcomes` is the exception because the hub has a real
// editor (SalesPageEditor, in the "page" section), and there the person never leaves the hub.
function readinessEditHref(item: CourseReadinessItem, courseId: string): string | null {
  const id = encodeURIComponent(courseId);
  switch (item.id) {
    case "title":
    case "summary":
    case "category":
    case "cover":
      return `/teach/builder?courseId=${id}&tab=details`;
    case "module":
    case "lesson":
      return `/teach/builder?courseId=${id}&tab=content`;
    case "pricing":
    case "installments":
      return `/teach/builder?courseId=${id}&tab=pricing`;
    case "outcomes":
      return `/teach/courses/${id}/manage?section=page`;
    case "payouts":
      return "/account/payments#stripe-connect";
    case "activation":
      return `/teach/activate?courseId=${id}`;
    case "plan":
      return "/account/billing";
    // `verification` already has its own link inside the hint; a second link on the
    // same row, with another label and the same destination, only confuses.
    default:
      return null;
  }
}

// How the course charges comes ENTIRELY from `getCoursePricingShape` (domain). Reading the
// price one way here and the raw `paymentType` right there was what made the same
// screen say "Free" and "Monthly subscription" about the same draft.
function priceLabel(pricing: CoursePricingShape, t: Translate): string {
  if (pricing.free) {
    return t("publicCourses.free");
  }
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: pricing.currency,
  }).format(pricing.amountMinor / 100);
  if (pricing.paymentType === "subscription_monthly") {
    return t("creatorPanel.hub.price.perMonth").replace("{amount}", () => amount);
  }
  if (pricing.paymentType === "subscription_yearly") {
    return t("creatorPanel.hub.price.perYear").replace("{amount}", () => amount);
  }
  return amount;
}

// Plural pairs live in the dictionary; the number is data, never translated.
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b fine-rule py-3 last:border-b-0">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
        {label}
      </span>
      <span className="min-w-0 text-sm leading-6 text-[var(--color-ink)]">{value}</span>
    </div>
  );
}

const allSectionIds = new Set<string>([
  ...manageSections.map((s) => s.id),
  ...roadmapSections.map((s) => s.id),
]);

// supabase-js returns the rpc error as an object (not always an Error): the text
// comes from `message` in either case.
function serverMessage(cause: unknown): string {
  const message = (cause as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message.trim() : "";
}

// The database's refusal (set_own_course_featured) is in developer English.
// Each known refusal becomes the house sentence that keeps what to do; the rest,
// "reload and try again": if the button was on, the screen was stale.
function highlightRefusalKey(detail: string): string {
  const text = detail.toLowerCase();
  const reason = text.includes("sign in")
    ? "signIn"
    : text.includes("only a published course")
      ? "notPublished"
      : text.includes("not included in your current plan")
        ? "plan"
        : /using all .* highlights/.test(text)
          ? "quota"
          : "other";
  return `creatorPanel.hub.highlight.refused.${reason}`;
}

/**
 * Self-serve marketplace highlight, metered by the teacher's plan.
 *
 * `used` is counted from the courses the hub already streams instead of a
 * second round-trip, and `featured` is read straight off the realtime course
 * row — so after the RPC lands, the subscription repaints this card. The
 * numbers here are the *display*; `set_own_course_featured` is what actually
 * enforces the quota. When it refuses, the screen shows the house sentence with what to
 * do (see highlightRefusalKey); the raw database text stays collapsed in
 * "Details for support".
 */
function MarketplaceHighlightPanel({
  course,
  planId,
  usedSlots,
}: {
  course: TeacherCourse;
  planId: PlanId;
  usedSlots: number;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  // Dictionary key (follows the language switch with the card open) and the
  // raw server text, which only goes to "Details for support".
  const [error, setError] = useState<{ key: string; detail: string } | null>(null);

  const featured = course.featured === true;
  const limit = effectiveLimit(planId, "featuredSlots");
  const quota = quotaStatus(usedSlots, limit);
  const published = course.status === "published";
  const upgradeTo = lowestPlanWithQuota("featuredSlots", 1);
  // Used up: a bigger plan on offer if one covers the next slot, otherwise a
  // person. Above the top tier the answer is "Contact us", never a dead end.
  const outOfQuota = published && !quota.lockedOnPlan && !quota.canConsume;
  const contactInstead =
    outOfQuota && lowestPlanWithQuota("featuredSlots", quota.used + 1) === null;

  // Removing a highlight is always allowed, including over quota after a
  // downgrade — same rule the RPC applies, so the button matches the server.
  const canToggle = published && (featured || quota.canConsume);

  const gateReason = !published
    ? t("creatorPanel.hub.highlight.gatePublish")
    : quota.lockedOnPlan
      ? t("creatorPanel.hub.highlight.gatePlan").replace("{plan}", () =>
          upgradeTo ? planById(upgradeTo).name : t("creatorPanel.hub.highlight.paidPlan")
        )
      : !quota.canConsume
        ? t("creatorPanel.hub.highlight.gateQuota").replace("{limit}", () => formatLimit(limit))
        : "";

  const handleToggle = async () => {
    setSaving(true);
    setError(null);
    try {
      await setOwnCourseFeatured(course.id, !featured);
    } catch (toggleError) {
      const detail = serverMessage(toggleError);
      setError({ key: highlightRefusalKey(detail), detail });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelCard
      title={t("creatorPanel.hub.highlight.title")}
      description={t("creatorPanel.hub.highlight.description")}
    >
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border fine-rule bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {featured ? t("creatorPanel.hub.highlight.on") : t("creatorPanel.hub.highlight.off")}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {(quota.lockedOnPlan
              ? t(planId === "free" ? "creatorPanel.hub.highlight.noSubscription" : "creatorPanel.hub.highlight.notIncluded")
              : t("creatorPanel.hub.highlight.usage"))
              .replace("{used}", () => String(quota.used))
              .replace("{limit}", () => formatLimit(limit))
              .replace("{plan}", () => planById(planId).name)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleToggle()}
          disabled={saving || !canToggle}
          className={`${featured ? "button-outline" : "button-solid"} px-4 py-2 text-xs disabled:cursor-not-allowed`}
        >
          <BusyLabel
            busy={saving}
            idle={featured ? t("creatorPanel.hub.highlight.remove") : t("creatorPanel.hub.highlight.add")}
            busyText={t("creatorPanel.hub.highlight.saving")}
          />
        </button>
      </div>
      {gateReason ? (
        <p className="mt-3 text-xs leading-5 text-[var(--color-ink-muted)]">
          {gateReason}
          {quota.lockedOnPlan || (outOfQuota && !contactInstead) ? (
            <>
              {" "}
              <Link href="/account/plans" className="font-semibold text-[var(--color-primary)] underline">
                {t("creatorPanel.hub.highlight.seePlans")}
              </Link>
            </>
          ) : contactInstead ? (
            <>
              {" "}
              <Link href="/contact" className="font-semibold text-[var(--color-primary)] underline">
                {t("creatorPanel.hub.highlight.contactUs")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <>
          <InlineAlert tone="error" className="mt-3" title={t("creatorPanel.hub.highlight.updateError")}>
            {t(error.key)}
          </InlineAlert>
          {error.detail ? (
            <SupportDetails className="mt-1">
              <p className="select-all">{error.detail}</p>
            </SupportDetails>
          ) : null}
        </>
      ) : null}
    </PanelCard>
  );
}

export function CourseManageHub({ courseId }: { courseId: string }) {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-link from studio checklist (?section=pricing) — read during render
  // (no setState-in-effect) so eslint react-hooks/set-state-in-effect stays clean.
  const sectionFromUrl = (() => {
    const raw = searchParams?.get("section") ?? "";
    return raw && allSectionIds.has(raw) ? (raw as SectionId) : null;
  })();
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  // /@user when the public profile has an @ (it is the link that goes in the bio).
  const storefrontPath = useStorefrontPath(course?.ownerId ?? "");
  // Which courseId the subscription has answered for — derives the loading
  // state without a synchronous setState reset when the route param changes.
  const [loadedCourseId, setLoadedCourseId] = useState<string | null>(null);
  const [myCourses, setMyCourses] = useState<TeacherCourse[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { account, planId } = usePublishGates(user);
  const section: SectionId = sectionFromUrl ?? "overview";
  const setSection = (next: SectionId) => {
    const params = new URLSearchParams(searchParams?.toString());
    if (next === "overview") {
      params.delete("section");
    } else {
      params.set("section", next);
    }
    const query = params.toString();
    router.push(
      `/teach/courses/${encodeURIComponent(courseId)}/manage${query ? `?${query}` : ""}`,
      { scroll: false }
    );
  };
  const menuRef = useRef<HTMLElement>(null);
  const activeSectionRef = useRef<HTMLButtonElement>(null);
  const sectionRowRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ previous: false, next: false });
  const updateScrollEdges = useCallback(() => {
    const row = sectionRowRef.current;
    if (!row) return;
    const previous = row.scrollLeft > 1;
    const next = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setScrollEdges((current) => current.previous === previous && current.next === next
      ? current : { previous, next });
  }, []);

  useEffect(() => {
    return subscribeToTeacherCourse(
      courseId,
      (nextCourse) => {
        setCourse(nextCourse);
        setLoadedCourseId(courseId);
      },
      () => {
        // A failed load after a course switch must not leave the previous
        // course rendering under this courseId's URL.
        setCourse((current) => (current && current.id !== courseId ? null : current));
        setLoadedCourseId(courseId);
      }
    );
  }, [courseId]);

  const courseLoaded = loadedCourseId === courseId;

  // Manage › Page: the sales text and the page have their own Save, and leaving with
  // "Unsaved changes" lost what was typed without a word. The warning applies
  // to closing or reloading the tab and to the navigation THIS panel controls
  // (its sections and links). The sidebar is not its own and goes straight through.
  const [salesDirty, setSalesDirty] = useState(false);
  const [landingDirty, setLandingDirty] = useState(false);
  const pageDirty = section === "page" && (salesDirty || landingDirty);
  const { ask, dialog: leaveDialog } = useConfirm();
  useEffect(() => {
    if (!pageDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pageDirty]);
  const leavePage = (go: () => void) => {
    if (!pageDirty) {
      go();
      return;
    }
    ask({
      title: t("creatorEditor.builder.confirm.leaveTitle"),
      body: t("creatorEditor.builder.confirm.leave"),
      confirmLabel: t("creatorEditor.builder.confirm.leaveAction"),
      cancelLabel: t("creatorEditor.builder.confirm.stay"),
      danger: true,
      run: go,
    });
  };
  // Panel links (back to the builder, "Edit in Builder", course menu):
  // the capture holds the click before Next's Link and, once confirmed, navigates.
  // A new tab and a modified click do not unmount anything and go straight through.
  const guardPageLinks = (event: ReactMouseEvent<HTMLElement>) => {
    if (!pageDirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== "_self")) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    event.preventDefault();
    leavePage(() => router.push(destination.pathname + destination.search + destination.hash));
  };

  useEffect(() => {
    const menu = menuRef.current;
    const viewport = menu?.closest<HTMLElement>(".platform-content");
    if (!menu || !viewport) return;

    const updateLayout = () => {
      updateScrollEdges();
      const active = activeSectionRef.current;
      const row = active?.parentElement;
      if (!active || !row) return;
      const buttonBounds = active.getBoundingClientRect();
      if (!buttonBounds.width || !buttonBounds.height) return;
      // Reveal URL-selected sections inside the menu only. scrollIntoView can
      // also move the platform page and hide its course or platform header.
      const rowBounds = row.getBoundingClientRect();
      if (buttonBounds.left < rowBounds.left) {
        row.scrollLeft += buttonBounds.left - rowBounds.left;
      } else if (buttonBounds.right > rowBounds.right) {
        row.scrollLeft += buttonBounds.right - rowBounds.right;
      }
      updateScrollEdges();
    };
    updateLayout();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateLayout);
    observer?.observe(viewport);
    if (sectionRowRef.current) observer?.observe(sectionRowRef.current);
    const courseHeader = menu.parentElement?.previousElementSibling;
    if (courseHeader) observer?.observe(courseHeader);
    return () => observer?.disconnect();
  }, [courseLoaded, course?.id, section, locale, updateScrollEdges]);

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeToTeacherCourses(user.uid, setMyCourses, () => undefined);
  }, [user]);

  // What the kind delivers, as the builder reads it: the live event's upcoming session and
  // the e-book file. Without them the percentage here reached 100%
  // with the builder saying "not ready". A list that does not arrive leaves the
  // item out, as in the builder; the server keeps charging.
  const productFormat = course?.productFormat ?? "course";
  const ownerUid = user?.uid;
  const [sessionCount, setSessionCount] = useState<{ courseId: string; count: number } | null>(null);
  useEffect(() => {
    if (!ownerUid || productFormat !== "live_event") {
      return;
    }
    return subscribeToTeacherCourseEvents(
      ownerUid,
      (events) => setSessionCount({ courseId, count: upcomingSessionsOf(events, courseId, Date.now()).length }),
      () => {},
    );
  }, [ownerUid, courseId, productFormat]);
  // The file list, as the builder reads it: the e-book file and the
  // "content in every lesson". Without it Manage dropped that item and showed
  // a different percentage for the same course. Read again on every snapshot of the
  // course, as the e-book one was.
  const courseModules = course?.modules;
  const [courseAssets, setCourseAssets] = useState<{ courseId: string; list: CourseAsset[] } | null>(null);
  // The list's failure was swallowed, and Manage went on with a different percentage.
  // Now the count waits ("—%") and the failure gets "Try again" (B-15).
  const [assetsFailedFor, setAssetsFailedFor] = useState<string | null>(null);
  const readinessLineRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!courseModules) {
      return;
    }
    let cancelled = false;
    fetchCourseAssets(courseId)
      .then((list) => {
        if (!cancelled) setCourseAssets({ courseId, list });
      })
      .catch(() => {
        if (!cancelled) setAssetsFailedFor(courseId);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, courseModules]);
  const retryCourseAssets = () =>
    fetchCourseAssets(courseId).then(
      (list) => setCourseAssets({ courseId, list }),
      () => setAssetsFailedFor(courseId),
    );

  const isOwner = Boolean(course && user && course.ownerId === user.uid);
  // Server-enforced by the commerce RPCs; surfaced here so the panels can
  // explain the gate instead of failing on click.
  const activationBlocked = account.verificationRequired && !account.verificationApproved;

  if (!courseLoaded) {
    // Same as the route fallback (F-03): blocks in place of the header, the
    // row and the panel, and a single sentence for the screen reader.
    return <BuilderSkeleton label={t("teacherRouteResidual.manageLoading")} />;
  }

  // ProtectedSurface guarantees a signed-in user here, so a null user is
  // treated the same as a non-owner instead of bypassing the guard.
  if (!course || !user || !isOwner) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {t("creatorPanel.hub.notFound.title")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("creatorPanel.hub.notFound.description")}
        </p>
        <Link href="/teach/builder" className="button-outline mt-4 inline-flex px-4 py-2 text-xs">
          {t("creatorPanel.hub.notFound.back")}
        </Link>
      </section>
    );
  }

  // The same list as the builder, with the same entries: the file list
  // decides "content in every lesson" (lessonMedia) and the e-book file, by the
  // same rule as the panel's "lessons without content" warning. Before, Manage dropped
  // lessonMedia and the percentage could differ from the builder's.
  const assets = courseAssets?.courseId === course.id ? courseAssets.list : null;
  const readiness = getCourseReadiness(
    {
      ...course,
      lessonIdsWithMedia: assets ? getLessonIdsWithMedia(course.modules, assets) : undefined,
      scheduledSessionCount:
        productFormat === "live_event" && sessionCount?.courseId === course.id ? sessionCount.count : undefined,
      lessonFileCount:
        productFormat === "ebook" && assets ? countLessonFiles(course.modules, assets) : undefined,
    },
    account,
    t,
  );
  // The "6 of 8 required steps done · 75% ready" line is the bar's name.
  const readinessText = t("creatorPanel.hub.checklist.progress")
    .replace("{done}", () => String(readiness.doneCount))
    .replace("{total}", () => String(readiness.total))
    .replace("{percent}", () => String(readiness.percent));
  // With a lesson in the course, the count depends on the file list: without it the number
  // would differ from the builder's. Until it arrives, "—%" and no bar.
  const readinessPending = !assets && course.modules.some((courseModule) => courseModule.lessons.length > 0);
  const assetsFailed = readinessPending && assetsFailedFor === course.id;
  const pricing = getCoursePricingShape(course);
  // "Add the yearly plan" in the price step arrives with ?addPrice=yearly&amount=
  // (in cents): the other-price form already opens with the yearly plan.
  const yearlyPrefillMinor = searchParams?.get("addPrice") === "yearly"
    ? Number(searchParams.get("amount"))
    : Number.NaN;
  const yearlyPrefill = Number.isInteger(yearlyPrefillMinor) && yearlyPrefillMinor > 0
    ? { paymentType: "subscription_yearly" as const, amountMinor: yearlyPrefillMinor }
    : null;
  const paid = !pricing.free;
  const published = course.status === "published";
  const switchableCourses = myCourses.filter((candidate) => candidate.id !== course.id);
  // This course's own flag comes from the single-course subscription, the rest
  // from the owner-wide one. Mixing them keeps the count from flickering while
  // the two subscriptions land the same toggle a beat apart.
  const featuredSlotsUsed =
    switchableCourses.filter((candidate) => candidate.featured).length + (course.featured ? 1 : 0);
  // What travels with a promo link when the creator shares it; an untitled
  // draft still needs a readable line in the WhatsApp message.
  const courseTitle = course.title || t("creatorPanel.hub.header.courseFallback");
  const modulesLabel = countLabel(
    t,
    "creatorPanel.modulesOne",
    "creatorPanel.modulesMany",
    course.modules.length
  );
  const lessonsLabel = countLabel(
    t,
    "publicCourses.lessonOne",
    "publicCourses.lessonMany",
    course.lessonCount
  );

  return (
    <div className="grid gap-5" onClickCapture={guardPageLinks}>
      {leaveDialog}
      <section className="border-b border-[var(--color-line)] bg-white pb-5">
        <Link
          href="/teach/builder"
          className="mb-4 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"
        >
          <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.9} />
          {t("platform.nav.courseBuilder")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md border fine-rule bg-[var(--color-surface-soft)]">
              {course.coverImageUrl ? (
                <CoverThumbnail
                  src={course.coverImageUrl}
                  alt={t("creatorPanel.hub.header.coverAlt").replace(
                    "{title}",
                    () => course.title || t("creatorPanel.hub.header.courseFallback")
                  )}
                  sizes="112px"
                  eager
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                  {t("creatorPanel.hub.header.noCover")}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {t("creatorPanel.hub.header.eyebrow")}
              </p>
              <h1 className="mt-1 truncate text-xl font-semibold text-[var(--color-ink)]">
                {course.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusChip status={course.status} />
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                  {modulesLabel} - {lessonsLabel} - {priceLabel(pricing, t)}
                </span>
              </div>
              <div className="mt-2">
                <ShortId id={course.id} label={t("shortId.product")} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {switchableCourses.length > 0 ? (
              <select
                aria-label={t("creatorPanel.hub.header.switchCourse")}
                value={course.id}
                onChange={(event) => {
                  const next = event.target.value;
                  leavePage(() => router.push(`/teach/courses/${next}/manage`));
                }}
                // Up to the row width: a long title does not go past the 375px screen.
                className="field-input field-input--inline max-w-full"
              >
                <option value={course.id}>{course.title}</option>
                {switchableCourses.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
              </select>
            ) : null}
            <Link
              href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=details`}
              className="button-solid px-4 text-xs"
            >
              {t("creatorPanel.hub.editInBuilder")}
            </Link>
            {/* Same position as Hotmart: the caret beside the product selector.
                It is the teacher's only way to take the course offline — before,
                only the admin could, through /ops. */}
            <CourseActionsMenu courseTitle={courseTitle} icon={ChevronDown}>
              <Link
                href="/teach/builder?newCourse=1&format=course"
                role="menuitem"
                className={hubMenuItemClass}
              >
                {t("creatorPanel.hub.header.newProduct")}
              </Link>
              <Link
                href={`/teach/builder/${encodeURIComponent(course.id)}/preview`}
                role="menuitem"
                className={hubMenuItemClass}
              >
                {t("creatorPanel.hub.header.previewAsStudent")}
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirmingDelete(true)}
                className="flex min-h-11 w-full items-center rounded-md border-t border-[var(--color-line)] px-3 text-left text-sm font-semibold text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-soft)]"
              >
                {t("creatorPanel.hub.header.deleteCourse")}
              </button>
            </CourseActionsMenu>
          </div>
        </div>
        {course.status === "inactive" ? (
          // Archiving without saying what to do next leaves the teacher thinking they
          // lost the course. The chip says the state; this line says the way out.
          // Without its own flex: it gets the warning icon, and the link follows the sentence.
          <InlineAlert tone="warning" className="mt-4">
            {t("creatorPanel.hub.header.archivedNotice")}{" "}
            <Link
              href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=review`}
              className="underline underline-offset-2"
            >
              {t("creatorPanel.hub.header.publishAgain")}
            </Link>
          </InlineAlert>
        ) : null}
      </section>

      {confirmingDelete ? (
        <DeleteOrArchiveCourseDialog
          courseId={course.id}
          courseTitle={courseTitle}
          onCancel={() => setConfirmingDelete(false)}
          onDone={(result) => {
            setConfirmingDelete(false);
            // Deleted, this hub no longer exists: the realtime subscription
            // would return "course not found" in place of the screen. Archived,
            // it brings the new status itself and the chip switches on its own.
            if (result.outcome === "deleted") {
              router.push("/teach/builder");
            }
          }}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[240px_1fr] lg:items-start">
        <nav
          ref={menuRef}
          aria-label={t("creatorPanel.hub.nav.label")}
          className="relative min-w-0 border-b border-[var(--color-line)] bg-white pb-2 lg:rounded-md lg:border lg:p-2"
        >
          <p className="hidden px-2 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)] lg:block">
            {t("creatorPanel.hub.nav.manage")}
          </p>
          {([
            ["previous", ChevronLeft, -1],
            ["next", ChevronRight, 1],
          ] as const).map(([direction, Icon, sign]) => (
            <button
              key={direction}
              type="button"
              aria-label={t(`creatorPanel.hub.nav.${direction}`)}
              title={t(`creatorPanel.hub.nav.${direction}`)}
              disabled={!scrollEdges[direction]}
              onClick={() => {
                const row = sectionRowRef.current;
                if (row) row.scrollBy({ left: sign * row.clientWidth, behavior: "auto" });
              }}
              className={`absolute top-0 flex h-11 w-11 items-center justify-center text-[var(--color-primary)] disabled:opacity-60 lg:hidden ${direction === "previous" ? "left-0" : "right-0"}`}
            >
              <Icon size={18} aria-hidden="true" />
            </button>
          ))}
          <div ref={sectionRowRef} onScroll={updateScrollEdges} className="mx-11 flex gap-1 overflow-x-auto lg:mx-0 lg:grid">
            {manageSections.map((item) => (
              <button
                key={item.id}
                ref={section === item.id ? activeSectionRef : undefined}
                // The open section was only color: the screen reader did not know where it was.
                aria-current={section === item.id ? "page" : undefined}
                type="button"
                onClick={() => (item.id === section ? undefined : leavePage(() => setSection(item.id)))}
                className={`min-h-11 shrink-0 whitespace-nowrap rounded-md border-b-2 px-3 py-2 text-left text-sm font-semibold transition lg:w-full lg:border-b-0 lg:border-l-2 ${
                  section === item.id
                    ? "border-[var(--color-primary)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]"
                    : "border-transparent text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-hover)]"
                }`}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          <p className="hidden px-2 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)] lg:block">
            {t("creatorPanel.hub.nav.roadmap")}
          </p>
          <div className="hidden gap-1 lg:grid">
            {roadmapSections.map((item) => (
              <button
                key={item.id}
                ref={section === item.id ? activeSectionRef : undefined}
                aria-current={section === item.id ? "page" : undefined}
                type="button"
                onClick={() => (item.id === section ? undefined : leavePage(() => setSection(item.id)))}
                className={`rounded-md px-3 py-2 text-left text-sm font-semibold transition ${
                  section === item.id
                    ? "bg-[var(--color-surface-soft)] text-[var(--color-primary)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)]"
                }`}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        </nav>

        <div className="grid gap-4">
          {/* The order depends on the product's state. PUBLISHED: the panel comes
              first, because whoever opens this screen opens it to know how the
              product is doing. NOT YET PUBLISHED: the numbers are all
              empty ("nobody bought yet", "no activity") and the
              teacher had to scroll past three empty boxes to find out what
              is missing to publish — so the checklist goes up and the panel goes down. */}
          {section === "overview" && published ? (
            <CourseOverviewPanel course={course} />
          ) : null}

          {section === "overview" ? (
            <PanelCard
              title={t("creatorPanel.hub.checklist.title")}
              description={t(`creatorPanel.hub.status.${course.status}`)}
            >
              {/* The same bar as the builder (the shared one): the two screens
                  drew the same readiness in different ways. */}
              {readinessPending ? (
                // The empty track holds the bar's place: nothing jumps when the
                // count arrives, and no false number is announced.
                <div aria-hidden="true" className="mt-4 h-1.5 rounded-full bg-[var(--color-line)]" />
              ) : (
                <ProgressBar value={readiness.percent} label={readinessText} className="mt-4" />
              )}
              {/* aria-hidden: the bar above already says this sentence (it is its name).
                  While waiting, there is no bar: the sentence stays for the screen reader. */}
              <p
                ref={readinessLineRef}
                tabIndex={-1}
                aria-hidden={readinessPending ? undefined : "true"}
                className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]"
              >
                {readinessPending ? t("creatorPanel.hub.checklist.progressPending") : readinessText}
              </p>
              {assetsFailed ? (
                <LoadErrorAlert className="mt-3" focusRef={readinessLineRef} onRetry={retryCourseAssets}>
                  {t("creatorPanel.hub.checklist.assetsError")}
                </LoadErrorAlert>
              ) : null}
              <ReadinessGroups
                readiness={readiness}
                className="mt-4 grid gap-5"
                renderItem={(item) => {
                  const editHref = readinessEditHref(item, course.id);
                  return (
                    // The same row as the builder: done = a drawn check in
                    // green (with "Done" for the screen reader), pending =
                    // empty circle. It used to be a typed "✓" in a blue dot.
                    <li
                      key={item.id}
                      data-readiness-item={item.id}
                      className="flex items-start gap-3 rounded-md border border-[var(--color-line)] bg-white px-4 py-3"
                    >
                      {item.done ? (
                        <span className="mt-0.5 text-[var(--color-success-fg)]">
                          <DrawnCheck size={15} />
                          <span className="sr-only">{t("creatorEditor.lesson.state.done")}: </span>
                        </span>
                      ) : (
                        <Circle aria-hidden="true" size={13} strokeWidth={1.8} className="mt-1 shrink-0 text-[var(--color-ink-muted)]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold ${item.done ? "text-[var(--color-success-fg)]" : "text-[var(--color-ink)]"}`}>
                          {item.label}
                          {item.optional ? (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                              {t("creatorPanel.hub.checklist.optional")}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                          {item.hint}
                          {item.id === "verification" ? (
                            <>
                              {" "}
                              <Link
                                href="/teach/verification"
                                className="font-semibold text-[var(--color-primary)] underline"
                              >
                                {t("creatorPanel.hub.checklist.openVerification")}
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </div>
                      {editHref ? (
                        // Short visible label, full accessible name: there are
                        // up to eleven "Edit" links in the same list and a screen
                        // reader needs to know which is which.
                        <Link
                          href={editHref}
                          aria-label={t("creatorPanel.hub.checklist.editItem").replace(
                            "{item}",
                            () => item.label,
                          )}
                          className="shrink-0 text-xs font-semibold text-[var(--color-primary)] underline"
                        >
                          {t("creatorPanel.hub.checklist.edit")}
                        </Link>
                      ) : null}
                    </li>
                  );
                }}
              />
              {course.reviewNote ? (
                <div className="mt-4 rounded-md border border-[rgba(178,34,52,0.18)] bg-white px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
                    {t("creatorPanel.hub.checklist.reviewNote")}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                    {course.reviewNote}
                  </p>
                </div>
              ) : null}
              {teacherCanPublishCourse(course.status) ? (
                <Link
                  href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=review`}
                  className="button-solid mt-5 inline-flex px-5 py-2.5 text-xs"
                >
                  {t("creatorPanel.hub.checklist.reviewPublish")}
                </Link>
              ) : null}
            </PanelCard>
          ) : null}

          {section === "overview" && !published ? (
            <CourseOverviewPanel course={course} />
          ) : null}

          {section === "overview" ? (
            <MarketplaceHighlightPanel
              course={course}
              planId={planId}
              usedSlots={featuredSlotsUsed}
            />
          ) : null}

          {section === "links" ? (
            <PanelCard
              title={t("creatorPanel.hub.sections.links")}
              description={
                course.status === "published"
                  ? t("creatorPanel.hub.links.descriptionLive")
                  : t("creatorPanel.hub.links.descriptionDraft")
              }
            >
              <CourseShareLink
                label={t("creatorPanel.hub.links.checkout")}
                path={`/courses/${encodeURIComponent(courseId)}/checkout`}
                title={courseTitle}
                entry="pay"
              />
              <CourseShareLink
                label={t("creatorPanel.hub.sections.page")}
                path={`/courses/${encodeURIComponent(courseId)}`}
                title={courseTitle}
              />
              {/* The creator's storefront is the third sales door: it goes out on the same
                  public base as the product page, with the same trio of buttons. */}
              <CourseShareLink
                label={t("creatorPanel.hub.links.storefront")}
                path={storefrontPath}
                title={courseTitle}
              />
            </PanelCard>
          ) : null}

          {section === "basic" ? (
            <PanelCard
              title={t("creatorPanel.hub.sections.basic")}
              description={t("creatorPanel.hub.basic.description")}
            >
              <div className="mt-4">
                <DetailRow label={t("creatorPanel.hub.basic.title")} value={course.title} />
                <DetailRow
                  label={t("creatorPanel.hub.basic.category")}
                  value={getCourseCategoryLabel(course.category, t)}
                />
                {course.categories && course.categories.length > 1 ? (
                  <DetailRow
                    label={t("creatorPanel.hub.basic.allCategories")}
                    value={course.categories
                      .map((category) => getCourseCategoryLabel(category, t))
                      .join(", ")}
                  />
                ) : null}
                <DetailRow label={t("creatorPanel.hub.basic.summary")} value={course.summary || "—"} />
                <DetailRow
                  label={t("creatorPanel.hub.basic.outcomes")}
                  value={
                    course.learningOutcomes?.length ? (
                      <ul className="list-disc pl-4">
                        {course.learningOutcomes.map((outcome) => (
                          <li key={outcome}>{outcome}</li>
                        ))}
                      </ul>
                    ) : (
                      t("creatorPanel.hub.basic.noneYet")
                    )
                  }
                />
                <DetailRow
                  label={t("creatorPanel.hub.basic.cover")}
                  value={
                    course.coverImageUrl
                      ? t("creatorPanel.hub.basic.uploaded")
                      : t("creatorPanel.hub.basic.missing")
                  }
                />
              </div>
              <Link
                href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=details`}
                className="button-outline mt-5 inline-flex px-4 py-2 text-xs"
              >
                {t("creatorPanel.hub.basic.edit")}
              </Link>
            </PanelCard>
          ) : null}

          {section === "pricing" ? (
            <div className="grid gap-8">
              <section aria-labelledby="course-pricing-title">
                <h2 id="course-pricing-title" className="text-xl font-semibold text-[var(--color-ink)]">
                  {t("creatorPanel.hub.pricing.title")}
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    compact
                    label={t("creatorPanel.hub.pricing.price")}
                    value={priceLabel(pricing, t)}
                    hint={t("creatorPanel.hub.pricing.installmentsHint").replace("{value}", () =>
                      pricing.free
                        ? t("creatorPanel.hub.pricing.notApplicable")
                        : pricing.installmentsMax
                          ? t("creatorPanel.hub.pricing.installmentsUpTo").replace("{max}", () =>
                              String(pricing.installmentsMax)
                            )
                          : t("creatorPanel.disabled")
                    )}
                  />
                  <StatCard
                    compact
                    label={t("creatorPanel.hub.pricing.paymentType")}
                    value={
                      pricing.paymentType
                        ? t(`creatorPanel.paymentType.${pricing.paymentType}`)
                        : t("creatorPanel.hub.pricing.notApplicable")
                    }
                    hint={
                      pricing.paymentType
                        ? t("creatorPanel.hub.pricing.paymentTypeHint")
                        : t("creatorPanel.hub.pricing.paymentTypeFreeHint")
                    }
                  />
                  <StatCard
                    compact
                    label={t("creatorPanel.hub.pricing.refundWindow")}
                    value={t("creatorPanel.hub.pricing.refundWindowDays").replace("{days}", () =>
                      String(refundWindowDays)
                    )}
                    hint={t("creatorPanel.hub.pricing.refundWindowHint")}
                  />
                  <StatCard
                    compact
                    label={t("creatorPanel.hub.links.checkout")}
                    value={t("creatorPanel.hub.pricing.stripeCheckout")}
                    hint={
                      paid
                        ? `${t("creatorPanel.hub.pricing.payouts")}: ${
                            account.payoutsReady
                              ? t("creatorPanel.hub.pricing.payoutsReady")
                              : t("creatorPanel.hub.pricing.payoutsIncomplete")
                          }`
                        : t("creatorPanel.hub.pricing.payoutsFreeHint")
                    }
                  />
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=pricing`}
                    className="button-outline px-4 py-2 text-xs"
                  >
                    {t("creatorPanel.hub.pricing.edit")}
                  </Link>
                  {paid && !account.payoutsReady ? (
                    <Link
                      href="/account/payments#stripe-connect"
                      className="button-solid px-4 py-2 text-xs"
                    >
                      {t("creatorPanel.hub.pricing.finishOnboarding")}
                    </Link>
                  ) : null}
                </div>
              </section>
              <CourseOffersPanel
                courseId={course.id}
                courseTitle={courseTitle}
                coursePricing={pricing}
                prefill={yearlyPrefill}
              />
            </div>
          ) : null}

          {section === "content" ? (
            <PanelCard
              title={t("creatorPanel.hub.sections.content")}
              description={t("creatorPanel.hub.content.description")
                .replace("{modules}", () => modulesLabel)
                .replace("{lessons}", () => lessonsLabel)}
            >
              {course.modules.length ? (
                <ol className="mt-4 grid gap-2">
                  {course.modules.map((courseModule, index) => (
                    <li
                      key={courseModule.id}
                      className="rounded-md border fine-rule bg-white px-4 py-3"
                    >
                      <p className="text-sm font-semibold text-[var(--color-ink)]">
                        {index + 1}. {courseModule.title}
                      </p>
                      <p className="text-xs text-[var(--color-ink-muted)]">
                        {countLabel(
                          t,
                          "publicCourses.lessonOne",
                          "publicCourses.lessonMany",
                          courseModule.lessons.length
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
                  {t("creatorPanel.hub.content.empty")}
                </p>
              )}
              <Link
                href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=content`}
                className="button-outline mt-5 inline-flex px-4 py-2 text-xs"
              >
                {t("creatorPanel.hub.content.edit")}
              </Link>
            </PanelCard>
          ) : null}

          {section === "members" ? (
            <PanelCard
              title={t("creatorPanel.hub.sections.members")}
              description={t("creatorPanel.hub.members.description")}
            >
              <div className="mt-4">
                <DetailRow
                  label={t("creatorPanel.hub.members.theme")}
                  value={
                    course.membersTheme === "dark"
                      ? t("creatorPanel.hub.members.themeDark")
                      : t("creatorPanel.hub.members.themeLight")
                  }
                />
                <DetailRow
                  label={t("creatorPanel.hub.members.welcomeTitle")}
                  value={course.membersTitle || t("creatorPanel.hub.members.default")}
                />
                <DetailRow
                  label={t("creatorPanel.hub.members.subtitle")}
                  value={course.membersSubtitle || t("creatorPanel.hub.members.default")}
                />
                <DetailRow
                  label={t("creatorPanel.hub.members.community")}
                  value={
                    course.communityEnabled ? t("creatorPanel.enabled") : t("creatorPanel.disabled")
                  }
                />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href={`/teach/builder/${course.id}/preview`}
                  className="button-solid px-4 py-2 text-xs"
                >
                  {t("creatorPanel.hub.members.preview")}
                </Link>
                <Link
                  href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=members`}
                  className="button-outline px-4 py-2 text-xs"
                >
                  {t("creatorPanel.hub.editInBuilder")}
                </Link>
              </div>
            </PanelCard>
          ) : null}

          {section === "students" ? (
            <CourseStudentRoster
              courseId={course.id}
              share={course.status === "published" ? { title: course.title } : undefined}
            />
          ) : null}

          {section === "page" ? (
            <div className="grid gap-4">
              <SalesPageEditor course={course} onDirtyChange={setSalesDirty} />
              {/* The block editor sits below the title/summary form rather than
                  replacing it: those fields also feed the marketplace card and
                  the course header, so they are not page-only copy. */}
              <CourseLandingEditor course={course} onDirtyChange={setLandingDirty} />
              <PanelCard
                title={t("creatorPanel.hub.page.title")}
                description={t("creatorPanel.hub.page.description")}
              >
                {/* One filled button per section: here it is the block editor's "Save page".
                    Opening the page is a secondary action. */}
                <Link
                  href={`/courses/${course.id}`}
                  className="button-outline mt-5 inline-flex px-4 py-2 text-xs"
                >
                  {t("creatorPanel.hub.page.open")}
                </Link>
              </PanelCard>
            </div>
          ) : null}

          {section === "sales" ? (
            <PanelCard
              title={t("platform.nav.sales")}
              description={t("creatorPanel.hub.sales.description")}
            >
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/teach/sales" className="button-solid px-4 py-2 text-xs">
                  {t("creatorPanel.hub.sales.open")}
                </Link>
                <Link href="/teach/messages" className="button-outline px-4 py-2 text-xs">
                  {t("creatorPanel.hub.sales.messages")}
                </Link>
              </div>
            </PanelCard>
          ) : null}

          {section === "tools" ? (
            <PanelCard
              title={t("creatorPanel.hub.tools.title")}
              description={t("creatorPanel.hub.tools.description")}
            >
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {[
                  {
                    label: t("creatorPanel.hub.tools.marketing"),
                    detail: t("creatorPanel.hub.tools.marketingDetail"),
                    href: "/teach/marketing",
                  },
                  {
                    label: t("platform.nav.mediaLibrary"),
                    detail: t("creatorPanel.hub.tools.mediaDetail"),
                    href: "/teach/media",
                  },
                  {
                    label: t("creatorPanel.hub.tools.verification"),
                    detail: t("creatorPanel.hub.tools.verificationDetail"),
                    href: "/teach/verification",
                  },
                ].map((tool) => (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className="rounded-md border fine-rule bg-white px-4 py-3 hover:bg-[var(--color-surface-soft)]"
                  >
                    <strong className="block text-sm text-[var(--color-ink)]">{tool.label}</strong>
                    <span className="mt-1 block text-xs leading-5 text-[var(--color-ink-soft)]">
                      {tool.detail}
                    </span>
                  </Link>
                ))}
              </div>
            </PanelCard>
          ) : null}

          {section === "coupons" ? (
            <CouponsPanel courseId={course.id} activationBlocked={activationBlocked} />
          ) : null}

          {section === "tax" ? <TaxPanel courseId={course.id} /> : null}

          {roadmapSections.map((item) =>
            section === item.id ? (
              <PanelCard key={item.id} title={t(item.titleKey)} description={t(item.descriptionKey)}>
                <div className="mt-5 flex flex-wrap gap-2">
                  <a
                    href={`mailto:support@skillsetmind.com?subject=${encodeURIComponent(
                      t("creatorPanel.hub.roadmap.notifySubject").replace("{feature}", () =>
                        t(item.labelKey)
                      )
                    )}`}
                    className="button-outline px-4 py-2 text-xs"
                  >
                    {t("creatorPanel.hub.roadmap.notify")}
                  </a>
                </div>
              </PanelCard>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
