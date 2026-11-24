"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Circle,
  FileDown,
  Layers3,
  Plus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformPageHeader } from "@/components/platform/platform-page-header";
import { PeriodTabs } from "@/components/shared/period-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import { TeacherOverviewMetrics } from "@/components/teacher/teacher-overview-metrics";
import { StudioRecentActivity } from "@/components/teacher/studio-recent-activity";
import { StudioStorefrontCard } from "@/components/teacher/studio-storefront-card";
import { TeacherStudioInsights } from "@/components/teacher/teacher-studio-insights";
import { TeacherWelcomeTour } from "@/components/teacher/teacher-welcome-tour";
import { usePublishGates } from "@/components/teacher/use-publish-gates";
import { EmptyState, ProgressBar, buttonClasses } from "@/components/ui";
import { DrawnCheck, MilestoneSeal, useJustDone } from "@/components/ui/drawn-check";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SpotArt } from "@/components/ui/spot-art";
import { activationFeeUsd } from "@/data/plans";
import type { CourseReadinessAccount } from "@/domain/course-readiness";
import type { Order } from "@/domain/order";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherOrders } from "@/lib/data/orders";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import { logSubscriptionError } from "@/lib/data/subscription-error";

type ProductFilter = "all" | "draft" | "published" | "in_review" | "other";

// O bloco "Next steps" so entra quando cursos e travas chegam, ~0,6 s depois da
// lista de produtos: no celular "My products" descia 632px na frente de quem ia
// tocar. A altura que o bloco teve na ultima visita (neste aparelho, nesta
// largura de tela) fica reservada enquanto os dados chegam.
const NEXT_STEPS_HEIGHT_KEY = "skillset.studio.nextStepsHeight.v1";
const EMPTY_SUBSCRIBE = () => () => {};

function readNextStepsHeight(userId: string): number {
  if (!userId) return 0;
  try {
    const saved = JSON.parse(window.localStorage.getItem(NEXT_STEPS_HEIGHT_KEY) ?? "null");
    if (saved?.uid !== userId || typeof saved.h !== "number" || typeof saved.w !== "number") return 0;
    // Outra largura (celular deitado, janela redimensionada) quebra o texto em
    // outras linhas: a altura guardada nao vale mais.
    return Math.abs(saved.w - window.innerWidth) <= 48 ? saved.h : 0;
  } catch {
    return 0;
  }
}

