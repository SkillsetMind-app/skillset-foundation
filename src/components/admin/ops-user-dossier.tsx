"use client";

import { ArrowLeft, Shield } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { AccountControlDialog } from "@/components/admin/account-control-dialog";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { Button, InlineAlert } from "@/components/ui";
import { getOpsNavItem } from "@/data/site";
import {
  getOpsUserDossier,
  type DossierCountMap,
  type DossierMoneyGroup,
  type OpsUserDossier,
} from "@/lib/data/ops-users";

const copy = "platform.ops.userDossier";
type LoadError = "mfaRequired" | "missing" | "loadError";

// A ordem das perguntas é a do formulário de entrada (onboarding-wizard.tsx).
const ANSWER_ORDER = [
  "profession",
  "sourceOfDiscovery",
  "alreadySold",
  "monthlyRevenue",
  "primaryGoal",
  "instagramHandle",
  "audienceSize",
] as const;
const LAST_30_ORDER = ["lessons_completed", "posts", "comments", "lesson_comments", "messages"] as const;
const PATH_KEYS: Record<string, string> = {
  student: "authFlow.onboarding.studentPath",
  teacher: "authFlow.onboarding.teacherPath",
};

// Só recusa conhecida vira texto; diagnóstico do provedor nunca vai para a tela.
function errorKey(caught: unknown): LoadError {
  const message = typeof caught === "object" && caught !== null && "message" in caught ? caught.message : null;
  if (message === "OPS_ADMIN_MFA_REQUIRED") return "mfaRequired";
  if (message === "USER_DOSSIER_USER_MISSING") return "missing";
  return "loadError";
}

function formatDate(value: string | null, locale: string, withTime = false): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
}

// Casas decimais vêm da moeda (JPY tem 0, USD tem 2), não de uma divisão fixa por 100.
function formatMinor(amount: number, currency: string | null, locale: string): string {
  if (!currency) return String(amount);
  try {
    const format = new Intl.NumberFormat(locale, { style: "currency", currency });
    return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
  } catch {
    return `${amount} ${currency}`;
  }
}

// Respostas e campos jsonb livres: lista vira texto separado por vírgula.
function plainValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value.filter((item) => typeof item === "string" && item.trim()) as string[];
    return items.length ? items.join(", ") : null;
  }
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-[14px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)] sm:p-6">
      <h3 className="text-base font-bold text-[var(--color-ink)]">{title}</h3>
      <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="mt-1 break-words text-[var(--color-ink)]">{children}</dd>
    </div>
  );
}

const listClass = "mt-2 grid gap-1 text-xs text-[var(--color-ink-soft)]";

