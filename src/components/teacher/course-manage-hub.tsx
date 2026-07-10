"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import type { TeacherCourse } from "@/domain/teacher-course";
import { teacherCanSubmitCourse } from "@/domain/teacher-course";
import { fetchRequireCreatorVerification } from "@/lib/data/creator-verification";
import {
  submitTeacherCourseForReview,
  subscribeToTeacherCourse,
  subscribeToTeacherCourses,
} from "@/lib/data/teacher-courses";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

// Per-course management central (Hotmart-style "product hub"): one place with
// the publish checklist, the course's real settings, and the commerce surfaces.
// Sections that aren't built yet render as honest roadmap cards — never as
// fake-active features (platform "no fake data" rule).

const manageSections = [
  { id: "overview", label: "Overview" },
  { id: "basic", label: "Basic info" },
  { id: "pricing", label: "Pricing" },
  { id: "content", label: "Content" },
  { id: "members", label: "Members area" },
  { id: "page", label: "Product page" },
  { id: "sales", label: "Sales" },
] as const;

const roadmapSections = [
  { id: "coupons", label: "Coupons", href: "/teach/coupons" },
  { id: "affiliates", label: "Affiliates", href: null },
  { id: "coproductions", label: "Co-productions", href: "/teach/co-productions" },
  { id: "tax", label: "Tax & invoicing", href: null },
] as const;

type SectionId =
  | (typeof manageSections)[number]["id"]
  | (typeof roadmapSections)[number]["id"];

const statusCopy: Record<TeacherCourse["status"], string> = {
  draft:
    "Private draft — only you can see this course. Complete the checklist and send it for review.",
  in_review:
    "Skillset review in progress. Editing reopens if the review team requests changes.",
  needs_changes:
    "The review team requested changes. Address the note below, update the course, and resubmit.",
  published: "Live on the marketplace. Students can enroll right now.",
  inactive:
    "Hidden from the marketplace. Republishing goes through review again.",
};

function isPaidCourse(course: TeacherCourse): boolean {
  return course.paymentType !== "free" && (course.priceAmountMinor ?? 0) > 0;
}

function priceLabel(course: TeacherCourse): string {
  if (!isPaidCourse(course)) {
    return "Free";
  }
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (course.currency ?? "USD").toUpperCase(),
  }).format((course.priceAmountMinor ?? 0) / 100);
  if (course.paymentType === "subscription_monthly") {
    return `${amount} / month`;
  }
  if (course.paymentType === "subscription_yearly") {
    return `${amount} / year`;
  }
  return amount;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b fine-rule py-3 last:border-b-0">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
        {label}
      </span>
      <span className="min-w-0 text-sm leading-6 text-[var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

function PanelCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-5">
      <h3 className="text-base font-semibold text-[var(--color-ink)]">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function CourseManageHub({ courseId }: { courseId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  // Which courseId the subscription has answered for — derives the loading
  // state without a synchronous setState reset when the route param changes.
  const [loadedCourseId, setLoadedCourseId] = useState<string | null>(null);
  const [myCourses, setMyCourses] = useState<TeacherCourse[]>([]);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState("none");
  const [requireVerification, setRequireVerification] = useState(false);
  const [section, setSection] = useState<SectionId>("overview");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitNotice, setSubmitNotice] = useState("");

  useEffect(() => {
    return subscribeToTeacherCourse(
      courseId,
      (nextCourse) => {
        setCourse(nextCourse);
        setLoadedCourseId(courseId);
      },
      () => setLoadedCourseId(courseId),
    );
  }, [courseId]);

  const courseLoaded = loadedCourseId === courseId;

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeToTeacherCourses(user.uid, setMyCourses, () => undefined);
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeToUserProfile(
      user.uid,
      (profile) => {
        setPayoutsReady(
          Boolean(
            profile?.stripeConnectChargesEnabled
            && profile?.stripeConnectPayoutsEnabled,
          ),
        );
        setVerificationStatus(profile?.creatorVerificationStatus ?? "none");
      },
      () => setPayoutsReady(false),
    );
  }, [user]);

  useEffect(() => {
    let active = true;
    fetchRequireCreatorVerification()
      .then((value) => {
        if (active) {
          setRequireVerification(value);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const isOwner = Boolean(course && user && course.ownerId === user.uid);
  const paid = course ? isPaidCourse(course) : false;

  const checklist = useMemo(() => {
    if (!course) {
      return [];
    }
    const items: Array<{
      label: string;
      hint: ReactNode;
      done: boolean;
      optional?: boolean;
    }> = [
      {
        label: "Title & summary",
        hint: "Name the course and describe the outcome in the summary.",
        done: course.title.trim().length > 0 && course.summary.trim().length > 0,
      },
      {
        label: "Category",
        hint: "Pick the category buyers browse by.",
        done: course.category.trim().length > 0,
      },
      {
        label: "Cover image",
        hint: "Upload a cover — it fronts the product page and marketplace cards.",
        done: Boolean(course.coverImageUrl),
      },
      {
        label: "Curriculum",
        hint: "At least one module with one lesson.",
        done: course.modules.length > 0 && course.lessonCount > 0,
      },
      {
        label: "Pricing",
        hint: "Set a price or mark the course as free.",
        done:
          course.paymentType === "free" || (course.priceAmountMinor ?? 0) > 0,
      },
      {
        label: "Learning outcomes",
        hint: "Optional, but outcomes lift conversion on the product page.",
        done: (course.learningOutcomes?.length ?? 0) > 0,
        optional: true,
      },
    ];
    if (paid) {
      items.push({
        label: "Stripe payouts",
        hint: "Paid courses need payout onboarding finished before review.",
        done: payoutsReady,
      });
    }
    items.push({
      label: "Professional verification",
      hint: (
        <>
          {requireVerification
            ? "Required before this course can be sent for review. "
            : "Optional today — becomes required when professional admission opens. "}
          <Link
            href="/teach/verification"
            className="font-semibold text-[var(--color-primary)] underline"
          >
            Open verification
          </Link>
        </>
      ),
      done: verificationStatus === "approved",
      optional: !requireVerification,
    });
    return items;
  }, [course, paid, payoutsReady, requireVerification, verificationStatus]);

  const requiredItems = checklist.filter((item) => !item.optional);
  const requiredDone = requiredItems.filter((item) => item.done).length;
  const progressPercent = requiredItems.length
    ? Math.round((requiredDone / requiredItems.length) * 100)
    : 0;

  const handleSubmitForReview = async () => {
    if (!course) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError("");
    setSubmitNotice("");
    try {
      await submitTeacherCourseForReview(course.id);
      setSubmitNotice("Course submitted for review.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not submit the course.";
      setSubmitError(
        message.toLowerCase().includes("payout")
          ? "Finish Stripe payout onboarding before submitting a paid course — open the Payouts panel in your studio."
          : message,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!courseLoaded) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">Loading course...</p>
      </section>
    );
  }

  if (!course || (user && !isOwner)) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          This course isn&apos;t in your studio.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
          It may have been deleted, or it belongs to another creator.
        </p>
        <Link href="/teach/builder" className="button-outline mt-4 inline-flex px-4 py-2 text-xs">
          Back to my courses
        </Link>
      </section>
    );
  }

  const switchableCourses = myCourses.filter(
    (candidate) => candidate.id !== course.id,
  );

  return (
    <div className="grid gap-6">
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-[10px] border fine-rule bg-[var(--color-surface-soft)]">
              {course.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={course.coverImageUrl}
                  alt={`${course.title || "Course"} cover`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                  No cover
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                Course management
              </p>
              <h1 className="mt-1 truncate text-xl font-semibold text-[var(--color-ink)]">
                {course.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusChip status={course.status} />
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                  {course.modules.length} modules - {course.lessonCount} lessons - {priceLabel(course)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {switchableCourses.length > 0 ? (
              <select
                aria-label="Switch course"
                value={course.id}
                onChange={(event) =>
                  router.push(`/teach/courses/${event.target.value}/manage`)
                }
                className="rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--color-ink)]"
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
              href={`/teach/builder?courseId=${course.id}`}
              className="button-solid px-4 py-2 text-xs"
            >
              Edit in Builder
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:items-start">
        <nav
          aria-label="Course management sections"
          className="rounded-[14px] border border-[var(--color-line)] bg-white p-3 shadow-[var(--shadow-soft)]"
        >
          <p className="px-2 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            Manage
          </p>
          <div className="grid gap-1">
            {manageSections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`rounded-[8px] px-3 py-2 text-left text-sm font-semibold transition ${
                  section === item.id
                    ? "bg-[var(--color-surface-soft)] text-[var(--color-primary)]"
                    : "text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-hover)]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="px-2 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            On the roadmap
          </p>
          <div className="grid gap-1">
            {roadmapSections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`rounded-[8px] px-3 py-2 text-left text-sm font-semibold transition ${
                  section === item.id
                    ? "bg-[var(--color-surface-soft)] text-[var(--color-primary)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="grid gap-4">
          {section === "overview" ? (
            <PanelCard
              title="Publish checklist"
              description={statusCopy[course.status]}
            >
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-surface-hover)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)] transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                  {requiredDone} of {requiredItems.length} required steps done
                </p>
                <ul className="mt-4 grid gap-3">
                  {checklist.map((item) => (
                    <li key={item.label} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                          item.done
                            ? "bg-[var(--color-primary)] text-white"
                            : "border fine-rule bg-white text-[var(--color-ink-muted)]"
                        }`}
                      >
                        {item.done ? "✓" : ""}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[var(--color-ink)]">
                          {item.label}
                          {item.optional ? (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                              Optional
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
                          {item.hint}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                {course.reviewNote ? (
                  <div className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.18)] bg-white px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-accent-fg)]">
                      Skillset review note
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                      {course.reviewNote}
                    </p>
                  </div>
                ) : null}
                {submitError ? (
                  <p className="mt-4 text-sm font-semibold text-[var(--color-accent-fg)]">
                    {submitError}
                  </p>
                ) : null}
                {submitNotice ? (
                  <p className="mt-4 text-sm font-semibold text-[var(--color-primary)]">
                    {submitNotice}
                  </p>
                ) : null}
                {teacherCanSubmitCourse(course.status) ? (
                  <button
                    type="button"
                    onClick={handleSubmitForReview}
                    disabled={isSubmitting || requiredDone < requiredItems.length}
                    className="button-solid mt-5 px-5 py-2.5 text-xs disabled:opacity-60"
                  >
                    {isSubmitting ? "Submitting..." : "Send for review"}
                  </button>
                ) : null}
            </PanelCard>
          ) : null}

          {section === "basic" ? (
            <PanelCard
              title="Basic info"
              description="Identity shown across the marketplace and product page. Edit these fields in the Builder."
            >
              <div className="mt-4">
                <DetailRow label="Title" value={course.title} />
                <DetailRow label="Category" value={course.category} />
                {course.categories && course.categories.length > 1 ? (
                  <DetailRow
                    label="All categories"
                    value={course.categories.join(", ")}
                  />
                ) : null}
                <DetailRow label="Summary" value={course.summary || "—"} />
                <DetailRow
                  label="Learning outcomes"
                  value={
                    course.learningOutcomes?.length ? (
                      <ul className="list-disc pl-4">
                        {course.learningOutcomes.map((outcome) => (
                          <li key={outcome}>{outcome}</li>
                        ))}
                      </ul>
                    ) : (
                      "None yet"
                    )
                  }
                />
                <DetailRow
                  label="Cover image"
                  value={course.coverImageUrl ? "Uploaded" : "Missing"}
                />
              </div>
              <Link
                href={`/teach/builder?courseId=${course.id}`}
                className="button-outline mt-5 inline-flex px-4 py-2 text-xs"
              >
                Edit basics in Builder
              </Link>
            </PanelCard>
          ) : null}

          {section === "pricing" ? (
            <PanelCard
              title="Pricing"
              description="What buyers pay at checkout. Price changes go live immediately for published courses."
            >
              <div className="mt-4">
                <DetailRow label="Price" value={priceLabel(course)} />
                <DetailRow
                  label="Payment type"
                  value={(course.paymentType ?? "one_time").replaceAll("_", " ")}
                />
                <DetailRow
                  label="Installments"
                  value={
                    course.installmentsEnabled
                      ? `Up to ${course.installmentsMax ?? 1}x`
                      : "Disabled"
                  }
                />
                {paid ? (
                  <DetailRow
                    label="Stripe payouts"
                    value={payoutsReady ? "Ready" : "Onboarding incomplete"}
                  />
                ) : null}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href={`/teach/builder?courseId=${course.id}`}
                  className="button-outline px-4 py-2 text-xs"
                >
                  Edit pricing in Builder
                </Link>
                {paid && !payoutsReady ? (
                  <Link
                    href="/account/payments#stripe-connect"
                    className="button-solid px-4 py-2 text-xs"
                  >
                    Finish payout onboarding
                  </Link>
                ) : null}
              </div>
            </PanelCard>
          ) : null}

          {section === "content" ? (
            <PanelCard
              title="Content"
              description={`${course.modules.length} modules and ${course.lessonCount} lessons in the curriculum.`}
            >
              {course.modules.length ? (
                <ol className="mt-4 grid gap-2">
                  {course.modules.map((courseModule, index) => (
                    <li
                      key={courseModule.id}
                      className="rounded-[10px] border fine-rule bg-white px-4 py-3"
                    >
                      <p className="text-sm font-semibold text-[var(--color-ink)]">
                        {index + 1}. {courseModule.title}
                      </p>
                      <p className="text-xs text-[var(--color-ink-muted)]">
                        {courseModule.lessons.length} lessons
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
                  No modules yet — build the curriculum in the Builder.
                </p>
              )}
              <Link
                href={`/teach/builder?courseId=${course.id}`}
                className="button-outline mt-5 inline-flex px-4 py-2 text-xs"
              >
                Edit content in Builder
              </Link>
            </PanelCard>
          ) : null}

          {section === "members" ? (
            <PanelCard
              title="Members area"
              description="The workspace enrolled students land in after purchase."
            >
              <div className="mt-4">
                <DetailRow
                  label="Theme"
                  value={course.membersTheme ?? "light"}
                />
                <DetailRow
                  label="Welcome title"
                  value={course.membersTitle || "Default"}
                />
                <DetailRow
                  label="Subtitle"
                  value={course.membersSubtitle || "Default"}
                />
                <DetailRow
                  label="Community"
                  value={course.communityEnabled ? "Enabled" : "Disabled"}
                />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href={`/teach/builder/${course.id}/preview`}
                  className="button-solid px-4 py-2 text-xs"
                >
                  Preview members area
                </Link>
                <Link
                  href={`/teach/builder?courseId=${course.id}`}
                  className="button-outline px-4 py-2 text-xs"
                >
                  Edit in Builder
                </Link>
              </div>
            </PanelCard>
          ) : null}

          {section === "page" ? (
            <PanelCard
              title="Product page"
              description="The public sales page buyers see. Until the course is published, only you can open it."
            >
              <Link
                href={`/courses/${course.id}`}
                className="button-solid mt-5 inline-flex px-4 py-2 text-xs"
              >
                View product page
              </Link>
            </PanelCard>
          ) : null}

          {section === "sales" ? (
            <PanelCard
              title="Sales"
              description="Orders, refunds, and revenue live in the studio-wide sales dashboard."
            >
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/teach/sales" className="button-solid px-4 py-2 text-xs">
                  Open sales dashboard
                </Link>
                <Link href="/teach/messages" className="button-outline px-4 py-2 text-xs">
                  Student messages
                </Link>
              </div>
            </PanelCard>
          ) : null}

          {roadmapSections.map((item) =>
            section === item.id ? (
              <PanelCard
                key={item.id}
                title={`${item.label} are on the roadmap.`}
                description="This surface isn't live yet — we'd rather show you that honestly than a mock. It ships as part of the creator commerce rollout."
              >
                <div className="mt-5 flex flex-wrap gap-2">
                  {item.href ? (
                    <Link href={item.href} className="button-outline px-4 py-2 text-xs">
                      More about {item.label.toLowerCase()}
                    </Link>
                  ) : null}
                  <a
                    href={`mailto:support@skillsetmind.com?subject=${encodeURIComponent(
                      `Notify me: ${item.label}`,
                    )}`}
                    className="button-outline px-4 py-2 text-xs"
                  >
                    Notify me when it ships
                  </a>
                </div>
              </PanelCard>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
