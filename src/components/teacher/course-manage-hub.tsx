"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import {
  CourseActionsMenu,
  DeleteOrArchiveCourseDialog,
} from "@/components/teacher/course-actions";
import {
  CouponsPanel,
  PanelCard,
  TaxPanel,
} from "@/components/teacher/course-commerce-panels";
import { CourseShareLink } from "@/components/teacher/course-share-link";
import { CourseOffersPanel } from "@/components/teacher/course-offers-panel";
import { CourseOverviewPanel, StatCard } from "@/components/teacher/course-overview-panel";
import { ReadinessGroups } from "@/components/teacher/readiness-groups";
import { CourseStudentRoster } from "@/components/teacher/course-student-roster";
import { CourseLandingEditor } from "@/components/teacher/course-landing-editor";
import { SalesPageEditor } from "@/components/teacher/sales-page-editor";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { PlanId } from "@/data/plans";
import { planById, refundWindowDays } from "@/data/plans";
import {
  effectiveLimit,
  formatLimit,
  lowestPlanWithQuota,
  quotaStatus,
} from "@/domain/entitlements";
import { usePublishGates } from "@/components/teacher/use-publish-gates";
import { getCourseReadiness, type CourseReadinessItem } from "@/domain/course-readiness";
import {
  getCoursePricingShape,
  type CoursePricingShape,
} from "@/domain/product-pricing";
import type { TeacherCourse } from "@/domain/teacher-course";
import { teacherCanPublishCourse } from "@/domain/teacher-course";
import { instructorPagePath } from "@/domain/user-profile";
import { countLabel } from "@/lib/i18n/count-label";
import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";
import {
  setOwnCourseFeatured,
  subscribeToTeacherCourse,
  subscribeToTeacherCourses,
} from "@/lib/data/teacher-courses";

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
  "flex min-h-11 items-center rounded-[6px] px-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]";

// Cada linha do checklist so DESCREVIA a pendencia ("Add at least one module")
// e nao levava a lugar nenhum: a pessoa lia o que faltava e tinha de caçar
// onde arrumar. Aqui fica o destino de cada linha, sempre a tela que EDITA o
// campo. Os cards "basic" e "pricing" do proprio hub sao so leitura — o botao
// deles ja manda para o construtor —, entao apontamos direto para la e
// poupamos um clique. `outcomes` e a excecao porque o hub tem editor de
// verdade (SalesPageEditor, na secao "page"), e ali a pessoa nem sai do hub.
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
    // `verification` ja tem o proprio link dentro da dica; um segundo link na
    // mesma linha, com outro rotulo e o mesmo destino, so confunde.
    default:
      return null;
  }
}

// Como o curso cobra sai INTEIRO de `getCoursePricingShape` (dominio). Ler o
// preco de um jeito aqui e o `paymentType` cru logo ali era o que fazia a mesma
// tela dizer "Free" e "Monthly subscription" sobre o mesmo rascunho.
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