export function OpsUserDossierPanel({ uid }: { uid: string }) {
  const { t, locale } = useTranslation();
  const [dossier, setDossier] = useState<OpsUserDossier | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [reload, setReload] = useState(0);
  const [controlOpen, setControlOpen] = useState(false);

  useEffect(() => {
    let current = true;
    getOpsUserDossier(uid)
      .then((next) => { if (current) setDossier(next); })
      .catch((caught) => { if (current) { setDossier(null); setError(errorKey(caught)); } });
    return () => { current = false; };
  }, [uid, reload]);

  const back = (
    <Link href={getOpsNavItem("users").href}
      className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4">
      <ArrowLeft size={16} aria-hidden />{t(`${copy}.back`)}
    </Link>
  );

  if (error) {
    return (
      <div className="grid min-w-0 gap-4">
        {back}
        <InlineAlert tone="error" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t(`${copy}.${error}`)}</span>
          {error === "mfaRequired" ? (
            <Link href="/account/security" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
              {t(`${copy}.setUpMfa`)}
            </Link>
          ) : error === "loadError" ? (
            <Button variant="outline" className="min-h-11" onClick={() => { setError(null); setReload((value) => value + 1); }}>
              {t("authFlow.loading.retry")}
            </Button>
          ) : null}
        </InlineAlert>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="grid min-w-0 gap-4">
        {back}
        <p role="status" className="text-sm text-[var(--color-ink-soft)]">{t(`${copy}.loading`)}</p>
      </div>
    );
  }

  const { identity, onboarding, access, learning, behavior, timeline, purchases, creator, community, support, audit } = dossier;
  const privacy = dossier.privacy_requests;
  const none = t(`${copy}.none`);
  const f = (key: string) => t(`${copy}.fields.${key}`);
  const s = (key: string) => t(`${copy}.sections.${key}`);
  const date = (value: string | null, withTime = false) => formatDate(value, locale, withTime) ?? none;
  const yesNo = (value: boolean | null) => t(`${copy}.${value ? "yes" : "no"}`);
  const accepted = (at: string | null, version: string | null) => at ? `${date(at)}${version ? ` · ${version}` : ""}` : none;
  const status = access.blocked_email ? "blocked" : access.suspended ? "suspended" : "active";
  const statusChip = <StatusChip status={status} label={t(`platform.ops.userTable.status.${status}`)} />;
  const counts = (map: DossierCountMap) => {
    const entries = Object.entries(map);
    return entries.length === 0 ? none : (
      <span className="flex flex-wrap gap-2">
        {entries.map(([key, n]) => <span key={key} className="inline-flex items-center gap-1"><StatusChip status={key} /> {n}</span>)}
      </span>
    );
  };
  const money = (groups: DossierMoneyGroup[]) => groups.length === 0 ? none : (
    <ul className="grid gap-1">
      {groups.map((group) => (
        <li key={`${group.status}-${group.currency}`} className="flex flex-wrap items-center gap-2">
          <StatusChip status={group.status ?? "unknown"} /> {group.n} · {formatMinor(group.amount_minor, group.currency, locale)}
          {group.refunded_minor > 0
            ? ` · ${t(`${copy}.refunded`).replace("{amount}", () => formatMinor(group.refunded_minor, group.currency, locale))}`
            : ""}
        </li>
      ))}
    </ul>
  );
  const answer = (key: (typeof ANSWER_ORDER)[number]) => {
    const value = onboarding.answers[key];
    if (key === "alreadySold" && (value === "yes" || value === "no")) {
      return t(value === "yes" ? "authFlow.onboarding.alreadySelling" : "authFlow.onboarding.notSellingYet");
    }
    return plainValue(value) ?? t(`${copy}.notAnswered`);
  };
  const path = onboarding.path === "both"
    ? `${t(PATH_KEYS.student)} + ${t(PATH_KEYS.teacher)}`
    : onboarding.path && PATH_KEYS[onboarding.path] ? t(PATH_KEYS[onboarding.path]) : onboarding.path ?? none;
  const activation = creator.activation_fee_paid_at
    ? f("activationPaid").replace("{date}", () => date(creator.activation_fee_paid_at))
    : creator.activation_waiver
      ? f("activationWaived").replace("{date}", () => date(creator.activation_waiver?.granted_at ?? null))
      : f("activationPending");
  const last30 = LAST_30_ORDER.map((key) => `${behavior.last_30_days?.[key] ?? 0} ${t(`${copy}.last30.${key}`)}`).join(" · ");
  const verificationCase = creator.verification_case;
  const evidence = verificationCase ? plainValue(verificationCase.evidence_links) : null;

  return (
    <div className="grid min-w-0 gap-5">
      {controlOpen ? (
        <AccountControlDialog uid={identity.uid} label={identity.email || identity.display_name || identity.uid}
          onClose={() => { setControlOpen(false); setReload((value) => value + 1); }} />
      ) : null}
      {back}

      <header className="min-w-0 rounded-[14px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-bold text-[var(--color-ink)]">{identity.display_name || t(`${copy}.unnamed`)}</h2>
            <p className="mt-1 break-all text-sm text-[var(--color-ink-soft)]">{identity.email ?? none}</p>
            <p className="mt-1 break-all text-xs text-[var(--color-ink-soft)]">UID: {identity.uid}</p>
          </div>
          {statusChip}
        </div>
        {identity.is_self ? <InlineAlert tone="warning" className="mt-4">{t(`${copy}.self`)}</InlineAlert> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11 max-w-full whitespace-normal" disabled={identity.is_self}
            onClick={() => setControlOpen(true)}>
            <Shield size={16} className="shrink-0" aria-hidden />{t("accountControls.title")}
          </Button>
        </div>
      </header>

      <Section title={s("onboarding")}>
        <Fact label={f("path")}>{path}</Fact>
        <Fact label={f("onboardingCompleted")}>{onboarding.completed ? date(onboarding.completed_at) : yesNo(false)}</Fact>
        {ANSWER_ORDER.map((key) => <Fact key={key} label={t(`${copy}.answers.${key}`)}>{answer(key)}</Fact>)}
        <Fact label={f("goals")}>{plainValue(onboarding.goals) ?? none}</Fact>
        <Fact label={f("credentials")}>{plainValue(onboarding.credentials) ?? none}</Fact>
        <Fact label={f("bio")}>{onboarding.bio || none}</Fact>
        <Fact label={f("phone")}>{onboarding.phone_number || none}</Fact>
        <Fact label={f("timezone")}>{onboarding.timezone || none}</Fact>
        <Fact label={f("marketingConsent")}>{yesNo(onboarding.marketing_consent)}</Fact>
        <Fact label={f("termsAccepted")}>{accepted(onboarding.terms_accepted_at, onboarding.terms_version)}</Fact>
        <Fact label={f("privacyAccepted")}>{accepted(onboarding.privacy_accepted_at, onboarding.privacy_version)}</Fact>
        <Fact label={f("teacherTermsAccepted")}>{accepted(onboarding.teacher_terms_accepted_at, onboarding.teacher_terms_version)}</Fact>
      </Section>

      <Section title={s("behavior")}>
        <Fact label={f("lastActivity")}>{date(behavior.last_activity_at, true)}</Fact>
        <Fact label={f("last30Days")}>{last30}</Fact>
        <Fact label={f("lessonsCompleted")}>{behavior.lessons_completed}</Fact>
        <Fact label={f("lessonsOpened")}>{behavior.lessons_opened}</Fact>
        <Fact label={f("messagesSent")}>{behavior.messages_sent}</Fact>
        <Fact label={f("wishlist")}>{behavior.wishlist}</Fact>
        <Fact label={f("points")}>{behavior.points ?? none}</Fact>
        <Fact label={f("advisor")}>
          {behavior.advisor.conversations > 0
            ? `${t(`${copy}.advisorSummary`)
              .replace("{conversations}", () => String(behavior.advisor.conversations))
              .replace("{messages}", () => String(behavior.advisor.messages))} · ${date(behavior.advisor.last_used_at)}`
            : none}
        </Fact>
      </Section>

      <Section title={s("timeline")}>
        <Fact label={s("timeline")}>
          {timeline.length ? (
            <ul className="grid gap-2">
              {timeline.map((event, index) => (
                <li key={`${event.kind}-${event.at}-${index}`} className="break-words">
                  {date(event.at, true)} · {t(`${copy}.timelineKinds.${event.kind}`)}{event.label ? ` · ${event.label}` : ""}
                </li>
              ))}
            </ul>
          ) : none}
        </Fact>
      </Section>

      <Section title={s("access")}>
        <Fact label={f("accountStatus")}>{statusChip}</Fact>
        {access.blocked_email ? <Fact label={f("blockedEmail")}>{access.blocked_email}</Fact> : null}
        <Fact label={f("username")}>{identity.username ?? none}</Fact>
        <Fact label={f("joined")}>{date(identity.created_at)}</Fact>
        <Fact label={f("lastSignIn")}>{date(access.last_sign_in_at, true)}</Fact>
        <Fact label={f("emailConfirmed")}>{date(access.email_confirmed_at)}</Fact>
        <Fact label={f("providers")}>{access.providers.length ? access.providers.join(", ") : none}</Fact>
        <Fact label={f("factors")}>{access.verified_factors}</Fact>
        <Fact label={f("sessions")}>{access.sessions_since_cutoff}</Fact>
      </Section>

      <Section title={s("learning")}>
        <Fact label={f("enrollments")}>
          {counts(learning.enrollments_by_status)}
          {learning.recent_enrollments.length ? (
            <ul className={listClass}>
              {learning.recent_enrollments.map((entry) => (
                <li key={entry.id} className="break-words">
                  {entry.course_title ?? entry.course_id ?? entry.id} · {entry.status ?? ""} · {Math.round(Number(entry.progress_percent ?? 0))}%
                </li>
              ))}
            </ul>
          ) : null}
        </Fact>
        <Fact label={f("certificates")}>{learning.certificates}</Fact>
        <Fact label={f("courseSubscriptions")}>{counts(learning.course_subscriptions_by_status)}</Fact>
      </Section>

      <Section title={s("purchases")}>
        <Fact label={f("orders")}>
          {money(purchases.orders)}
          {purchases.recent_orders.length ? (
            <ul className={listClass}>
              {purchases.recent_orders.map((order) => (
                <li key={order.id} className="break-words">
                  {order.course_title ?? order.id} · {order.status ?? ""} · {formatMinor(order.amount_minor ?? 0, order.currency, locale)} · {date(order.created_at)}
                </li>
              ))}
            </ul>
          ) : null}
        </Fact>
        <Fact label={f("plan")}>
          {purchases.plan_subscription
            ? `${purchases.plan_subscription.plan_id ?? ""} · ${purchases.plan_subscription.status ?? ""}`
            : none}
        </Fact>
        <Fact label={f("stripeCustomer")}>{purchases.stripe_customer_id ?? none}</Fact>
      </Section>

      <Section title={s("creator")}>
        <Fact label={f("verification")}>{creator.verification_status ? <StatusChip status={creator.verification_status} /> : none}</Fact>
        <Fact label={f("activation")}>{activation}</Fact>
        <Fact label={f("verificationCase")}>
          {verificationCase ? (
            <span className="grid gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <StatusChip status={verificationCase.status ?? "pending"} /> {verificationCase.profession ?? ""} · {date(verificationCase.created_at)}
              </span>
              {verificationCase.registration_id ? (
                <span className="text-xs text-[var(--color-ink-soft)]">
                  {f("registration")}: {[verificationCase.registration_type, verificationCase.registration_region, verificationCase.registration_id].filter(Boolean).join(" · ")}
                </span>
              ) : null}
              {evidence ? <span className="break-all text-xs text-[var(--color-ink-soft)]">{f("evidence")}: {evidence}</span> : null}
              <span className="text-xs text-[var(--color-ink-soft)]">{f("document")}: {verificationCase.has_document ? f("documentSent") : none}</span>
              {verificationCase.note ? <span className="text-xs text-[var(--color-ink-soft)]">{verificationCase.note}</span> : null}
              {verificationCase.review_note ? <span className="text-xs text-[var(--color-ink-soft)]">{f("reviewNote")}: {verificationCase.review_note}</span> : null}
            </span>
          ) : none}
        </Fact>
        <Fact label={f("connect")}>
          {creator.connect.account_id
            ? `${creator.connect.status ?? ""} · ${f("charges")}: ${yesNo(creator.connect.charges_enabled)} · ${f("payouts")}: ${yesNo(creator.connect.payouts_enabled)}`
            : none}
        </Fact>
        <Fact label={f("courses")}>
          {counts(creator.courses_by_status)}
          {creator.courses.length ? (
            <ul className={listClass}>
              {creator.courses.map((course) => (
                <li key={course.id} className="break-words">
                  {course.title ?? course.slug ?? course.id} · {course.status ?? ""} · {course.enrollment_count ?? 0}
                </li>
              ))}
            </ul>
          ) : null}
        </Fact>
        <Fact label={f("sales")}>{money(creator.sales)}</Fact>
      </Section>

      <Section title={s("community")}>
        <Fact label={f("posts")}>{community.posts}</Fact>
        <Fact label={f("comments")}>{community.comments}</Fact>
        <Fact label={f("lessonComments")}>{community.lesson_comments}</Fact>
        <Fact label={f("reportsFiled")}>{community.reports_filed}</Fact>
        <Fact label={f("reportsAgainst")}>{counts(community.reports_against_by_status)}</Fact>
        <Fact label={f("tickets")}>
          {counts(support.tickets_by_status)}
          {support.recent_tickets.length ? (
            <ul className={listClass}>
              {support.recent_tickets.map((ticket) => (
                <li key={ticket.id} className="break-words">{ticket.subject ?? ticket.id} · {ticket.status ?? ""} · {date(ticket.created_at)}</li>
              ))}
            </ul>
          ) : null}
        </Fact>
      </Section>

      <Section title={s("privacy")}>
        <Fact label={s("privacy")}>
          {privacy.length ? (
            <ul className="grid gap-2">
              {privacy.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-2">
                  {request.type ?? ""} <StatusChip status={request.status ?? "pending"} /> {date(request.requested_at)}
                </li>
              ))}
            </ul>
          ) : none}
        </Fact>
      </Section>

      <Section title={s("audit")}>
        <Fact label={f("onUser")}>
          {audit.on_user.length ? (
            <ul className="grid gap-2">
              {audit.on_user.map((entry) => (
                <li key={entry.id} className="break-words">
                  {entry.action ?? entry.summary} · {entry.actor_email ?? ""} · {date(entry.created_at, true)}
                  {entry.reason ? ` · ${f("reason")}: ${entry.reason}` : ""}
                </li>
              ))}
            </ul>
          ) : none}
        </Fact>
        <Fact label={f("byUser")}>
          {audit.by_user.length ? (
            <ul className="grid gap-2">
              {audit.by_user.map((entry) => (
                <li key={entry.id} className="break-words">
                  {entry.action ?? entry.summary} · {entry.target_type ?? ""} {entry.target_id ?? ""} · {date(entry.created_at, true)}
                </li>
              ))}
            </ul>
          ) : none}
        </Fact>
      </Section>
    </div>
  );
}
