"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import type { OpsQueueCounts } from "@/components/admin/ops-overview-metrics";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { getOpsNavItem, type OpsQueue, type PlatformNavCount } from "@/data/site";
import {
  addMoney,
  overviewPeriods,
  parseOverviewPeriod,
  resolveOverviewWindow,
  summarizeActivations,
  summarizeCourses,
  summarizeEnrollments,
  summarizeOrders,
  summarizePublications,
  summarizeUsers,
  type Measure,
  type MoneyLine,
  type OverviewWindow,
} from "@/domain/ops-overview";
import {
  readOverviewActivations,
  readOverviewAdminSession,
  readOverviewCourses,
  readOverviewEnrollments,
  readOverviewOrders,
  readOverviewPublications,
  readOverviewUsers,
} from "@/lib/data/ops-overview";

// A read that has not answered by now is cancelled and shows as failed.
const READ_TIMEOUT_MS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Read<T> = { status: "loading" } | { status: "error" } | { status: "ready"; value: T };
type Loader<T> = (range: OverviewWindow, signal: AbortSignal) => Promise<T>;

const since = (range: OverviewWindow) => new Date(range.previousStart).toISOString();

// Module-level loaders: stable identities for the effect, and the summary runs
// inside the promise, so a malformed row fails its own tiles, not the page.
const loadAccess: Loader<boolean> = (_range, signal) => readOverviewAdminSession(signal);
const loadUsers: Loader<ReturnType<typeof summarizeUsers>> = (range, signal) =>
  readOverviewUsers(since(range), signal).then((rows) => summarizeUsers(rows, range));
const loadCourses: Loader<ReturnType<typeof summarizeCourses>> = (range, signal) =>
  readOverviewCourses(signal).then((rows) => summarizeCourses(rows, range));
const loadPublications: Loader<Measure> = (range, signal) =>
  readOverviewPublications(since(range), signal).then((rows) => summarizePublications(rows, range));
const loadEnrollments: Loader<ReturnType<typeof summarizeEnrollments>> = (range, signal) =>
  readOverviewEnrollments(since(range), signal).then((rows) => summarizeEnrollments(rows, range));
const loadOrders: Loader<ReturnType<typeof summarizeOrders>> = (range, signal) =>
  readOverviewOrders(since(range), signal).then((rows) => summarizeOrders(rows, range));
const loadActivations: Loader<ReturnType<typeof summarizeActivations>> = (range, signal) =>
  readOverviewActivations(since(range), signal).then((rows) => summarizeActivations(rows, range));

function useRead<T>(range: OverviewWindow, load: Loader<T>): Read<T> {
  const [state, setState] = useState<{ range: OverviewWindow; read: Read<T> }>({
    range,
    read: { status: "loading" },
  });

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const settle = (read: Read<T>) => {
      if (live) setState({ range, read });
    };
    const timer = setTimeout(() => {
      settle({ status: "error" });
      controller.abort();
    }, READ_TIMEOUT_MS);
    // Promise.resolve().then: a loader that throws synchronously is a failed read too.
    Promise.resolve(range)
      .then((value) => load(value, controller.signal))
      .then(
        (value) => settle({ status: "ready", value }),
        () => settle({ status: "error" }),
      )
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [range, load]);

  // A period switch or refresh never shows the previous window's numbers.
  return state.range === range ? state.read : { status: "loading" };
}

function pick<T, U>(read: Read<T>, select: (value: T) => U): Read<U> {
  return read.status === "ready" ? { status: "ready", value: select(read.value) } : read;
}

function join<A, B, U>(left: Read<A>, right: Read<B>, combine: (left: A, right: B) => U): Read<U> {
  if (left.status === "error" || right.status === "error") return { status: "error" };
  if (left.status === "loading" || right.status === "loading") return { status: "loading" };
  return { status: "ready", value: combine(left.value, right.value) };
}

