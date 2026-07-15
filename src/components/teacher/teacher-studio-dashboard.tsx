"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { TeacherOverviewMetrics } from "@/components/teacher/teacher-overview-metrics";
import { TeacherStudioInsights } from "@/components/teacher/teacher-studio-insights";
import type { Order } from "@/domain/order";
import { computePaymentSplit } from "@/domain/payment-split";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";
import { logSubscriptionError } from "@/lib/data/subscription-error";
import { toDate } from "@/lib/format-date";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

// Whole-dollar formatter for the compact hero payout chip (mirrors the
// formatter in teacher-studio-insights.tsx so the figure reads identically).
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// EN-only launch copy for the verification chip states (mirrors the honest
// wording on /teach/verification).
const verificationChipMeta: Record<string, { value: string; hint: string }> = {
  none: { value: "Not started", hint: "Verify your credentials" },
  pending: { value: "In review", hint: "We'll email the decision" },
  needs_changes: { value: "Action needed", hint: "Review the note and resubmit" },
  approved: { value: "Approved", hint: "Professional badge active" },
  rejected: { value: "Rejected", hint: "See the review note" },
};

export function TeacherStudioDashboard() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [ledger, setLedger] = useState<PayoutLedgerEntry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState("none");
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "";
  const publishedCourses = courses.filter((course) => course.status === "published");
  const draftCourses = courses.filter((course) => course.status === "draft");
  const nextPayoutMillis = useMemo(() => getNextPayoutMillis(ledger), [ledger]);
  const nextPayout = nextPayoutMillis
    ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
        nextPayoutMillis,
      )
    : t("teach.dashboard.payoutFirstOrder");

  // Compact hero payout chip figure, computed with the CANONICAL split
  // (src/domain/payment-split): platform commission AND the Stripe processing
  // fee the teacher absorbs (DECISIONS.md D1/D2). The old local mirror omitted
  // the Stripe fee and overstated the teacher's net on every sale.
  const paidOrders = orders.filter((order) => order.status === "paid");
  const netMinor = paidOrders.reduce(
    (sum, order) =>
      sum
      + computePaymentSplit(
        order.amountMinor,
        order.currency ?? "USD",
        order.platformFeeBps,
      ).teacherNetMinor,
    0,
  );

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setCoursesLoaded(true);
      },
      (error) => {
        logSubscriptionError("TeacherStudioDashboard.courses")(error);
        setCoursesLoaded(true);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherPayoutLedger(
      user.uid,
      setLedger,
      logSubscriptionError("TeacherStudioDashboard.payoutLedger"),
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherOrders(
      user.uid,
      (nextOrders) => {
        setOrders(nextOrders);
        setOrdersLoaded(true);
      },
      (error) => {
        logSubscriptionError("TeacherStudioDashboard.orders")(error);
        // Loaded-with-error still ends the skeleton; the chip shows $0 rather
        // than pulsing forever on a broken subscription.
        setOrdersLoaded(true);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserProfile(
      user.uid,
      (profile) => {
        setPayoutsReady(Boolean(
          profile?.stripeConnectChargesEnabled
          && profile?.stripeConnectPayoutsEnabled,
        ));
        setVerificationStatus(profile?.creatorVerificationStatus ?? "none");
      },
      () => setPayoutsReady(false),
    );
  }, [user]);

  return (
    <div className="grid gap-6">
      <section className="studio-welcome-card dash-card dash-card--strong p-5 sm:p-6">
        <div className="relative z-[1] flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-accent-fg)]">
              {t("teach.page.eyebrow")}
            </p>
            <h1 className="display-title mt-2 text-3xl leading-[1.05] text-[var(--color-primary)] sm:text-4xl lg:text-5xl">
              {firstName
                ? t("teach.dashboard.welcomeBackNamed").replace("{name}", firstName)
                : t("teach.dashboard.welcomeBack")}
            </h1>
            {coursesLoaded ? (
              <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--color-ink-soft)]">
                {t("teach.dashboard.summaryPrefix")}{" "}
                <strong className="text-[var(--color-ink)]">
                  {t(
                    publishedCourses.length === 1
                      ? "teach.dashboard.publishedSingular"
                      : "teach.dashboard.publishedPlural",
                  ).replace("{count}", String(publishedCourses.length))}
                </strong>{" "}
                {t("teach.dashboard.summaryJoin")}{" "}
                <strong className="text-[var(--color-ink)]">
                  {t(
                    draftCourses.length === 1
                      ? "teach.dashboard.draftSingular"
                      : "teach.dashboard.draftPlural",
                  ).replace("{count}", String(draftCourses.length))}
                </strong>
                {t("teach.dashboard.summaryPayoutLead")}{" "}
                <strong className="text-[var(--color-ink)]">{nextPayout}</strong>
              </p>
            ) : (
              <div className="mt-3 h-6 w-3/4 max-w-2xl animate-pulse rounded bg-[var(--color-surface-strong)]" />
            )}
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <Link
              href="/account/payments#stripe-connect"
              className="studio-payout-chip"
              aria-label={
                !ordersLoaded
                  ? t("teach.dashboard.payoutLoadingAria")
                  : payoutsReady
                    ? t("teach.dashboard.payoutAria").replace(
                        "{amount}",
                        money.format(netMinor / 100),
                      )
                    : t("teach.dashboard.connectStripeAria")
              }
            >
              <span className="studio-payout-chip__label">
                {t("teach.dashboard.nextPayout")}
              </span>
              <span className="studio-payout-chip__value">
                {ordersLoaded ? (
                  money.format(netMinor / 100)
                ) : (
                  // Orders snapshot not in yet — pulse instead of flashing $0.
                  <span
                    className="inline-block h-[1em] w-14 animate-pulse rounded bg-[var(--color-surface-strong)] align-middle"
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="studio-payout-chip__hint">
                {payoutsReady
                  ? t("teach.dashboard.netAfterFees")
                  : t("teach.dashboard.connectStripe")}
              </span>
            </Link>

            <Link
              href="/teach/verification"
              className="studio-payout-chip"
              aria-label={`Professional verification: ${
                (verificationChipMeta[verificationStatus]
                  ?? verificationChipMeta.none).value
              }`}
            >
              <span className="studio-payout-chip__label">
                {t("teach.dashboard.verification")}
              </span>
              <span className="studio-payout-chip__value">
                {(verificationChipMeta[verificationStatus]
                  ?? verificationChipMeta.none).value}
              </span>
              <span className="studio-payout-chip__hint">
                {(verificationChipMeta[verificationStatus]
                  ?? verificationChipMeta.none).hint}
              </span>
            </Link>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <Link
                href="/account?tab=profile"
                className="button-outline bg-white px-4 py-2.5 text-sm"
              >
                {t("teach.dashboard.publicProfile")}
              </Link>
              <Link
                href="/teach/storefront"
                className="button-outline bg-white px-4 py-2.5 text-sm"
              >
                {t("teach.dashboard.storefront")}
              </Link>
              <Link
                href="/teach/builder?newCourse=1"
                className="button-solid px-4 py-2.5 text-sm"
              >
                {t("teach.dashboard.newCourse")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Hotmart-style home blocks: readiness + product grid + sell formats.
          Skin stays Skillset (colors/type); macro structure follows producer map. */}
      <StudioReadinessCard
        courses={courses}
        coursesLoaded={coursesLoaded}
        payoutsReady={payoutsReady}
        verificationStatus={verificationStatus}
      />

      <StudioProductsSection
        courses={courses}
        coursesLoaded={coursesLoaded}
      />

      <StudioSellFormatsSection />

      <TeacherOverviewMetrics />
      <TeacherStudioInsights />
    </div>
  );
}

type ProductFilter = "all" | "draft" | "published" | "in_review" | "other";

function StudioReadinessCard({
  courses,
  coursesLoaded,
  payoutsReady,
  verificationStatus,
}: {
  courses: TeacherCourse[];
  coursesLoaded: boolean;
  payoutsReady: boolean;
  verificationStatus: string;
}) {
  const items = [
    {
      id: "product",
      label: "Create a product",
      done: courses.length > 0,
      href: "/teach/builder?newCourse=1",
      action: "Create",
    },
    {
      id: "pricing",
      label: "Set pricing (or mark free)",
      done: courses.some(
        (c) =>
          c.paymentType === "free" ||
          (Number(c.priceAmountMinor ?? 0) > 0 && Boolean(c.currency)),
      ),
      href: courses[0]
        ? `/teach/courses/${encodeURIComponent(courses[0].id)}/manage?section=pricing`
        : "/teach/builder?newCourse=1",
      action: "Edit",
    },
    {
      id: "content",
      label: "Add content (modules / lessons)",
      done: courses.some((c) => c.status === "published" || c.status === "in_review"),
      href: courses[0]
        ? `/teach/builder?courseId=${encodeURIComponent(courses[0].id)}`
        : "/teach/builder",
      action: "Open builder",
    },
    {
      id: "payouts",
      label: "Connect payouts (Stripe)",
      done: payoutsReady,
      href: "/account/payments#stripe-connect",
      action: "Configure",
    },
    {
      id: "verify",
      label: "Professional verification",
      done: verificationStatus === "approved",
      href: "/teach/verification",
      action: "Configure",
    },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);

  return (
    <section className="dash-card p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Launch checklist
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--color-primary)]">
            Almost ready to sell
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            Complete these steps before you go live. Same producer flow structure
            as major marketplaces — our branding and wording.
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums text-[var(--color-primary)]">
            {coursesLoaded ? `${pct}%` : "—"}
          </p>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {doneCount}/{items.length} complete
          </p>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-surface-strong)]">
        <div
          className="h-full rounded-full bg-[var(--color-primary)] transition-[width]"
          style={{ width: coursesLoaded ? `${pct}%` : "0%" }}
        />
      </div>
      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-3 text-sm transition hover:border-[var(--color-primary-light)]"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    item.done
                      ? "bg-[var(--color-primary)] text-white"
                      : "border border-[var(--color-line)] text-[var(--color-ink-muted)]"
                  }`}
                  aria-hidden
                >
                  {item.done ? "✓" : ""}
                </span>
                <span className="truncate text-[var(--color-ink)]">{item.label}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-[var(--color-accent-fg)]">
                {item.done ? "Done" : item.action}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StudioProductsSection({
  courses,
  coursesLoaded,
}: {
  courses: TeacherCourse[];
  coursesLoaded: boolean;
}) {
  const [filter, setFilter] = useState<ProductFilter>("all");
  const filters: { id: ProductFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "draft", label: "Drafts" },
    { id: "published", label: "Live sales" },
    { id: "in_review", label: "In review" },
    { id: "other", label: "Other" },
  ];

  const filtered = courses.filter((course) => {
    if (filter === "all") return true;
    if (filter === "draft") return course.status === "draft";
    if (filter === "published") return course.status === "published";
    if (filter === "in_review") return course.status === "in_review";
    return (
      course.status === "needs_changes" || course.status === "inactive"
    );
  });

  return (
    <section className="dash-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            My products
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--color-primary)]">
            Courses & programs
          </h2>
        </div>
        <Link
          href="/teach/builder?newCourse=1"
          className="button-solid px-4 py-2.5 text-sm"
        >
          New product
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Product filters">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              filter === f.id
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:border-[var(--color-primary-light)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!coursesLoaded ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-28 animate-pulse rounded-[12px] bg-[var(--color-surface-strong)]"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-5 rounded-[12px] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-5 py-10 text-center">
          <p className="text-sm font-medium text-[var(--color-ink)]">
            No products in this filter yet.
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Create a course, subscription, or free program to see it here.
          </p>
          <Link
            href="/teach/builder?newCourse=1"
            className="button-solid mt-4 inline-flex px-4 py-2.5 text-sm"
          >
            Create product
          </Link>
        </div>
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((course) => (
            <li key={course.id}>
              <Link
                href={`/teach/courses/${encodeURIComponent(course.id)}/manage`}
                className="flex h-full flex-col rounded-[12px] border border-[var(--color-line)] bg-white p-4 transition hover:border-[var(--color-primary-light)] hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-ink)]">
                    {course.title || "Untitled product"}
                  </p>
                  <span className="shrink-0 rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    {(course.status || "draft").replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                  {(course.paymentType || "one_time").replaceAll("_", " ")}
                  {course.priceAmountMinor != null && course.paymentType !== "free"
                    ? ` · ${new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: (course.currency || "USD").toUpperCase(),
                      }).format((course.priceAmountMinor || 0) / 100)}`
                    : ""}
                </p>
                <span className="mt-auto pt-4 text-xs font-semibold text-[var(--color-accent-fg)]">
                  Manage product →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StudioSellFormatsSection() {
  const formats = [
    {
      title: "Online course",
      detail: "Modules, lessons, drip, certificate — core product.",
      href: "/teach/builder?newCourse=1",
    },
    {
      title: "Subscription",
      detail: "Recurring access billed monthly or yearly via Stripe.",
      href: "/teach/builder?newCourse=1",
    },
    {
      title: "Free program",
      detail: "Lead magnet or open enrollment with no charge.",
      href: "/teach/builder?newCourse=1",
    },
  ];

  return (
    <section className="dash-card p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
        What do you want to sell?
      </p>
      <h2 className="mt-1 text-xl font-semibold text-[var(--color-primary)]">
        Product formats
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        Start with a format. You refine pricing, members area, and content in the
        product hub — same journey structure as leading creator platforms.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {formats.map((f) => (
          <li key={f.title}>
            <Link
              href={f.href}
              className="flex h-full flex-col rounded-[12px] border border-[var(--color-line)] bg-white p-4 transition hover:border-[var(--color-primary-light)]"
            >
              <p className="text-sm font-semibold text-[var(--color-ink)]">{f.title}</p>
              <p className="mt-2 flex-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                {f.detail}
              </p>
              <span className="mt-3 text-xs font-semibold text-[var(--color-accent-fg)]">
                Start →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function getNextPayoutMillis(entries: PayoutLedgerEntry[]): number | null {
  return (
    entries
      .filter((entry) => entry.status === "in_release" || entry.status === "releasing")
      .map((entry) => getTimestampMillis(entry.releaseAt))
      .filter((value): value is number => Boolean(value))
      .sort((left, right) => left - right)[0] ?? null
  );
}

function getTimestampMillis(value: unknown): number | null {
  return toDate(value)?.getTime() ?? null;
}
