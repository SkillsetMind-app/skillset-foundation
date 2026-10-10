"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  Circle,
  FileDown,
  Layers3,
  Plus,
  Store,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { TeacherOverviewMetrics } from "@/components/teacher/teacher-overview-metrics";
import { StudioRecentActivity } from "@/components/teacher/studio-recent-activity";
import { StudioStorefrontCard } from "@/components/teacher/studio-storefront-card";
import { TeacherStudioInsights } from "@/components/teacher/teacher-studio-insights";
import { TeacherWelcomeTour } from "@/components/teacher/teacher-welcome-tour";
import { usePublishGates } from "@/components/teacher/use-publish-gates";
import { EmptyState, buttonClasses } from "@/components/ui";
import { DrawnCheck, MilestoneSeal, useJustDone } from "@/components/ui/drawn-check";
import { SpotArt } from "@/components/ui/spot-art";
import { activationFeeUsd } from "@/data/plans";
import type { CourseReadinessAccount } from "@/domain/course-readiness";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { logSubscriptionError } from "@/lib/data/subscription-error";

type ProductFilter = "all" | "draft" | "published" | "in_review" | "other";

export function TeacherStudioDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  // As mesmas travas que o construtor e o Manage leem: payouts, e verificacao
  // so quando a plataforma exige.
  const { account, loaded: gatesLoaded, verificationStatus } = usePublishGates(user);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "";
  // A taxa unica de ativacao vem do mesmo hook (o MESMO predicado que o
  // servidor aplica no publish, falha aberta): uma leitura so por visita.
  const activationBlocked = account.activationBlocked ?? false;

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
        setCoursesFailed(true);
        setCoursesLoaded(true);
      }
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    // Cursos, pedidos e perfil eram lidos 3x, 3x e 2x por /teach: cada bloco
    // da Home abria a propria leitura. Agora a Home le uma vez e repassa.
    return subscribeToTeacherOrders(
      user.uid,
      setOrders,
      logSubscriptionError("TeacherStudioDashboard.orders")
    );
  }, [user]);

  // "inactive" e um curso que ja esteve no ar (o admin tirou): ja houve publish.
  const launched = courses.some(
    (course) => course.status === "published" || course.status === "inactive"
  );
  // Arquivado tambem e "inactive": saiu da venda e nao cobra Stripe.
  const needsStripe = courses.some(
    (course) => course.status !== "inactive" && sellsPaid(course)
  );
  const payoutsPending = needsStripe && !account.payoutsReady;
  const greetingKey = !coursesLoaded
    ? "hello"
    : courses.length > 0 || coursesFailed
      ? "welcomeBack"
      : "welcome";

  return (
    <div className="grid gap-8">
      {user ? <TeacherWelcomeTour key={user.uid} userId={user.uid} firstName={firstName} /> : null}
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--color-line)] pb-5">
        <div>
          {/* Uma manchete por tela. O olho da pagina era "Producer home" em
              versalete APOIADO por "Welcome back, {name}" logo abaixo: dois
              titulos disputando a mesma linha de leitura, e o de cima nem
              nomeava a tela ("Home" ja esta na barra e na trilha do topo). */}
          {/* "Welcome back" so para quem ja tem produto: na 1a visita a frase
              era falsa. Enquanto a lista carrega vale "Welcome", que nunca
              mente. Antes de a lista chegar nao da para saber qual das duas e
              verdade: vale "Hello", que nao afirma nada. Se a assinatura de
              cursos falhar, fica o "Welcome back" de antes. */}
          <h1 className="text-3xl font-semibold leading-tight text-[var(--color-primary)] sm:text-4xl">
            {firstName
              ? t(`teach.dashboard.${greetingKey}Named`).replace("{name}", () => firstName)
              : t(`teach.dashboard.${greetingKey}`)}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("creatorPanel.home.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/teach/storefront" className="button-outline px-4 text-sm">
            <Store aria-hidden="true" size={16} strokeWidth={1.9} />
            {t("creatorPanel.home.storefront")}
          </Link>
          <Link
            href="/teach/builder?newCourse=1&format=course"
            className="button-solid px-4 text-sm"
          >
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            {t("creatorPanel.newProduct")}
          </Link>
        </div>
      </header>

      <StudioNextSteps
        courses={courses}
        ready={coursesLoaded && gatesLoaded}
        account={account}
        verificationStatus={verificationStatus}
        needsStripe={needsStripe}
        activationBlocked={activationBlocked}
        launched={launched}
      />

      <StudioProductsSection courses={courses} coursesLoaded={coursesLoaded} />

      <div className="grid gap-8 lg:grid-cols-2">
        <StudioRecentActivity courses={courses} orders={orders} />
        {user ? (
          <StudioStorefrontCard
            uid={user.uid}
            courses={courses}
            coursesLoaded={coursesLoaded}
            verificationStatus={verificationStatus}
          />
        ) : null}
      </div>

      <StudioSellFormatsSection />

      {/* Antes do 1o publish a lista de passos e o unico guia: os marcos e a
          lista de atencao repetiam os mesmos passos em outra ordem. */}
      {launched ? (
        <StudioEvolution
          courses={courses}
          coursesLoaded={coursesLoaded}
          payoutsReady={account.payoutsReady}
          verificationApproved={account.verificationApproved}
        />
      ) : null}

      <TeacherOverviewMetrics courses={courses} orders={orders} isLoading={!coursesLoaded} />
      {launched ? (
        <TeacherStudioInsights courses={courses} orders={orders} payoutsPending={payoutsPending} />
      ) : null}
    </div>
  );
}