/**
 * Self-serve marketplace highlight, metered by the teacher's plan.
 *
 * `used` is counted from the courses the hub already streams instead of a
 * second round-trip, and `featured` is read straight off the realtime course
 * row — so after the RPC lands, the subscription repaints this card. The
 * numbers here are the *display*; `set_own_course_featured` is what actually
 * enforces the quota, and its message is surfaced verbatim when it refuses.
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
  // The RPC's refusal is data and is shown verbatim; our own fallback is kept
  // as a dictionary key so it follows a locale switch while the card is open.
  const [error, setError] = useState<{ message: string } | { key: string } | null>(null);

  const featured = course.featured === true;
  const limit = effectiveLimit(planId, "featuredSlots");
  const quota = quotaStatus(usedSlots, limit);
  const published = course.status === "published";
  const upgradeTo = lowestPlanWithQuota("featuredSlots", 1);

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
      setError(
        toggleError instanceof Error && toggleError.message
          ? { message: toggleError.message }
          : { key: "creatorPanel.hub.highlight.updateError" }
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelCard
      title={t("creatorPanel.hub.highlight.title")}
      description={t("creatorPanel.hub.highlight.description")}
    >
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border fine-rule bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {featured ? t("creatorPanel.hub.highlight.on") : t("creatorPanel.hub.highlight.off")}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {t("creatorPanel.hub.highlight.usage")
              .replace("{used}", () => String(quota.used))
              .replace("{limit}", () => formatLimit(limit))
              .replace("{plan}", () => planById(planId).name)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleToggle()}
          disabled={saving || !canToggle}
          className={`${featured ? "button-outline" : "button-solid"} px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {saving
            ? t("creatorPanel.hub.highlight.saving")
            : featured
              ? t("creatorPanel.hub.highlight.remove")
              : t("creatorPanel.hub.highlight.add")}
        </button>
      </div>
      {gateReason ? (
        <p className="mt-3 text-xs leading-5 text-[var(--color-ink-muted)]">
          {gateReason}
          {quota.lockedOnPlan ? (
            <>
              {" "}
              <Link href="/account/plans" className="font-semibold text-[var(--color-primary)] underline">
                {t("creatorPanel.hub.highlight.seePlans")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs font-semibold text-[var(--color-accent-fg)]">
          {"message" in error ? error.message : t(error.key)}
        </p>
      ) : null}
    </PanelCard>
  );
}

export function CourseManageHub({ courseId }: { courseId: string }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-link from studio checklist (?section=pricing) — read during render
  // (no setState-in-effect) so eslint react-hooks/set-state-in-effect stays clean.
  const sectionFromUrl = (() => {
    const raw = searchParams?.get("section") ?? "";
    return raw && allSectionIds.has(raw) ? (raw as SectionId) : null;
  })();
  const [course, setCourse] = useState<TeacherCourse | null>(null);
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

  useEffect(() => {
    const menu = menuRef.current;
    const viewport = menu?.closest<HTMLElement>(".platform-content");
    if (!menu || !viewport) return;

    // Both platform and course headers consume space. Measure the menu's
    // normal-flow row so even its bottom fits before the outer page scrolls.
    const updateLayout = () => {
      const style = getComputedStyle(viewport);
      const rowTop = menu.parentElement!.getBoundingClientRect().top;
      const offset = rowTop - viewport.getBoundingClientRect().top + viewport.scrollTop;
      const height = viewport.clientHeight - offset - parseFloat(style.paddingBottom);
      menu.style.setProperty("--course-nav-height", `${Math.max(0, height)}px`);

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
      const menuBounds = menu.getBoundingClientRect();
      if (buttonBounds.top < menuBounds.top) {
        menu.scrollTop += buttonBounds.top - menuBounds.top;
      } else if (buttonBounds.bottom > menuBounds.bottom) {
        menu.scrollTop += buttonBounds.bottom - menuBounds.bottom;
      }
    };
    updateLayout();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateLayout);
    observer?.observe(viewport);
    const courseHeader = menu.parentElement?.previousElementSibling;
    if (courseHeader) observer?.observe(courseHeader);
    return () => observer?.disconnect();
  }, [courseLoaded, course?.id, section]);

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeToTeacherCourses(user.uid, setMyCourses, () => undefined);
  }, [user]);

  const isOwner = Boolean(course && user && course.ownerId === user.uid);
  // Server-enforced by the commerce RPCs; surfaced here so the panels can
  // explain the gate instead of failing on click.
  const activationBlocked = account.verificationRequired && !account.verificationApproved;

  if (!courseLoaded) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorPanel.hub.loading")}</p>
      </section>
    );
  }

  // ProtectedSurface guarantees a signed-in user here, so a null user is
  // treated the same as a non-owner instead of bypassing the guard.
  if (!course || !user || !isOwner) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
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

  // A mesma lista que o construtor mostra no chip, na barra e no rodape. Antes
  // o Manage tinha regra propria (titulo+resumo num item so, sem parcelas) e
  // o mesmo curso aparecia com tres porcentagens diferentes.
  const readiness = getCourseReadiness(course, account);
  const pricing = getCoursePricingShape(course);
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
    <div className="grid gap-5">
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
            <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-[6px] border fine-rule bg-[var(--color-surface-soft)]">
              {course.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={course.coverImageUrl}
                  alt={t("creatorPanel.hub.header.coverAlt").replace(
                    "{title}",
                    () => course.title || t("creatorPanel.hub.header.courseFallback")
                  )}
                  className="h-full w-full object-cover"
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
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {switchableCourses.length > 0 ? (
              <select
                aria-label={t("creatorPanel.hub.header.switchCourse")}
                value={course.id}
                onChange={(event) => router.push(`/teach/courses/${event.target.value}/manage`)}
                className="min-h-11 rounded-[6px] border fine-rule bg-white px-3 py-2 text-xs font-semibold text-[var(--color-ink)]"
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
            {/* Mesma posicao da Hotmart: o caret ao lado do seletor de produto.
                E a unica entrada do professor para tirar o curso do ar — antes
                so o admin conseguia, pelo /ops. */}
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
                className="flex min-h-11 w-full items-center rounded-[6px] border-t border-[var(--color-line)] px-3 text-left text-sm font-semibold text-[var(--color-danger-fg)] hover:bg-[var(--color-danger-soft)]"
              >
                {t("creatorPanel.hub.header.deleteCourse")}
              </button>
            </CourseActionsMenu>
          </div>
        </div>
        {course.status === "inactive" ? (
          // Arquivar sem dizer o que fazer depois deixa o professor achando que
          // perdeu o curso. O chip diz o estado; esta linha diz a saida.
          <InlineAlert tone="warning" className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{t("creatorPanel.hub.header.archivedNotice")}</span>
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
            // Apagado, este hub nao existe mais: a assinatura em tempo real
            // devolveria "curso nao encontrado" no lugar da tela. Arquivado,
            // ela mesma traz o novo status e o chip troca sozinho.
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
          className="min-w-0 border-b border-[var(--color-line)] bg-white pb-2 lg:sticky lg:top-4 lg:max-h-[var(--course-nav-height)] lg:overflow-y-auto lg:overscroll-contain lg:rounded-[8px] lg:border lg:p-2"
        >
          <p className="hidden px-2 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)] lg:block">
            {t("creatorPanel.hub.nav.manage")}
          </p>
          <div className="flex gap-1 overflow-x-auto lg:grid">
            {manageSections.map((item) => (
              <button
                key={item.id}
                ref={section === item.id ? activeSectionRef : undefined}
                type="button"
                onClick={() => setSection(item.id)}
                className={`min-h-11 shrink-0 whitespace-nowrap rounded-[6px] border-b-2 px-3 py-2 text-left text-sm font-semibold transition lg:w-full lg:border-b-0 lg:border-l-2 ${
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
                type="button"
                onClick={() => setSection(item.id)}
                className={`rounded-[8px] px-3 py-2 text-left text-sm font-semibold transition ${
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
          {/* A ordem depende do estado do produto. PUBLICADO: o painel vem
              primeiro, porque quem abre esta tela abre para saber como o
              produto esta indo. AINDA NAO PUBLICADO: os numeros sao todos
              vazios ("ninguem comprou ainda", "nenhuma atividade") e o
              professor tinha de rolar tres caixas vazias para descobrir o que
              falta para publicar — entao o checklist sobe e o painel desce. */}
          {section === "overview" && published ? (
            <CourseOverviewPanel course={course} />
          ) : null}

          {section === "overview" ? (
            <PanelCard
              title={t("creatorPanel.hub.checklist.title")}
              description={t(`creatorPanel.hub.status.${course.status}`)}
            >
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-surface-hover)]">
                <div
                  data-testid="publish-readiness-bar"
                  className="h-full rounded-full bg-[var(--color-primary)] transition-all"
                  style={{ width: `${readiness.percent}%` }}
                />
              </div>
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                {t("creatorPanel.hub.checklist.progress")
                  .replace("{done}", () => String(readiness.doneCount))
                  .replace("{total}", () => String(readiness.total))
                  .replace("{percent}", () => String(readiness.percent))}
              </p>
              <ReadinessGroups
                readiness={readiness}
                className="mt-4 grid gap-5"
                renderItem={(item) => {
                  const editHref = readinessEditHref(item, course.id);
                  return (
                    // Linha pronta ganha o verde suave da casa (o mesmo do
                    // InlineAlert tone="success"): a pessoa varre a lista e ve
                    // onde ainda falta sem ler item por item.
                    <li
                      key={item.id}
                      data-readiness-item={item.id}
                      className={`flex items-start gap-3 rounded-[10px] px-3 py-2 ${
                        item.done ? "bg-[var(--color-success-soft)]" : ""
                      }`}
                    >
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
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--color-ink)]">
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
                        // Rotulo visivel curto, nome acessivel completo: sao
                        // ate onze links "Edit" na mesma lista e um leitor de
                        // tela precisa saber qual e qual.
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
                <div className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.18)] bg-white px-4 py-3">
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
              {/* A vitrine do criador e a terceira porta de venda: sai na mesma
                  base publica da pagina do produto, com o mesmo trio de botoes. */}
              <CourseShareLink
                label={t("creatorPanel.hub.links.storefront")}
                path={instructorPagePath(course.ownerId)}
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
            <div className="grid gap-4">
              <PanelCard
                title={t("creatorPanel.hub.pricing.title")}
                description={t("creatorPanel.hub.pricing.description")}
              >
                {/* Era uma lista chave-valor: quatro linhas do mesmo tamanho,
                    nenhuma delas o preco. Vira o mesmo tile do Painel, com o
                    numero grande — e o prazo de reembolso, que a pessoa so
                    achava no Termos, entra como o quarto. Quatro tiles enchem
                    as quatro colunas, o 2x2 e a coluna unica: nenhum orfao. */}
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
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
                    label={t("creatorPanel.hub.pricing.refundWindow")}
                    value={t("creatorPanel.hub.pricing.refundWindowDays").replace("{days}", () =>
                      String(refundWindowDays)
                    )}
                    hint={t("creatorPanel.hub.pricing.refundWindowHint")}
                  />
                  <StatCard
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
              </PanelCard>
              <CourseOffersPanel
                courseId={course.id}
                courseTitle={courseTitle}
                coursePricing={pricing}
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
                      className="rounded-[10px] border fine-rule bg-white px-4 py-3"
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

          {section === "students" ? <CourseStudentRoster courseId={course.id} /> : null}

          {section === "page" ? (
            <div className="grid gap-4">
              <SalesPageEditor course={course} />
              {/* The block editor sits below the title/summary form rather than
                  replacing it: those fields also feed the marketplace card and
                  the course header, so they are not page-only copy. */}
              <CourseLandingEditor course={course} />
              <PanelCard
                title={t("creatorPanel.hub.page.title")}
                description={t("creatorPanel.hub.page.description")}
              >
                <Link
                  href={`/courses/${course.id}`}
                  className="button-solid mt-5 inline-flex px-4 py-2 text-xs"
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
                    label: t("platform.nav.integrations"),
                    detail: t("creatorPanel.hub.tools.integrationsDetail"),
                    href: "/teach/integrations",
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
                    className="rounded-[8px] border fine-rule bg-white px-4 py-3 hover:bg-[var(--color-surface-soft)]"
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