function formatMoney(minor: number, currency: string, locale: string, signed = false): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      signDisplay: signed ? "exceptZero" : "auto",
    }).format(minor / 100);
  } catch {
    // An unknown currency code must not take the whole page down.
    return `${signed && minor > 0 ? "+" : ""}${(minor / 100).toFixed(2)} ${currency}`;
  }
}

type Format = {
  copy: (key: string) => string;
  /** "vs previous 7 days" and friends. */
  compare: string;
  count: (value: number, signed?: boolean) => string;
  money: (minor: number, currency: string, signed?: boolean) => string;
  /** Short UTC date of a series day. */
  day: (index: number) => string;
};

export function OpsOverviewPanel({ counts }: { counts: OpsQueueCounts }) {
  const { t, locale } = useTranslation();
  const searchParams = useSearchParams();
  const period = parseOverviewPeriod(searchParams.get("period"));
  // The window is a snapshot: a new period, or the active one clicked again,
  // takes a new one, and every read keyed on it runs again.
  const [range, setRange] = useState(() => resolveOverviewWindow(period));
  if (range.period !== period) setRange(resolveOverviewWindow(period));

  // RLS filters rows instead of failing, so a session without the second
  // factor would read believable zeros. Check first, read only after.
  const access = useRead(range, loadAccess);

  const copy = (key: string) => t(`platform.ops.overviewPanel.${key}`);
  const dayFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const timeFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
  const fmt: Format = {
    copy,
    compare: copy(`compare.${period}`),
    count: (value, signed = false) =>
      new Intl.NumberFormat(locale, { signDisplay: signed ? "exceptZero" : "auto" }).format(value),
    money: (minor, currency, signed = false) => formatMoney(minor, currency, locale, signed),
    day: (index) => dayFormat.format(new Date(range.start + index * DAY_MS)),
  };

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-[var(--color-ink)]">{copy("title")}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">{copy("note")}</p>
          <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
            {copy("asOf").replace("{time}", () => timeFormat.format(range.end))}
          </p>
        </div>
        <nav aria-label={copy("periodLabel")} className="flex rounded-none border border-[var(--color-line)]">
          {overviewPeriods.map((option) => (
            <Link
              key={option}
              href={`/ops?tab=overview&period=${option}`}
              aria-current={option === period ? "page" : undefined}
              onClick={option === period
                ? (event) => {
                    // Same URL, so no navigation: take a fresh window instead.
                    event.preventDefault();
                    setRange(resolveOverviewWindow(period));
                  }
                : undefined}
              className={`inline-flex min-h-11 items-center rounded-none px-3 text-sm font-semibold ${
                option === period
                  ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                  : "text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
              }`}
            >
              {copy(`periods.${option}`)}
            </Link>
          ))}
        </nav>
      </div>

      {access.status === "loading" ? (
        <p role="status" className="text-sm text-[var(--color-ink-soft)]">{copy("loading")}</p>
      ) : access.status === "ready" && access.value ? (
        <OverviewNumbers range={range} counts={counts} fmt={fmt} />
      ) : (
        <p role="alert" className="rounded-none border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-ink)]">
          {copy(access.status === "error" ? "accessError" : "secondFactor")}
        </p>
      )}
    </section>
  );
}