function saveNextStepsHeight(userId: string, height: number) {
  try {
    window.localStorage.setItem(
      NEXT_STEPS_HEIGHT_KEY,
      JSON.stringify({ uid: userId, w: window.innerWidth, h: height }),
    );
  } catch {
    // ponytail: armazenamento bloqueado (modo privado): o bloco so nao reserva o espaco.
  }
}

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
  // Leitura que falhou nao pode parecer receita zero: os quadros dizem
  // "Unavailable" (como Ganhos), e enquanto carrega ficam no esqueleto.
  const [ordersState, setOrdersState] = useState<"loading" | "ready" | "error">("loading");
  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? "";
  // A taxa unica de ativacao vem do mesmo hook (o MESMO predicado que o
  // servidor aplica no publish, falha aberta): uma leitura so por visita.
  const activationBlocked = account.activationBlocked ?? false;

  const coursesSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const ordersSubscription = useRef<{ reload: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setCoursesFailed(false);
        setCoursesLoaded(true);
      },
      (error) => {
        logSubscriptionError("TeacherStudioDashboard.courses")(error);
        setCoursesFailed(true);
        setCoursesLoaded(true);
      }
    );
    coursesSubscription.current = current;
    return () => {
      coursesSubscription.current = null;
      current();
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    // Cursos, pedidos e perfil eram lidos 3x, 3x e 2x por /teach: cada bloco
    // da Home abria a propria leitura. Agora a Home le uma vez e repassa.
    const current = subscribeToTeacherOrders(
      user.uid,
      (nextOrders) => {
        setOrders(nextOrders);
        setOrdersState("ready");
      },
      (error) => {
        logSubscriptionError("TeacherStudioDashboard.orders")(error);
        setOrdersState("error");
      }
    );
    ordersSubscription.current = current;
    return () => {
      ordersSubscription.current = null;
      current();
    };
  }, [user]);

  // A leitura que falhou ganha "Try again" (antes a saida era recarregar a
  // pagina): le de novo pelo mesmo canal, so o que falhou, e enquanto isso o
  // bloco volta ao esqueleto.
  const readFailed = coursesFailed || ordersState === "error";
  function retryLoad() {
    if (coursesFailed) {
      setCoursesFailed(false);
      setCoursesLoaded(false);
      void coursesSubscription.current?.reload();
    }
    if (ordersState === "error") {
      setOrdersState("loading");
      void ordersSubscription.current?.reload();
    }
  }

  // "inactive" e um curso que ja esteve no ar (o admin tirou): ja houve publish.
  const launched = courses.some(
    (course) => course.status === "published" || course.status === "inactive"
  );
  // Arquivado tambem e "inactive": saiu da venda e nao cobra Stripe.
  const needsStripe = courses.some(
    (course) => course.status !== "inactive" && sellsPaid(course)
  );
  // Primeira visita, sem produto: o vazio da lista guarda o UNICO botao forte.
  // Filtros, formatos e o "New product" solido disputavam com ele.
  // Leitura que falhou nao e "sem produto": nada de convite a criar um
  // produto repetido embaixo do erro.
  const noProducts = coursesLoaded && courses.length === 0 && !coursesFailed;
  const greetingKey = !coursesLoaded
    ? "hello"
    : courses.length > 0 || coursesFailed
      ? "welcomeBack"
      : "welcome";

  return (
    // grid-cols-1 = minmax(0, 1fr): sem ele a coluna crescia ate a largura dos
    // filtros de "My products" (rolam por dentro) e a 375px a tela inteira
    // passava 35px da borda, cortando titulo, texto e o "67%".
    <div className="grid grid-cols-1 gap-8">
      {user ? (
        <TeacherWelcomeTour
          key={user.uid}
          userId={user.uid}
          firstName={firstName}
          hasProducts={courses.length > 0}
        />
      ) : null}
      {/* Uma manchete por tela. O olho da pagina era "Producer home" em
          versalete APOIADO por "Welcome back, {name}" logo abaixo: dois
          titulos disputando a mesma linha de leitura, e o de cima nem
          nomeava a tela ("Home" ja esta na barra e na trilha do topo). */}
      {/* "Welcome back" so para quem ja tem produto: na 1a visita a frase
          era falsa. Enquanto a lista carrega vale "Welcome", que nunca
          mente. Antes de a lista chegar nao da para saber qual das duas e
          verdade: vale "Hello", que nao afirma nada. Se a assinatura de
          cursos falhar, fica o "Welcome back" de antes. */}
      {/* O mesmo cabecalho das telas irmas (era 36px sem serifa so aqui).
          So "New product": o "Storefront" daqui levava ao mesmo editor do
          "Edit storefront" do cartao da vitrine, logo abaixo. */}
      <PlatformPageHeader
        title={
          firstName
            ? t(`teach.dashboard.${greetingKey}Named`).replace("{name}", () => firstName)
            : t(`teach.dashboard.${greetingKey}`)
        }
        description={t("creatorPanel.home.description")}
        actions={
          <Link
            href="/teach/builder?newCourse=1&format=course"
            className={`${noProducts ? "button-outline" : "button-solid"} px-4 text-sm`}
          >
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            {t("creatorPanel.newProduct")}
          </Link>
        }
      />

      {readFailed ? (
        <div className="grid gap-3">
          <InlineAlert tone="error">{t("teach.dashboard.loadError")}</InlineAlert>
          <button type="button" onClick={retryLoad} className="button-outline justify-self-start px-4 text-sm">
            {t("appErrors.retry")}
          </button>
        </div>
      ) : null}

      <StudioNextSteps
        userId={user?.uid ?? ""}
        courses={courses}
        ready={coursesLoaded && gatesLoaded}
        account={account}
        verificationStatus={verificationStatus}
        needsStripe={needsStripe}
        activationBlocked={activationBlocked}
        launched={launched}
      />

      <StudioProductsSection courses={courses} coursesLoaded={coursesLoaded} coursesFailed={coursesFailed} />

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

      {/* Os formatos sao atalhos para quem ja tem produto; o primeiro produto
          ja escolhe o formato na tela de criacao. */}
      {courses.length > 0 ? <StudioSellFormatsSection /> : null}

      {/* Os marcos ("Creator milestones") repetiam os mesmos passos da lista
          acima, e o cartao "Finish your Stripe setup" da lista de atencao
          repetia o passo do Stripe: a pendencia agora aparece uma vez so. */}
      <TeacherOverviewMetrics
        courses={courses}
        orders={orders}
        isLoading={!coursesLoaded || ordersState === "loading"}
        ordersFailed={ordersState === "error"}
      />
      {launched ? <TeacherStudioInsights courses={courses} orders={orders} /> : null}
    </div>
  );
}

