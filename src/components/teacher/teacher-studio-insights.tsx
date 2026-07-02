"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Clock3,
  Flag,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { logSubscriptionError } from "@/lib/data/subscription-error";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { toDate } from "@/lib/format-date";

type RevenueRange = "3m" | "6m" | "12m" | "all";

const revenueRanges: { value: RevenueRange; label: string }[] = [
  { value: "3m", label: "3m" },
  { value: "6m", label: "6m" },
  { value: "12m", label: "12m" },
  { value: "all", label: "All" },
];

const revenueRangeSubtitle: Record<RevenueRange, string> = {
  "3m": "Last 3 months - all courses",
  "6m": "Last 6 months - all courses",
  "12m": "Last 12 months - all courses",
  all: "All time - all courses",
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });

type ActivityItem = {
  title: string;
  detail: string;
  href: string;
  kind: "urgent" | "normal" | "success";
  icon: "alert" | "clock" | "flag" | "message" | "sparkle";
};

export function TeacherStudioInsights() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("12m");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      setCourses,
      logSubscriptionError("TeacherStudioInsights.courses"),
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherOrders(
      user.uid,
      setOrders,
      logSubscriptionError("TeacherStudioInsights.orders"),
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
      },
      () => setPayoutsReady(false),
    );
  }, [user]);

  const paidOrders = orders.filter((order) => order.status === "paid");
  const grossMinor = paidOrders.reduce((sum, order) => sum + order.amountMinor, 0);
  const monthlyRevenue = useMemo(
    () => buildMonthlyRevenue(paidOrders, revenueRange),
    [paidOrders, revenueRange],
  );
  const chart = useMemo(() => buildChart(monthlyRevenue), [monthlyRevenue]);
  const topCourses = useMemo(
    () => buildTopCourses(courses, paidOrders),
    [courses, paidOrders],
  );
  const activity = buildActivity(courses, payoutsReady);

  return (
    <div className="grid gap-8">
      <section className="studio-dashboard-grid">
        <div className="studio-chart-card dash-card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="display-title text-2xl text-[var(--color-primary)]">
                Revenue
              </h3>
              <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
                {revenueRangeSubtitle[revenueRange]}
              </p>
            </div>
            <div className="studio-range-tabs" role="group" aria-label="Revenue range">
              {revenueRanges.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  aria-pressed={revenueRange === range.value}
                  onClick={() => setRevenueRange(range.value)}
                  className={revenueRange === range.value ? "is-active" : undefined}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>

          <div className="studio-chart-canvas">
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              role="img"
              aria-label="Teacher revenue chart"
              className="h-full w-full"
            >
              <defs>
                <linearGradient id="studioRevenueArea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#1a365d" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#1a365d" stopOpacity="0" />
                </linearGradient>
              </defs>
              {chart.gridLines.map((line) => (
                <line
                  key={line.y}
                  x1={chart.padLeft}
                  x2={chart.width - chart.padRight}
                  y1={line.y}
                  y2={line.y}
                  stroke="var(--color-line)"
                  strokeDasharray={line.major ? "0" : "4 6"}
                />
              ))}
              {chart.yLabels.map((label) => (
                <text
                  key={label.text}
                  x={chart.padLeft - 8}
                  y={label.y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--color-ink-muted)"
                  fontWeight="700"
                >
                  {label.text}
                </text>
              ))}
              {monthlyRevenue.map((point, index) => (
                <text
                  key={point.month}
                  x={chart.points[index]?.[0] ?? 0}
                  y={chart.height - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--color-ink-muted)"
                  fontWeight="700"
                >
                  {point.month}
                </text>
              ))}
              <path d={chart.areaPath} fill="url(#studioRevenueArea)" />
              <path
                d={chart.linePath}
                stroke="var(--color-primary)"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {chart.points.map((point, index) => (
                <circle
                  key={`${point[0]}-${point[1]}`}
                  cx={point[0]}
                  cy={point[1]}
                  r={index === chart.points.length - 1 ? 5 : 2.5}
                  fill={index === chart.points.length - 1 ? "var(--color-accent)" : "var(--color-primary)"}
                />
              ))}
              {chart.lastPoint ? (
                <g>
                  <rect
                    x={chart.lastPoint[0] - 39}
                    y={chart.lastPoint[1] - 38}
                    rx="6"
                    width="78"
                    height="24"
                    fill="#0f2744"
                  />
                  <text
                    x={chart.lastPoint[0]}
                    y={chart.lastPoint[1] - 21}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="800"
                    fill="#fff"
                  >
                    {money.format(grossMinor / 100)}
                  </text>
                </g>
              ) : null}
            </svg>

            {!grossMinor ? (
              <div className="studio-chart-empty">
                <p>No revenue yet</p>
                <span>Create, upload, preview, connect payouts, then submit for review.</span>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="grid gap-5">
          <div className="dash-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="display-title text-2xl text-[var(--color-primary)]">
                Top courses
              </h3>
              <Link href="/teach/builder" className="button-outline px-3.5 py-2 text-xs">
                All courses
              </Link>
            </div>
            <div className="mt-4 grid gap-3">
              {topCourses.length ? (
                topCourses.map((course) => (
                  <Link
                    key={course.id}
                    href={`/teach/builder?courseId=${course.id}`}
                    className="studio-course-row"
                  >
                    <span className="studio-course-row__thumb">{course.code}</span>
                    <span className="min-w-0">
                      <strong>{course.title}</strong>
                      <small>
                        {course.lessonCount} lessons - {course.orders} orders
                      </small>
                    </span>
                    <span className="studio-course-row__value">
                      <strong>{money.format(course.grossMinor / 100)}</strong>
                      <StatusChip status={course.status} />
                    </span>
                  </Link>
                ))
              ) : (
                <RichEmptyLine
                  title="No courses yet."
                  detail="Your first course will appear here after it is created in Course Builder."
                />
              )}
            </div>
          </div>
        </aside>
      </section>

      <section>
        <div className="sec-head">
          <div>
            <span className="eyebrow brand">Activity</span>
            <h2>What needs your attention today.</h2>
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {activity.map((item) => (
            <Link key={item.title} href={item.href} className="studio-activity-card">
              <span className={`studio-activity-card__icon is-${item.kind}`}>
                {renderActivityIcon(item.icon)}
              </span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
              <span className="studio-activity-card__open">
                Open <ArrowUpRight aria-hidden="true" size={13} />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function RichEmptyLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[12px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-4">
      <p className="text-sm font-semibold text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">{detail}</p>
    </div>
  );
}

function buildTopCourses(courses: TeacherCourse[], paidOrders: Order[]) {
  const byCourse = new Map<string, { orders: number; grossMinor: number }>();

  paidOrders.forEach((order) => {
    const current = byCourse.get(order.courseId) ?? { orders: 0, grossMinor: 0 };
    current.orders += 1;
    current.grossMinor += order.amountMinor;
    byCourse.set(order.courseId, current);
  });

  return courses
    .map((course) => {
      const sales = byCourse.get(course.id) ?? { orders: 0, grossMinor: 0 };

      return {
        id: course.id,
        title: course.title,
        status: course.status,
        lessonCount: course.lessonCount,
        code: buildCourseCode(course.title),
        ...sales,
      };
    })
    .sort((a, b) => b.grossMinor - a.grossMinor || b.lessonCount - a.lessonCount)
    .slice(0, 3);
}

function buildActivity(courses: TeacherCourse[], payoutsReady: boolean): ActivityItem[] {
  const items: ActivityItem[] = [];
  const emptyDraft = courses.find((course) => course.status === "draft" && course.lessonCount === 0);
  const reviewReadyDraft = courses.find((course) => course.status === "draft" && course.lessonCount > 0);
  const needsChanges = courses.find((course) => course.status === "needs_changes");
  const inReview = courses.find((course) => course.status === "in_review");

  if (!payoutsReady) {
    items.push({
      title: "Finish payout setup",
      detail: "Connect Stripe so paid courses can sell and release creator payouts.",
      href: "/account/payments#stripe-connect",
      kind: "urgent",
      icon: "alert",
    });
  }

  if (needsChanges) {
    items.push({
      title: "Review requested changes",
      detail: `${needsChanges.title} needs edits before Skillset approval.`,
      href: `/teach/builder?courseId=${needsChanges.id}`,
      kind: "urgent",
      icon: "flag",
    });
  }

  if (emptyDraft) {
    items.push({
      title: "Add lessons to your draft",
      detail: `${emptyDraft.title} has no lessons yet. Open the builder and add modules.`,
      href: `/teach/builder?courseId=${emptyDraft.id}`,
      kind: "normal",
      icon: "clock",
    });
  }

  if (!courses.length) {
    items.push({
      title: "Create your first course",
      detail: "Start with title, category, pricing, modules, lessons, video, and materials.",
      href: "/teach/builder?newCourse=1",
      kind: "normal",
      icon: "sparkle",
    });
  }

  if (reviewReadyDraft) {
    items.push({
      title: "Submit a course for review",
      detail: `${reviewReadyDraft.title} has lessons and can move toward review.`,
      href: `/teach/builder?courseId=${reviewReadyDraft.id}`,
      kind: "success",
      icon: "sparkle",
    });
  }

  if (inReview) {
    items.push({
      title: "Course review in progress",
      detail: `${inReview.title} is on sale while Skillset completes its review.`,
      href: `/teach/builder?courseId=${inReview.id}`,
      kind: "normal",
      icon: "clock",
    });
  }

  items.push({
    title: "Student questions",
    detail: "Course discussions and lesson comments will surface here as students engage.",
    href: "/learn/community/creator",
    kind: "normal",
    icon: "message",
  });

  items.push({
    title: "Schedule the next live session",
    detail: "Add a class, mentorship, masterclass, office hour, webinar, or deadline to the course agenda.",
    href: "/teach/events",
    kind: "normal",
    icon: "clock",
  });

  return items.slice(0, 3);
}

function getRevenueMonthsBack(
  paidOrders: Order[],
  range: RevenueRange,
  now: Date,
): number {
  if (range === "3m") {
    return 3;
  }
  if (range === "6m") {
    return 6;
  }
  if (range === "12m") {
    return 12;
  }

  // "all": span from the earliest paid order to now, clamped to [1, 24] months
  // so the monthly chart stays readable.
  const earliest = paidOrders
    .map((order) => getTimestampMillis(order.createdAt))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];

  if (!earliest) {
    return 12;
  }

  const earliestDate = new Date(earliest);
  const monthSpan =
    (now.getFullYear() - earliestDate.getFullYear()) * 12 +
    (now.getMonth() - earliestDate.getMonth()) +
    1;

  return Math.min(24, Math.max(1, monthSpan));
}

function buildMonthlyRevenue(paidOrders: Order[], range: RevenueRange) {
  const now = new Date();
  const monthsBack = getRevenueMonthsBack(paidOrders, range, now);
  const months = Array.from({ length: monthsBack }, (_, index) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth() - (monthsBack - 1) + index,
      1,
    );

    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      month: monthFormatter.format(date),
      grossMinor: 0,
    };
  });

  paidOrders.forEach((order) => {
    const millis = getTimestampMillis(order.createdAt);
    const date = millis ? new Date(millis) : now;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const month = months.find((item) => item.key === key);

    if (month) {
      month.grossMinor += order.amountMinor;
    }
  });

  return months;
}

function buildChart(monthlyRevenue: ReturnType<typeof buildMonthlyRevenue>) {
  const width = 640;
  const height = 240;
  const padLeft = 48;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 32;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const maxGross = Math.max(...monthlyRevenue.map((point) => point.grossMinor), 10000);
  const stepX = innerWidth / Math.max(1, monthlyRevenue.length - 1);
  const points = monthlyRevenue.map((point, index) => {
    const x = padLeft + index * stepX;
    const y = padTop + innerHeight - (point.grossMinor / maxGross) * innerHeight;

    return [x, y] as [number, number];
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point[0]},${point[1]}`)
    .join(" ");
  const baseline = padTop + innerHeight;
  const areaPath = `${linePath} L${points[points.length - 1]?.[0] ?? padLeft},${baseline} L${points[0]?.[0] ?? padLeft},${baseline} Z`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((position, index) => ({
    y: padTop + innerHeight - position * innerHeight,
    major: index === 0,
  }));
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map((position) => ({
    y: padTop + innerHeight - position * innerHeight,
    text: formatAxisLabel(maxGross * position),
  }));

  return {
    width,
    height,
    padLeft,
    padRight,
    points,
    linePath,
    areaPath,
    gridLines,
    yLabels,
    lastPoint: points.at(-1) ?? null,
  };
}

function buildCourseCode(title: string) {
  const letters = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return letters || "Co";
}

function formatAxisLabel(amountMinor: number) {
  const dollars = amountMinor / 100;

  if (dollars >= 1000) {
    return `$${Math.round(dollars / 1000)}k`;
  }

  return `$${Math.round(dollars)}`;
}

function getTimestampMillis(value: unknown): number | null {
  return toDate(value)?.getTime() ?? null;
}

function renderActivityIcon(icon: ActivityItem["icon"]) {
  if (icon === "alert") {
    return <AlertCircle aria-hidden="true" size={18} />;
  }

  if (icon === "flag") {
    return <Flag aria-hidden="true" size={18} />;
  }

  if (icon === "message") {
    return <MessageSquareText aria-hidden="true" size={18} />;
  }

  if (icon === "sparkle") {
    return <Sparkles aria-hidden="true" size={18} />;
  }

  return <Clock3 aria-hidden="true" size={18} />;
}