function OverviewNumbers({ range, counts, fmt }: { range: OverviewWindow; counts: OpsQueueCounts; fmt: Format }) {
  const users = useRead(range, loadUsers);
  const courses = useRead(range, loadCourses);
  const publications = useRead(range, loadPublications);
  const enrollments = useRead(range, loadEnrollments);
  const orders = useRead(range, loadOrders);
  const activations = useRead(range, loadActivations);

  const { copy } = fmt;
  const text = { loading: copy("loading"), loadError: copy("loadError") };
  const enrollmentSplit = (value: ReturnType<typeof summarizeEnrollments>) =>
    copy("enrollmentSplit")
      .replace("{paid}", () => fmt.count(value.paid.current))
      .replace("{free}", () => fmt.count(value.free.current));
  const refundedDetail = (lines: MoneyLine[]) =>
    lines
      .filter((line) => line.current)
      .map((line) => copy("refundedAmount").replace("{amount}", () => fmt.money(line.current, line.currency)))
      .join(" · ") || undefined;

  return (
    <>
      <TileGroup title={copy("growth")}>
        <Tile text={text} label={copy("signups")} read={pick(users, (v) => v.signups)}>
          {(value) => <CountBody fmt={fmt} measure={value} />}
        </Tile>
        <Tile text={text} label={copy("newCreators")} read={pick(users, (v) => v.creators)}>
          {(value) => <CountBody fmt={fmt} measure={value} />}
        </Tile>
        <Tile text={text} label={copy("coursesCreated")} read={pick(courses, (v) => v.created)}>
          {(value) => <CountBody fmt={fmt} measure={value} />}
        </Tile>
        <Tile text={text} label={copy("coursesPublished")} read={publications}>
          {(value) => <CountBody fmt={fmt} measure={value} />}
        </Tile>
        <Tile text={text} label={copy("liveCreators")} read={pick(courses, (v) => v.liveCreators)}>
          {(value) => (
            <>
              <p className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">{fmt.count(value)}</p>
              <p className="mt-1 text-xs text-[var(--color-ink-soft)]">{copy("now")}</p>
            </>
          )}
        </Tile>
        <Tile text={text} label={copy("enrollments")} read={enrollments}>
          {(value) => <CountBody fmt={fmt} measure={value.total} detail={enrollmentSplit(value)} />}
        </Tile>
      </TileGroup>

      <TileGroup title={copy("money")}>
        <Tile text={text} label={copy("paidOrders")} read={pick(orders, (v) => v.paidOrders)}>
          {(value) => <CountBody fmt={fmt} measure={value} />}
        </Tile>
        <Tile text={text} label={copy("grossSales")} read={pick(orders, (v) => v.gross)}>
          {(value) => <MoneyBody fmt={fmt} lines={value} />}
        </Tile>
        <Tile
          text={text}
          label={copy("platformRevenue")}
          read={join(orders, activations, (o, a) => ({
            lines: addMoney(o.platformFees, a.amount),
            activations: a.count.current,
          }))}
        >
          {(value) => (
            <MoneyBody
              fmt={fmt}
              lines={value.lines}
              detail={copy("revenueDetail").replace("{count}", () => fmt.count(value.activations))}
            />
          )}
        </Tile>
        <Tile text={text} label={copy("refunds")} read={orders}>
          {(value) => (
            <CountBody
              fmt={fmt}
              measure={value.refunds}
              upIsGood={false}
              detail={refundedDetail(value.refundedAmount)}
            />
          )}
        </Tile>
      </TileGroup>

      <TileGroup title={copy("queues")}>
        <QueueTile tab="verification" label={copy("pendingVerifications")} value={counts.pendingVerifications} />
        <QueueTile tab="support" label={copy("openTickets")} value={counts.openTickets} />
        <QueueTile tab="users" label={copy("openPrivacyRequests")} value={counts.openPrivacyRequests} />
        <QueueTile tab="community" label={copy("openReports")} value={counts.openReports} />
      </TileGroup>
    </>
  );
}

function TileGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3">
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function Tile<T>({
  label,
  read,
  text,
  children,
}: {
  label: string;
  read: Read<T>;
  text: { loading: string; loadError: string };
  children: (value: T) => ReactNode;
}) {
  return (
    <div data-tile className="min-w-0 rounded-none border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <p className="text-xs font-medium text-[var(--color-ink-soft)]">{label}</p>
      {read.status === "loading" ? (
        <p role="status" className="mt-2 text-2xl font-semibold text-[var(--color-ink-muted)]">
          <span aria-hidden="true">…</span>
          <span className="sr-only">{text.loading}</span>
        </p>
      ) : read.status === "error" ? (
        <p className="mt-2 text-sm text-[var(--color-danger-fg)]">{text.loadError}</p>
      ) : (
        children(read.value)
      )}
    </div>
  );
}