function StudioNextSteps({
  userId,
  courses,
  ready,
  account,
  verificationStatus,
  needsStripe,
  activationBlocked,
  launched,
}: {
  userId: string;
  courses: TeacherCourse[];
  // Cursos e travas carregados. Antes disso a lista ainda pode ganhar ou perder
  // passos (verificacao exigida, plano, Stripe): o bloco nao aparece.
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
    {
      id: "create",
      label: t("creatorPanel.home.steps.create"),
      detail: t("creatorPanel.home.steps.createDetail"),
      href: "/teach/builder?newCourse=1&format=course",
      done: courses.length > 0,
      action: t("creatorPanel.createProduct"),
    },
    // O plano vem DEPOIS de criar: o teste gratis so e exigido para publicar, e
    // pedir o cartao a quem ainda nao montou nada era o primeiro passo da casa.
    // O botao abre os cartoes de plano (/account/plans); antes abria a pagina
    // de recibos de aluno (/account/billing), a tres cliques do teste.
    ...(account.planRequired
      ? [{
          id: "plan",
          label: t("creatorEditor.readiness.items.plan.label"),
          detail: t("creatorEditor.readiness.items.plan.hint"),
          href: "/account/plans",
          done: false,
          action: t("billingCheckout.seePlans"),
        }]
      : []),
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
  const progressText = t("creatorPanel.home.nextSteps.progress")
    .replace("{done}", () => String(completeCount))
    .replace("{total}", () => String(steps.length));
  // O passo aberto ganha o destaque e o botao, no proprio lugar. Antes um
  // painel ao lado ("Recommended now") repetia o titulo e a frase dele, e com
  // tudo feito recomendava "Publish your product" a quem ja tinha publicado.
  const openStep = steps.find((step) => !step.done);
  // O check se desenha e o selo cresce so no passo que ficou pronto com a
  // Home aberta; quem chega com tudo pronto ve tudo parado.
  const justDone = useJustDone(steps.filter((step) => step.done).map((step) => step.id), ready);
  const visible = ready && (Boolean(openStep) || justDone.size > 0);
  const reserved = useSyncExternalStore(EMPTY_SUBSCRIBE, () => readNextStepsHeight(userId), () => 0);
  const sectionRef = useRef<HTMLElement>(null);
  // Tudo que muda a altura do bloco: passos que entram ou saem (o do plano
  // volta a ser lido quando a janela ganha foco), feitos, e textos (a taxa de
  // ativacao chega depois e alonga a frase do publish).
  const hasOpenStep = Boolean(openStep);
  const layoutKey = steps.map((step) => `${step.id}:${step.done}:${step.detail}:${step.action}`).join("|");
  // Guarda a altura de hoje para a proxima visita. Sem passo aberto, 0: o
  // ultimo passo feito com a Home aberta deixa o bloco na tela, mas na proxima
  // visita ele ja nao aparece, e o lugar reservado sumiria num salto.
  useEffect(() => {
    if (ready && userId) saveNextStepsHeight(userId, hasOpenStep ? (sectionRef.current?.offsetHeight ?? 0) : 0);
  }, [ready, userId, visible, hasOpenStep, layoutKey]);

  // Antes de cursos e travas chegarem a lista vazia abria "Create a product" e,
  // para quem ja tem tudo pronto, o bloco aparecia e sumia a cada visita: nada
  // ate `ready`. Tudo pronto ao abrir a Home: o bloco sai da tela. Se o ultimo
  // passo ficou pronto com a Home aberta, ele fica ate a proxima visita.
  if (!ready) {
    return reserved > 0 ? (
      <div
        aria-hidden="true"
        data-reserved="next-steps"
        className="animate-pulse overflow-hidden border-y border-[var(--color-line)] bg-white px-4 py-5 sm:px-5"
        style={{ height: reserved }}
      >
        <div className="h-3 w-24 rounded-sm bg-[var(--color-surface-strong)]" />
        <div className="mt-2 h-5 w-48 max-w-full rounded-sm bg-[var(--color-surface-strong)]" />
        <div className="mt-6 h-2 rounded-full bg-[var(--color-surface-strong)]" />
      </div>
    ) : null;
  }
  if (!visible) {
    return null;
  }

  return (
    <section
      ref={sectionRef}
      aria-labelledby="next-steps-title"
      className="border-y border-[var(--color-line)] bg-white"
    >
      <div>
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
            {/* aria-hidden: a barra abaixo diz o "2 of 3" (nome) e a
                porcentagem (valor); sem isso o leitor de tela lia duas vezes. */}
            <div aria-hidden="true" className="text-right">
              <p className="text-2xl font-semibold tabular-nums text-[var(--color-primary)]">
                {`${progress}%`}
              </p>
              <p className="text-xs text-[var(--color-ink-muted)]">{progressText}</p>
            </div>
          </div>

          {/* A barra compartilhada, a mesma do aluno: progresso e conquista.
              O "2 of 3" logo acima e o numero que acompanha a barra. */}
          <div className="mt-4 flex items-center gap-2">
            <ProgressBar value={progress} label={progressText} className="flex-1" />
            {/* O marco: a barra chegou ao fim. */}
            {progress === 100 ? <MilestoneSeal animate={justDone.size > 0} /> : null}
          </div>

          <ol
            className="mt-4 grid gap-2 sm:auto-cols-fr sm:grid-flow-col"
            aria-label={t("creatorPanel.home.nextSteps.listLabel")}
          >
            {steps.map((step, index) => {
              const current = step.id === openStep?.id;
              const rule = current ? "border-[var(--color-primary)]" : "border-[var(--color-line)]";
              const body = (
                <>
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
                </>
              );

              return (
                <li key={step.id} aria-current={current ? "step" : undefined}>
                  {/* Criar o 1o produto nao ganha botao aqui: o vazio da lista
                      de produtos, logo abaixo, ja e o botao forte da tela. */}
                  {/* Linha no topo, nao na esquerda: borda colorida de lado e
                      o cartao que o padrao do desenho proibe. */}
                  {current && step.id !== "create" ? (
                    <div className={`flex h-full min-h-24 flex-col items-start border-t-2 px-3 pb-2 pt-3 ${rule}`}>
                      {body}
                      <Link href={step.href} className="button-solid mt-3 max-w-full px-4 text-sm">
                        {step.action}
                        <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
                      </Link>
                    </div>
                  ) : (
                    <Link
                      href={step.href}
                      className={`flex h-full min-h-24 flex-col border-t-2 px-3 pb-2 pt-3 transition-colors hover:border-[var(--color-primary)] ${rule}`}
                    >
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

function StudioProductsSection({
  courses,
  coursesLoaded,
  coursesFailed,
}: {
  courses: TeacherCourse[];
  coursesLoaded: boolean;
  coursesFailed: boolean;
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
        {courses.length > 0 ? (
          <Link href="/teach/builder" className="button-outline px-4 text-sm">
            {t("creatorPanel.home.products.showAll")}
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
          </Link>
        ) : null}
      </div>

      {/* Cinco filtros sobre uma lista vazia so faziam barulho na 1a visita. */}
      {/* Filtro, nao abas de secao: o seletor segmentado da casa (o mesmo do
          periodo), no lugar da barra sublinhada feita a mao so aqui. */}
      {courses.length > 0 ? (
        <div className="mt-4">
          <PeriodTabs
            options={filters.map((item) => item.id)}
            value={filter}
            onChange={setFilter}
            label={t("creatorPanel.home.products.filtersLabel")}
            renderLabel={(id) => filters.find((item) => item.id === id)?.label ?? id}
          />
        </div>
      ) : null}

      {!coursesLoaded ? (
        // O esqueleto tem a forma do cartao que vem (capa 16:9, tipo, titulo,
        // linha de aulas): era um bloco de 128px para um cartao de ~260px, e a
        // secao dobrava de altura quando os produtos chegavam.
        <div role="status" className="mt-3">
          <span className="sr-only">{t("creatorPanel.products.loading")}</span>
          <div aria-hidden="true" className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="min-h-36 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
                <div className="aspect-video rounded-md bg-[var(--color-surface-strong)]" />
                <div className="mt-3 h-3 w-20 rounded-sm bg-[var(--color-surface-strong)]" />
                <div className="mt-3 h-4 w-3/4 rounded-sm bg-[var(--color-surface-strong)]" />
                <div className="mt-2 h-3 w-1/2 rounded-sm bg-[var(--color-surface-strong)]" />
              </div>
            ))}
          </div>
        </div>
      ) : courses.length === 0 && coursesFailed ? (
        // A leitura falhou: o erro com "Try again" acima basta (como na Midia).
        null
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
        // So a frase, na caixa vazia da casa (a mesma do "primeiro produto"
        // logo acima): o "New product" do cabecalho ja cria, e um segundo
        // botao solido aqui disputava com ele.
        <EmptyState as="h3" title={t("creatorPanel.home.products.empty")} className="mt-3" />
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