function StudioNextSteps({
  courses,
  ready,
  account,
  verificationStatus,
  needsStripe,
  activationBlocked,
  launched,
}: {
  courses: TeacherCourse[];
  // Cursos e travas carregados. Antes disso a lista ainda pode ganhar um passo
  // (verificacao exigida) e a porcentagem pularia: contagem e % ficam neutras.
  ready: boolean;
  account: CourseReadinessAccount;
  verificationStatus: string | null;
  needsStripe: boolean;
  activationBlocked: boolean;
  launched: boolean;
}) {
  const { t } = useTranslation();
  // Os passos sao as travas reais do publish (getCourseReadiness via
  // usePublishGates): o Stripe so para produto pago, a verificacao so quando a
  // plataforma exige. Antes o passo 2 cobrava verificacao APROVADA de todo
  // mundo, nao havia passo de publicar e a barra parava em 67%.
  const steps = [
    ...(account.planRequired
      ? [{
          id: "plan",
          label: t("creatorEditor.readiness.items.plan.label"),
          detail: t("creatorEditor.readiness.items.plan.hint"),
          href: "/account/billing",
          done: false,
          action: t("creatorEditor.builder.publish.managePlan"),
        }]
      : []),
    {
      id: "create",
      label: t("creatorPanel.home.steps.create"),
      detail: t("creatorPanel.home.steps.createDetail"),
      href: "/teach/builder?newCourse=1&format=course",
      done: courses.length > 0,
      action: t("creatorPanel.createProduct"),
    },
    ...(needsStripe
      ? [
          {
            id: "payouts",
            label: t("platform.banner.connectPayoutsCta"),
            // A frase da antiga faixa amarela fixa do topo do /teach: o
            // comprador paga NA conta do professor.
            detail: t("platform.banner.connectPayouts"),
            href: "/account/payments#stripe-connect",
            done: account.payoutsReady,
            action: t("platform.banner.connectPayoutsCta"),
          },
        ]
      : []),
    ...(account.verificationRequired
      ? [
          {
            id: "verification",
            label: t("creatorEditor.readiness.items.verification.label"),
            detail: t("creatorEditor.readiness.items.verification.hint"),
            href: "/teach/verification",
            done: account.verificationApproved,
            // Em analise nao se "comeca" de novo; pedido de ajuste ou recusa
            // se resolve editando a solicitacao.
            action: t(
              verificationStatus === "pending"
                ? "professionalBadge.inReview"
                : verificationStatus === "needs_changes" || verificationStatus === "rejected"
                  ? "professionalBadge.edit"
                  : "creatorPanel.home.steps.verifyAction"
            ),
          },
        ]
      : []),
    {
      id: "publish",
      label: t("creatorPanel.home.steps.publish"),
      // Com a taxa exigida e nao paga, o servidor recusa o publish sem ela: a
      // Home avisa antes, com o mesmo "Activate and publish" do construtor.
      detail: activationBlocked
        ? t("creatorPanel.home.steps.publishActivateDetail").replace(
            "{amount}",
            () => String(activationFeeUsd)
          )
        : t("creatorPanel.home.steps.publishDetail"),
      href: courses[0]
        ? `/teach/builder?courseId=${encodeURIComponent(courses[0].id)}&tab=review`
        : "/teach/builder?newCourse=1&format=course",
      done: launched,
      action: t(
        activationBlocked
          ? "creatorPanel.home.steps.publishActivateAction"
          : "creatorPanel.home.steps.publishAction"
      ),
    },
  ];
  const completeCount = steps.filter((step) => step.done).length;
  const progress = Math.round((completeCount / steps.length) * 100);
  const nextStep = steps.find((step) => !step.done) ?? steps[steps.length - 1];
  // O check se desenha e o selo cresce so no passo que ficou pronto com a
  // Home aberta; quem chega com tudo pronto ve tudo parado.
  const justDone = useJustDone(steps.filter((step) => step.done).map((step) => step.id), ready);

  return (
    <section
      aria-labelledby="next-steps-title"
      className="border-y border-[var(--color-line)] bg-white"
    >
      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.65fr)]">
        <div className="px-4 py-5 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {t("creatorPanel.home.nextSteps.eyebrow")}
              </p>
              <h2
                id="next-steps-title"
                className="mt-1 text-xl font-semibold text-[var(--color-primary)]"
              >
                {t("creatorPanel.home.nextSteps.title")}
              </h2>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold tabular-nums text-[var(--color-primary)]">
                {ready ? `${progress}%` : "-"}
              </p>
              <p className="text-xs text-[var(--color-ink-muted)]">
                {ready
                  ? t("creatorPanel.home.nextSteps.progress")
                      .replace("{done}", () => String(completeCount))
                      .replace("{total}", () => String(steps.length))
                  : "-"}
              </p>
            </div>
          </div>

          {/* Latao, como a barra do aluno: progresso e conquista. O "2 of 3"
              logo acima e o numero que acompanha a barra. */}
          <div className="mt-4 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(26,54,93,0.12)]">
              <div
                data-testid="studio-next-steps-bar"
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
                style={{ width: ready ? `${progress}%` : "0%" }}
              />
            </div>
            {/* O marco: a barra chegou ao fim. */}
            {ready && progress === 100 ? <MilestoneSeal animate={justDone.size > 0} /> : null}
          </div>

          <ol
            className="mt-4 grid gap-2 sm:auto-cols-fr sm:grid-flow-col"
            aria-label={t("creatorPanel.home.nextSteps.listLabel")}
          >
            {steps.map((step, index) => (
              <li key={step.label}>
                <Link
                  href={step.href}
                  className="flex h-full min-h-24 flex-col border-l-2 border-[var(--color-line)] px-3 py-2 transition-colors hover:border-[var(--color-primary)]"
                >
                  <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                    {step.done ? (
                      <DrawnCheck size={15} animate={justDone.has(step.id)} />
                    ) : (
                      <Circle aria-hidden="true" size={13} strokeWidth={1.8} />
                    )}
                    0{index + 1}
                  </span>
                  <strong className="mt-2 text-sm text-[var(--color-ink)]">{step.label}</strong>
                  <small className="mt-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                    {step.detail}
                  </small>
                </Link>
              </li>
            ))}
          </ol>
        </div>

        <aside className="border-t border-[var(--color-line)] bg-[var(--color-surface-soft)] px-5 py-6 lg:border-l lg:border-t-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
            {t("creatorPanel.home.nextSteps.recommended")}
          </p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
            {nextStep.label}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">{nextStep.detail}</p>
          <Link href={nextStep.href} className="button-solid mt-5 px-4 text-sm">
            {nextStep.action}
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
          </Link>
        </aside>
      </div>
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
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ProductFilter>("all");
  const filters: Array<{ id: ProductFilter; label: string }> = [
    { id: "all", label: t("creatorPanel.filters.all") },
    { id: "draft", label: t("creatorPanel.filters.drafts") },
    { id: "published", label: t("creatorPanel.home.products.filterLiveSales") },
    { id: "in_review", label: t("statusChip.in_review") },
    { id: "other", label: t("creatorPanel.filters.needsAttention") },
  ];
  const filtered = courses.filter((course) => {
    if (filter === "all") return true;
    if (filter === "draft") return course.status === "draft";
    if (filter === "published") return course.status === "published";
    if (filter === "in_review") return course.status === "in_review";
    return course.status === "needs_changes" || course.status === "inactive";
  });

  return (
    <section aria-labelledby="studio-products-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("platform.nav.courseBuilder")}
          </p>
          <h2
            id="studio-products-title"
            className="mt-1 text-2xl font-semibold text-[var(--color-primary)]"
          >
            {t("creatorPanel.home.products.title")}
          </h2>
        </div>
        <Link href="/teach/builder" className="button-outline px-4 text-sm">
          {t("creatorPanel.home.products.showAll")}
          <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
        </Link>
      </div>

      <div
        className="mt-4 flex gap-1 overflow-x-auto border-b border-[var(--color-line)]"
        role="tablist"
        aria-label={t("creatorPanel.home.products.filtersLabel")}
      >
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors ${
              filter === item.id
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!coursesLoaded ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-32 animate-pulse rounded-md bg-[var(--color-surface-strong)]"
            />
          ))}
        </div>
      ) : courses.length === 0 ? (
        // Nenhum produto ainda: a cena do primeiro produto e o unico botao
        // latao da Home (o marco), no lugar da faixa tracejada de uma frase.
        <EmptyState
          as="h3"
          art={<SpotArt scene="firstProduct" />}
          title={t("creatorPanel.home.products.firstTitle")}
          action={
            <Link
              href="/teach/builder?newCourse=1&format=course"
              className={buttonClasses({ variant: "accent", size: "lg" })}
            >
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
              {t("creatorPanel.home.products.firstCta")}
            </Link>
          }
          className="mt-3"
        />
      ) : filtered.length === 0 ? (
        <div className="mt-3 border-y border-dashed border-[var(--color-line-strong)] px-5 py-10 text-center">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {t("creatorPanel.home.products.empty")}
          </p>
          <Link
            href="/teach/builder?newCourse=1&format=course"
            className="button-solid mt-4 px-4 text-sm"
          >
            {t("creatorPanel.createProduct")}
          </Link>
        </div>
      ) : (
        // motion-stagger: os cartoes sobem em escada (40ms cada) quando os
        // dados chegam; a lista so monta depois do esqueleto.
        <ul className="motion-stagger mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {filtered.slice(0, 4).map((course, index) => (
            <li key={course.id} style={{ "--i": index } as CSSProperties}>
              <Link
                href={`/teach/courses/${encodeURIComponent(course.id)}/manage`}
                className="motion-hover-lift flex h-full min-h-36 flex-col rounded-lg border border-[var(--color-line)] bg-white p-4 transition hover:border-[var(--color-primary-light)] hover:shadow-sm"
              >
                {/* A mesma miniatura 16:9 da lista de produtos (/teach/builder):
                    a capa quando existe, o mesmo icone quando nao existe. Sem a
                    capa o card era so texto e o professor nao reconhecia o
                    proprio produto. */}
                <div className="mb-3 grid aspect-video w-full place-items-center overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                  {course.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={course.coverImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Layers3 aria-hidden="true" size={19} strokeWidth={1.7} />
                  )}
                </div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {t(productTypeKey(course))}
                  </span>
                  {/* Era texto dourado para todo status: "Published" e "Needs
                      changes" saiam iguais. O chip da cor a cada um. */}
                  <StatusChip status={course.status || "draft"} />
                </div>
                <h3 className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-ink)]">
                  {course.title || t("creatorPanel.untitledProduct")}
                </h3>
                <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                  {t(
                    course.lessonCount === 1
                      ? "publicCourses.lessonOne"
                      : "publicCourses.lessonMany"
                  ).replace("{count}", () => String(course.lessonCount))}
                  {course.communityEnabled ? ` · ${t("creatorPanel.communityOn")}` : ""}
                </p>
                <span className="mt-auto pt-4 text-xs font-semibold text-[var(--color-primary)]">
                  {t("creatorPanel.home.products.manage")}
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
  const { t } = useTranslation();
  // Os mesmos quatro tipos da tela de criacao, com os mesmos textos. Gratis,
  // assinatura e programa guiado deixaram de ser tipo (sao preco e ritmo).
  const formats: Array<{
    title: string;
    detail: string;
    href: string;
    icon: LucideIcon;
  }> = [
    { id: "course", icon: BookOpenCheck },
    { id: "community", icon: UsersRound },
    { id: "live_event", icon: CalendarDays },
    { id: "ebook", icon: FileDown },
  ].map(({ id, icon }) => ({
    title: t(`courseCreation.types.${id}.label`),
    detail: t(`courseCreation.types.${id}.help`),
    href: `/teach/builder?newCourse=1&format=${id}`,
    icon,
  }));

  return (
    <section
      aria-labelledby="sell-formats-title"
      className="border-y border-[var(--color-line)] py-6"
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
        {t("creatorPanel.home.formats.eyebrow")}
      </p>
      <h2
        id="sell-formats-title"
        className="mt-1 text-2xl font-semibold text-[var(--color-primary)]"
      >
        {t("creatorPanel.home.formats.title")}
      </h2>
      {/* Quatro colunas so no xl, como os cartoes e os marcos desta tela: em
          lg (1024px) com a barra aberta cada formato ficava com ~176px. */}
      <ul className="mt-5 grid gap-px overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4">
        {formats.map((format) => {
          const Icon = format.icon;

          return (
            <li key={format.title} className="bg-white">
              <Link
                href={format.href}
                className="group flex h-full min-h-44 flex-col p-4 hover:bg-[var(--color-surface-soft)]"
              >
                <span className="grid size-9 place-items-center rounded-md border border-[var(--color-line)] text-[var(--color-primary)]">
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-[var(--color-ink)]">
                  {format.title}
                </h3>
                <p className="mt-2 flex-1 text-xs leading-5 text-[var(--color-ink-soft)]">
                  {format.detail}
                </p>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-3 text-[var(--color-primary)] transition-transform group-hover:translate-x-1"
                  size={15}
                  strokeWidth={1.9}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StudioEvolution({
  courses,
  coursesLoaded,
  payoutsReady,
  verificationApproved,
}: {
  courses: TeacherCourse[];
  coursesLoaded: boolean;
  payoutsReady: boolean;
  verificationApproved: boolean;
}) {
  const { t } = useTranslation();
  const milestones = [
    {
      label: t("creatorPanel.home.milestones.firstProduct"),
      done: courses.length > 0,
      icon: BookOpenCheck,
    },
    {
      label: t("creatorPanel.home.milestones.verified"),
      done: verificationApproved,
      icon: BadgeCheck,
    },
    {
      label: t("creatorPanel.home.milestones.payouts"),
      done: payoutsReady,
      icon: Wallet,
    },
    {
      label: t("creatorPanel.home.milestones.firstLive"),
      done: courses.some((course) => course.status === "published"),
      icon: Store,
    },
  ];
  const achieved = milestones.filter((milestone) => milestone.done).length;

  return (
    <section aria-labelledby="evolution-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("creatorPanel.home.milestones.eyebrow")}
          </p>
          <h2
            id="evolution-title"
            className="mt-1 text-xl font-semibold text-[var(--color-primary)]"
          >
            {t("creatorPanel.home.milestones.title")}
          </h2>
        </div>
        <span className="text-sm font-semibold tabular-nums text-[var(--color-ink-soft)]">
          {coursesLoaded ? `${achieved}/${milestones.length}` : "-"}
        </span>
      </div>
      <ol className="mt-4 grid border-y border-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4">
        {milestones.map((milestone, index) => {
          const Icon = milestone.icon;

          return (
            <li
              key={milestone.label}
              className="flex items-center gap-3 border-b border-[var(--color-line)] px-3 py-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"
            >
              <span
                className={`grid size-9 place-items-center rounded-full ${
                  milestone.done
                    ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                    : "border border-[var(--color-line)] text-[var(--color-ink-muted)]"
                }`}
              >
                <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                  {t("creatorPanel.home.milestones.item").replace("{number}", () => `0${index + 1}`)}
                </p>
                <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                  {milestone.label}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// A leitura de getCourseReadiness: sem paymentType gravado, preco 0 e Free.
// Fora do Free so se publica com preco, e preco exige os payouts do Stripe.
function sellsPaid(course: TeacherCourse) {
  return (course.paymentType ?? (course.priceAmountMinor === 0 ? "free" : "one_time")) !== "free";
}

// Data code -> dictionary key; the card shares the format names above.
// O selo do cartao e o tipo gravado na criacao (courses.product_format).
// Gratis e assinatura sao preco, nao tipo.
function productTypeKey(course: TeacherCourse) {
  return `courseCreation.types.${course.productFormat ?? "course"}.label`;
}