function Delta({ fmt, diff, label, upIsGood = true }: { fmt: Format; diff: number; label: string; upIsGood?: boolean }) {
  if (diff === 0) {
    return <p className="mt-1 text-xs text-[var(--color-ink-soft)]">{fmt.copy("noChange")} {fmt.compare}</p>;
  }
  // Colour says good or bad; the arrow says up or down, so colour is never alone.
  const good = diff > 0 === upIsGood;
  return (
    <p className={`mt-1 text-xs font-medium ${good ? "text-[var(--color-success-fg)]" : "text-[var(--color-danger-fg)]"}`}>
      <span aria-hidden="true">{diff > 0 ? "▲" : "▼"} </span>
      {label} {fmt.compare}
    </p>
  );
}

function CountBody({
  fmt,
  measure,
  upIsGood,
  detail,
}: {
  fmt: Format;
  measure: Measure;
  upIsGood?: boolean;
  detail?: string;
}) {
  const diff = measure.current - measure.previous;
  return (
    <>
      <p className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">{fmt.count(measure.current)}</p>
      <Delta fmt={fmt} diff={diff} label={fmt.count(diff, true)} upIsGood={upIsGood} />
      {detail ? <p className="mt-1 text-xs text-[var(--color-ink-soft)]">{detail}</p> : null}
      <Sparkline fmt={fmt} series={measure.series} />
    </>
  );
}

function MoneyBody({ fmt, lines, detail }: { fmt: Format; lines: MoneyLine[]; detail?: string }) {
  return (
    <>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{fmt.copy("none")}</p>
      ) : (
        // Never summed across currencies: one line each.
        lines.map((line) => (
          <div key={line.currency} className="mt-2 min-w-0">
            <p className="break-words text-2xl font-semibold text-[var(--color-ink)]">
              {fmt.money(line.current, line.currency)}
            </p>
            <Delta
              fmt={fmt}
              diff={line.current - line.previous}
              label={fmt.money(line.current - line.previous, line.currency, true)}
            />
          </div>
        ))
      )}
      {detail ? <p className="mt-1 text-xs text-[var(--color-ink-soft)]">{detail}</p> : null}
    </>
  );
}

// Single series, one colour: no legend (the tile label names it). Each day
// carries a native <title> tooltip. ink-muted clears 3:1 on both surfaces;
// the accent did not on white, so today gets no highlight.
function Sparkline({ fmt, series }: { fmt: Format; series: number[] }) {
  if (series.length < 2) return null;
  const max = Math.max(1, ...series);
  const slot = 100 / series.length;
  return (
    <svg
      role="img"
      aria-label={fmt.copy("perDay").replace("{values}", () => series.join(", "))}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="mt-3 block h-6 w-full"
    >
      {series.map((value, index) => {
        // 1-unit floor keeps an empty day visible as a baseline tick.
        const height = Math.max(1, (value / max) * 24);
        return (
          <rect
            key={index}
            x={index * slot + 0.5}
            y={24 - height}
            width={Math.max(0.5, slot - 1)}
            height={height}
            fill="var(--color-ink-muted)"
          >
            <title>{`${fmt.day(index)}: ${fmt.count(value)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function QueueTile({ tab, label, value }: { tab: OpsQueue; label: string; value: PlatformNavCount }) {
  const { t, locale } = useTranslation();
  return (
    <Link
      href={getOpsNavItem(tab).href}
      className="block min-w-0 rounded-none border border-[var(--color-line)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface-soft)]"
    >
      <span className="block text-xs font-medium text-[var(--color-ink-soft)]">{label}</span>
      <span className="mt-2 block text-2xl font-semibold text-[var(--color-ink)]">
        {typeof value === "number" ? (
          new Intl.NumberFormat(locale).format(value)
        ) : (
          <>
            <span aria-hidden="true">{value === "loading" ? "…" : "—"}</span>
            <span className="sr-only">{t(`platform.queueCount.${value}`)}</span>
          </>
        )}
      </span>
      <span className="mt-1 block text-xs text-[var(--color-ink-soft)]">{t("platform.ops.overviewPanel.now")}</span>
    </Link>
  );
}
