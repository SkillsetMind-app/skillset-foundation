"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Info,
  LockKeyhole,
  PlayCircle,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BunnyVideoPlayer } from "@/components/courses/bunny-video-player";
import { ClassroomTabs, type ClassroomTabItem } from "@/components/learn/classroom-tabs";
import { CommunityFeed, type CommunityFeedLesson } from "@/components/learn/community-feed";
import { CourseMessagesPanel } from "@/components/learn/course-messages-panel";
import { CoursePlaylist } from "@/components/learn/course-playlist";
import { CourseReviewPanel } from "@/components/learn/course-review-panel";
import { LessonComments } from "@/components/learn/lesson-comments";
import { LessonListOverlay } from "@/components/learn/lesson-list-overlay";
import { NextLessonCard } from "@/components/learn/next-lesson-card";
import { MembersAreaHero } from "@/components/learn/members-area-hero";
import { TrustedEmbedPlayer } from "@/components/learn/trusted-embed-player";
import { CourseSubscriptionCard } from "@/components/learn/course-subscription-card";
import { VideoDock } from "@/components/learn/video-dock";
import {
  VideoWatermark,
} from "@/components/learn/watermarked-video-player";
import { ProtectedAssetPreview } from "@/components/shared/protected-asset-preview";
import type { CourseAsset } from "@/domain/course-asset";
import { formatCourseAssetSize, getPrimaryLessonVideoAsset } from "@/domain/course-asset";
import { getCourseAssetKindLabel } from "@/lib/i18n/course-assets";
import type { CourseEvent } from "@/domain/course-event";
import {
  formatEventDateTime,
  isValidExternalEventUrl,
} from "@/domain/course-event";
import {
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
import {
  resolveLessonContent,
  subscribeToLessonContent,
  type LessonContent,
} from "@/lib/data/lesson-content";
import { track } from "@/lib/posthog/events";

type EnrolledCourseWorkspaceProps = {
  course: Course;
  enableFirestoreAssets?: boolean;
  previewExitHref?: string;
  previewMode?: boolean;
  /** The shell is running under a teacher's own brand: hide every link that
   *  leads back into our platform (dashboard, public course page, credentials). */
  whitelabel?: boolean;
  /** Qual aba da sala esta aberta. Vem da rota: /learn/courses/<curso> e a
   *  aula; /learn/courses/<curso>/<aba> e uma das outras. Antes tudo morava
   *  na mesma rolagem, sem endereco. */
  tab?: ClassroomTab;
  /** Um post da comunidade aberto na gaveta (.../community/q/<post>). */
  openPostId?: string | null;
};

export function EnrolledCourseWorkspace({
  course,
  enableFirestoreAssets = false,
  previewExitHref,
  previewMode = false,
  whitelabel = false,
  tab = "lesson",
  openPostId = null,
}: EnrolledCourseWorkspaceProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  // Stripe's success_url carries ?checkout=success while the webhook is still
  // creating the enrollment — show "finalizing" instead of "Enrollment
  // required" during that gap (the realtime listener opens the workspace).
  const cameFromCheckout = searchParams?.get("checkout") === "success";
  const [checkoutGraceExpired, setCheckoutGraceExpired] = useState(false);
  const [enrollmentRecheck, setEnrollmentRecheck] = useState(0);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [isLoading, setIsLoading] = useState(!previewMode);
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
  // A aula atual vai no endereço (?lesson=…). Antes ficava só no estado:
  // recarregar ou voltar no navegador abria a "primeira aula não concluída",
  // não a que a pessoa estava vendo; e um link compartilhado nunca abria a
  // mesma aula. O parâmetro é lido na montagem e reescrito a cada seleção.
  const router = useRouter();
  const pathname = usePathname() ?? "";
  // "/learn/courses/<curso>" — sem a aba. Trocar de aula a partir de uma aba
  // (Community, Materials...) leva de volta a aula, nao grava ?lesson= na aba.
  const basePath = classroomBasePath(pathname, tab);
  const lessonParam = searchParams?.get("lesson") ?? null;
  // A escolha guarda o parâmetro que estava no endereço quando foi feita. A
  // escolha vale enquanto o endereço for aquele (o router ainda não gravou) ou
  // já for a própria escolha (gravou). Se o endereço mudar para outra coisa por
  // fora (voltar/avançar, link novo), a aula passa a ser a do endereço —
  // derivado, sem efeito sincronizando estado (o mesmo desenho do
  // `sectionChoice` da barra lateral).
  const [lessonChoice, setLessonChoice] = useState<{
    seenParam: string | null;
    id: string | null;
  }>({ seenParam: lessonParam, id: lessonParam });
  const selectedLessonId =
    lessonChoice.seenParam === lessonParam || lessonChoice.id === lessonParam
      ? lessonChoice.id
      : lessonParam;

  // Único caminho para trocar de aula: estado + endereço + rolar até o player.
  // Antes a troca podia acontecer fora da tela (o aluno rolava até a discussão,
  // o vídeo acabava, a próxima aula entrava lá em cima) — ele voltava e
  // encontrava outro vídeo sem saber por quê. Agora a página rola até o player
  // em toda troca, inclusive no avanço automático.
  function selectLesson(lessonId: string) {
    setLessonChoice({ seenParam: lessonParam, id: lessonId });

    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("lesson", lessonId);
    router.replace(`${basePath}?${params.toString()}`, { scroll: false });

    window.requestAnimationFrame(() => {
      document
        .getElementById("member-lesson-player")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  const [lessonListOpen, setLessonListOpen] = useState(false);
  // Quantas perguntas do curso seguem sem resposta aceita. Vira o numero ao
  // lado da aba Community.
  //
  // POR QUE ISTO EXISTE
  //
  // A barra de abas ja sabia mostrar um numero (Materiais mostra), mas
  // Comunidade nunca mostrou: quem estava na aula nao tinha como saber que
  // havia pergunta esperando — a aba parecia igual, respondida ou nao. Uma
  // leitura ao abrir a sala, so as colunas da regra, sem duplicar o feed.
  const [openQuestionCount, setOpenQuestionCount] = useState(0);
  const communityEnabled = Boolean(course.communityEnabled) && !previewMode;
  // O feed usa `course.id` como course_slug (ver CourseCommunitySection); o
  // contador tem que ler a MESMA chave, senao conta zero sempre.
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
  // Fim do vídeo: a próxima aula fica proposta num cartão sobre o player (5 s,
  // Assistir agora / Cancelar) em vez de trocar em silêncio. Quando o aluno
  // aceita, a aula seguinte abre com autoplay — só ela, só dessa vez.
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
  const [error, setError] = useState("");
  // A matrícula falsa do preview PRECISA de identidade estável.
  //
  // POR QUE ISTO EXISTE
  //
  // Ela é a única matrícula que o preview do professor tem, e três efeitos
  // abaixo declaram `workspaceEnrollment` como dependência — o OBJETO, não o
  // id. Montado a cada render, este literal ganhava identidade nova a cada
  // render, e dois desses efeitos abrem inscrição no Supabase e gravam estado
  // no callback. Estado novo -> render -> objeto novo -> cancela e reinscreve
  // -> callback -> estado novo. Laço fechado, sem condição de parada.
  //
  // O professor abria o preview do próprio curso e a aba martelava o banco
  // indefinidamente: cota de requisições, churn de canais realtime, aba
  // travando e bateria do celular indo embora — sem nada na tela que dissesse
  // o que estava acontecendo.
  //
  // `useMemo` sobre os campos que realmente compõem a matrícula: enquanto o
  // curso e a pessoa forem os mesmos, a identidade é a mesma.
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

  useEffect(() => {
    if (!cameFromCheckout) {
      return;
    }

    // After 90s without an enrollment the webhook is genuinely stuck — switch
    // the copy from "opening..." to a keep-the-page-open/support message.
    const timer = window.setTimeout(() => setCheckoutGraceExpired(true), 90_000);

    return () => window.clearTimeout(timer);
  }, [cameFromCheckout]);

  // Rede de segurança do intervalo entre pagar e a matrícula aparecer.
  //
  // A tela promete ao comprador, com todas as letras: "Keep this page open: it
  // opens automatically the moment your enrollment is confirmed." Até aqui, a
  // ÚNICA coisa capaz de cumprir essa promessa era o `postgres_changes` — um
  // WebSocket. Aba de celular em segundo plano, proxy corporativo ou wi-fi
  // instável derrubam esse socket em silêncio: o canal continua "inscrito" e
  // simplesmente nunca dispara. A promessa virava mentira e o comprador — que
  // já pagou — ficava naquela tela para sempre, sem saber que bastava
  // recarregar. Este é o caminho de compra principal e era o único dos dois
  // workspaces sem nenhum fallback.
  //
  // Incrementar o contador re-roda a inscrição abaixo, que reemite sua leitura
  // única. As deps são as condições de parada: a matrícula chegou, ou o
  // componente desmontou. A carência de 90s só muda o ritmo.
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
    if (previewMode) {
      return;
    }

    if (!user) {
      return;
    }

    return subscribeToEnrollment(
      user.uid,
      course.slug,
      (nextEnrollment) => {
        setEnrollment(nextEnrollment);
        setIsLoading(false);
      },
      () => {
        setError("learn.classroom.workspace.enrollmentError");
        setIsLoading(false);
      },
    );
  }, [course.slug, enrollmentRecheck, previewMode, user]);

  useEffect(() => {
    if (previewMode || !workspaceEnrollment) {
      return;
    }

    return subscribeToCompletedLessons(
      workspaceEnrollment.id,
      (lessonIds) => {
        setProgressState({
          key: workspaceEnrollment.id,
          lessonIds,
          ready: true,
        });
      },
      () => {
        setError("learn.classroom.workspace.progressLoadError");
        setProgressState({
          key: workspaceEnrollment.id,
          lessonIds: [],
          ready: true,
        });
      },
    );
  }, [previewMode, workspaceEnrollment]);

  useEffect(() => {
    if (!enableFirestoreAssets || !workspaceEnrollment) {
      return;
    }

    return subscribeToCourseAssets(
      course.id,
      (assets) => {
        setAssetsState({
          assets,
          key: course.id,
          ready: true,
        });
      },
      () => {
        setError("learn.classroom.workspace.assetsError");
        setAssetsState({
          assets: [],
          key: course.id,
          ready: true,
        });
      },
    );
  }, [course.id, enableFirestoreAssets, workspaceEnrollment]);

  // B1: subscribe to the gated lesson content for the active course. Only
  // meaningful for an enrolled (or preview) viewer, who passes the enrollment
  // gate in RLS; a permission error degrades gracefully to inline fallback
  // rather than blocking the workspace.
  useEffect(() => {
    if (!workspaceEnrollment) {
      return;
    }

    return subscribeToLessonContent(
      course.id,
      (content) => {
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
  }, [course.id, workspaceEnrollment]);

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

  if (isLoading) {
    // Skeleton mirrors the classroom shape (hero band, then player + lesson
    // strip) so nothing shifts when the enrollment resolves. Neutral surface
    // tokens only, because the real shell is theme-driven per course.
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        className="grid gap-4 rounded-[14px] border border-[var(--color-line)] bg-white p-4 shadow-[var(--shadow-soft)] sm:p-6"
      >
        <p className="sr-only" role="status">
          {t("learn.classroom.workspace.loading")}
        </p>
        <div className="h-32 animate-pulse rounded-[12px] bg-[var(--color-surface-strong)]" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="aspect-video animate-pulse rounded-[12px] bg-[var(--color-surface-strong)]" />
          <div className="grid gap-3">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-16 animate-pulse rounded-[10px] bg-[var(--color-surface-soft)]"
              />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/learn" className="button-solid px-4 py-2.5 text-sm">
            {t("learn.classroom.workspace.backToLearning")}
          </Link>
          <Link
            href={`/courses/${course.slug}`}
            className="button-outline px-4 py-2.5 text-sm"
          >
            {t("learn.classroom.workspace.openCourse")}
          </Link>
        </div>
      </section>
    );
  }

  if (!workspaceEnrollment) {
    if (cameFromCheckout) {
      return (
        <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("learn.classroom.workspace.paymentReceived")}
          </p>
          {/* h1: enquanto a matrícula não chega, esta seção é a página
              inteira — o MembersAreaHero, que traz o h1 do curso, só renderiza
              depois. O comprador que acabou de pagar ficava num documento cujo
              único cabeçalho era um h3 solto. */}
          <h1 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {checkoutGraceExpired
              ? t("learn.classroom.workspace.enrollmentDelayed")
              : t("learn.classroom.workspace.openingCourse")}
          </h1>
          <p role="status" className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {checkoutGraceExpired
              ? t("learn.classroom.workspace.delayedDetails")
              : t("learn.classroom.workspace.openingDetails")}
          </p>
        </section>
      );
    }

    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learn.classroom.workspace.enrollmentRequired")}
        </p>
        <h1 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
          {t("learn.classroom.workspace.enrollmentHeading")}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("learn.classroom.workspace.enrollmentDetails")}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/courses/${course.slug}`} className="button-solid px-4 py-2.5 text-sm">
            {t("learn.classroom.workspace.openCourse")}
          </Link>
          <Link href="/learn" className="button-outline px-4 py-2.5 text-sm">
            {t("learn.classroom.workspace.backToLearningTitle")}
          </Link>
        </div>
      </section>
    );
  }

  const completedLessonIds = progressState.lessonIds;
  const progressPercent = getCourseProgressPercent(course, completedLessonIds);
  const nextLesson = getNextCourseLesson(course, completedLessonIds)?.lesson ?? null;
  const allLessons = course.modules.flatMap((module) => module.lessons);
  const lessonUnlockStateById = new Map(
    allLessons.map((lesson) => [
        lesson.id,
        getLessonUnlockState(course, lesson, workspaceEnrollment, completedLessonIds),
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
  const courseLevelAssets =
    assetsState.key === course.id
      ? assetsState.assets.filter(
          (asset) =>
            !asset.lessonId
            && !asset.moduleId
            && asset.kind !== "course_cover"
            && asset.kind !== "members_cover",
        )
      : [];
  const assetCountByLessonId = new Map<string, number>();
  const thumbnailUrlByLessonId = new Map<string, string>();
  const thumbnailDateByLessonId = new Map<string, number>();
  const courseLessonIds = new Set(allLessons.map((lesson) => lesson.id));
  // Module cover art. Teachers already upload these through the course asset
  // uploader's "Module cover" preset, which stamps the asset with its moduleId;
  // module_cover lives in the world-readable bucket, so downloadUrl renders
  // straight into the card with no signed-URL round trip. Cards without one
  // keep the numbered gradient tone.
  // ponytail: one cover per module — assets arrive sorted by fileName, so if a
  // teacher uploads two the alphabetically last wins. Add an explicit picker
  // only if that ever confuses someone.
  const moduleCoverUrlById = new Map<string, string>();
  const totalLessonCount = allLessons.length;
  // Mesma conta de getCourseProgressPercent: so aulas que existem no curso.
  const completedLessonCount = allLessons.filter((lesson) =>
    completedLessonIds.includes(lesson.id),
  ).length;
  const selectedModule = selectedLesson
    ? course.modules.find((module) =>
        module.lessons.some((lesson) => lesson.id === selectedLesson.id),
      ) ?? null
    : null;
  // Um so criterio para o certificado, no hero e na barra de abas. Whitelabel
  // esconde todo link que volta para a plataforma.
  const certificateHref =
    progressPercent === 100 && !whitelabel ? "/learn/credentials" : null;
  const selectedLessonNumber = selectedLesson
    ? allLessons.findIndex((lesson) => lesson.id === selectedLesson.id) + 1
    : 0;
  // Sequential navigation. selectedLessonNumber is already the 1-based position
  // in the flattened curriculum, so the neighbours are just its edges. Locked
  // lessons stay reachable, exactly like clicking one in the sidebar strip: the
  // panel is what shows the lock, not the navigation.
  const previousInOrder =
    selectedLessonNumber > 1 ? allLessons[selectedLessonNumber - 2] : null;
  const nextInOrder =
    selectedLessonNumber > 0 ? allLessons[selectedLessonNumber] ?? null : null;
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
      if (asset.kind === "module_cover" && asset.moduleId && asset.downloadUrl) {
        moduleCoverUrlById.set(asset.moduleId, asset.downloadUrl);
      }
    }
  }
  async function toggleLessonCompletion(lessonId: string, completed: boolean) {
    if (previewMode) {
      setError("creatorEditor.preview.readOnly");
      return;
    }

    if (!user || !workspaceEnrollment) {
      return;
    }

    const unlockState = lessonUnlockStateById.get(lessonId);

    if (unlockState && !unlockState.unlocked) {
      setError("learn.classroom.workspace.lessonLockedError");
      return;
    }

    setError("");
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
    } catch {
      setError("learn.classroom.workspace.progressSaveError");
    } finally {
      setActiveLessonId(null);
    }
  }

  // Hotmart parity: watching to the end completes the lesson and rolls into the
  // next one. That single write also fixes "resume where you left off" — the
  // mount-time fallback already opens getNextCourseLesson (first incomplete),
  // it just never had anything to resume from while completion was manual.
  async function handleLessonEnded() {
    // Preview writes are hard-blocked upstream; calling through would only
    // surface "Preview mode is read-only" at the end of every clip.
    if (previewMode || !selectedLesson) {
      return;
    }

    const endedLessonId = selectedLesson.id;

    if (!completedLessonIds.includes(endedLessonId)) {
      await toggleLessonCompletion(endedLessonId, false);
    }

    if (!nextInOrder) {
      return;
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
    );

    if (nextUnlockState.unlocked) {
      // Não troca em silêncio: o cartão "Próxima aula" sobre o vídeo conta 5 s
      // com "Assistir agora" e "Cancelar". Sem ação, a próxima começa a tocar.
      setNextUp(nextInOrder);
    }
  }

  // O aluno aceitou (ou deixou o tempo correr): troca de aula e pede autoplay
  // — permitido porque ele já interagiu com a página.
  function playNextUp() {
    if (!nextUp) {
      return;
    }
    setNextUp(null);
    setAutoplayLessonId(nextUp.id);
    selectLesson(nextUp.id);
  }

  // A capa é a página inicial do curso — primeira visita (sem aula no endereço
  // e sem progresso), pré-visualização do professor, ou a aba "About". Em toda
  // aula, um cabeçalho curto: voltar, título, progresso. Antes a capa inteira
  // (imagem, descrição, botão) empurrava o vídeo para baixo em TODA aula.
  const isCourseHome =
    previewMode
    || tab === "about"
    || (!lessonParam && completedLessonIds.length === 0);

  // Voltar sobe UM nivel — nao pula para o fim do corredor.
  //
  // POR QUE ISTO EXISTE
  //
  // Dentro de uma aba (Materiais, Comunidade, Mensagens, Avaliacao, Sobre) o
  // "←" ia direto para "My courses": quem abriu a comunidade para tirar uma
  // duvida da aula era jogado para fora do curso inteiro e tinha que achar o
  // curso, achar a aula e rolar de novo. Agora, de uma aba ele volta para a
  // AULA (a mesma, pelo ?lesson=); da aula, ai sim, para a lista de cursos.
  const inClassroomTab = tab !== "lesson";
  const backHref = inClassroomTab
    ? classroomTabHref(basePath, "lesson", selectedLesson?.id ?? null)
    : "/learn";
  const backLabel = t(inClassroomTab ? "learn.membersHero.backToLesson" : "learn.membersHero.back");

  // As abas que este curso tem. Materiais só quando há arquivos de curso
  // (cursos publicados por professor); lives, comunidade e mensagens não
  // existem na pré-visualização — e comunidade só se o professor ligou.
  const classroomTabs: ClassroomTabItem[] = [
    { id: "lesson", label: t("creatorEditor.preview.tabs.lesson") },
    ...(enableFirestoreAssets
      ? [{ id: "materials" as const, label: t("creatorEditor.preview.tabs.materials"), count: courseLevelAssets.length }]
      : []),
    ...(previewMode ? [] : [{ id: "lives" as const, label: t("creatorEditor.preview.tabs.lives") }]),
    ...(communityEnabled
      ? [{ id: "community" as const, label: t("creatorEditor.preview.tabs.community"), count: openQuestionCount }]
      : []),
    ...(previewMode ? [] : [{ id: "messages" as const, label: t("creatorEditor.preview.tabs.messages") }]),
    { id: "review", label: t("creatorEditor.preview.tabs.review") },
    { id: "about", label: t("creatorEditor.preview.tabs.about") },
  ];

  return (
    <div
      className="member-classroom"
      data-members-theme={course.membersTheme ?? "light"}
    >
      {isCourseHome ? (
        <MembersAreaHeroBand
          course={course}
          coverAsset={membersCoverAsset}
          progressPercent={previewMode ? null : progressPercent}
          completedCount={previewMode ? null : completedLessonCount}
          totalCount={previewMode ? null : totalLessonCount}
          certificateHref={previewMode ? null : certificateHref}
          backHref={backHref}
          backTo={inClassroomTab ? "lesson" : "courses"}
        />
      ) : (
        <header className="member-classroom-head">
          <Link href={backHref} className="member-classroom-head__back">
            ← {backLabel}
          </Link>
          <div className="member-classroom-head__main">
            <h1 className="member-classroom-head__title">
              {course.membersTitle ?? course.title}
            </h1>
            {tab === "lesson" && selectedLesson ? (
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
          <span
            className="member-classroom-head__progress"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("learn.paths.percentComplete").replace("{percent}", () => String(progressPercent))}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </span>
          <span className="member-classroom-head__percent">{progressPercent}%</span>
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

      {/* A faixa "Lesson tools" morava aqui: chips com números do curso e três
          botões ("Current lesson", "Resources", "Discussion") que só ROLAVAM a
          página — pareciam navegação e não levavam a lugar nenhum, e não havia
          como voltar de onde rolaram. Virou a barra de abas: cada uma é um
          endereço. */}
      <ClassroomTabs
        basePath={basePath}
        active={tab}
        lessonId={selectedLesson?.id ?? null}
        tabs={classroomTabs}
        certificateHref={certificateHref}
      />

      {tab === "lesson" ? (
      <div className="member-classroom-layout">
        <section id="member-lesson-player" className="member-classroom-player">
        {error ? (
          <p className="mb-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {t(error)}
          </p>
        ) : null}
        {selectedLesson && resolvedSelectedLesson ? (
          <LessonContentPanel
            assets={selectedLessonAssets}
            enrollmentId={workspaceEnrollment?.id ?? null}
            enableFirestoreAssets={enableFirestoreAssets}
            isLoadingAssets={Boolean(
              enableFirestoreAssets
                && (!assetsState.ready || assetsState.key !== course.id),
            )}
            isLoadingContent={isLessonContentLoading}
            lesson={resolvedSelectedLesson}
            moduleTitle={selectedModule?.title ?? null}
            onEnded={handleLessonEnded}
            unlockState={selectedLessonUnlockState}
            previewMode={previewMode}
            lessonComments={
              // Sob o player e "Informacoes da aula" (paridade Hotmart, P3):
              // o feed da comunidade filtrado por esta aula. Some sozinho
              // quando a comunidade do curso esta desligada.
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
          <nav
            aria-label={t("creatorEditor.preview.lessonNavigation")}
            className="sticky bottom-0 z-20 mt-5 flex flex-wrap items-center justify-center gap-3 border-t border-[var(--color-line)] bg-inherit py-3"
          >
            {/* "Anterior" morava aqui, sozinho, sem "proxima" ao lado. Os dois
                agora ficam junto do titulo (LessonStepper), uma vez so. */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <button
                type="button"
                onClick={() => setLessonListOpen(true)}
                className="button-outline flex-1 px-4 py-2.5 text-sm sm:flex-none"
              >
                {t("creatorEditor.preview.allLessons").replace("{count}", () => String(totalLessonCount))}
              </button>
              {/* One action instead of "Mark complete" + "Next": completing
                  and advancing is a single intent, and it gives every backend
                  the same auto-advance semantics even where the player never
                  reports "ended". Un-marking still lives on the lesson cards
                  in the curriculum strip. */}
              <button
                type="button"
                onClick={handleLessonEnded}
                disabled={
                  previewMode
                  || Boolean(
                    selectedLessonUnlockState
                      && !selectedLessonUnlockState.unlocked,
                  )
                  || activeLessonId === selectedLesson.id
                }
                className="button-solid flex-1 px-4 py-2.5 text-sm disabled:opacity-60 sm:flex-none"
              >
                {previewMode
                  ? t("creatorEditor.preview.only")
                  : selectedLessonUnlockState
                      && !selectedLessonUnlockState.unlocked
                    ? t("learn.classroom.lesson.locked")
                    : activeLessonId === selectedLesson.id
                      ? t("learn.classroom.workspace.saving")
                      : completedLessonIds.includes(selectedLesson.id)
                        ? nextInOrder
                          ? t("learn.classroom.nextLesson.title")
                          : t("learn.classroom.curriculum.completed")
                        : nextInOrder
                          ? t("learn.classroom.workspace.completeAndNext")
                          : t("learn.classroom.workspace.complete")}
              </button>
            </div>
          </nav>
        ) : null}
        </section>

        {/* Ao lado do vídeo mora a PLAYLIST — não um cartão de números
            ("Aula 3/12 · Arquivos 2"), nem "Continuar" (a aula atual já está
            destacada), nem "links do workspace" (a única saída é "← My courses"
            no topo; a página de vendas não pertence à sala). */}
        <aside className="member-classroom-sidebar">
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

      {/* As outras abas. Antes TUDO isto vinha depois do currículo, na mesma
          rolagem (4 a 6 telas de altura), sem endereço. Agora só a aba aberta
          renderiza — e ela tem um caminho próprio. */}
      {tab === "materials" && enableFirestoreAssets ? (
        <CourseAssetResourceList
          assets={courseLevelAssets}
          isLoading={Boolean(
            enableFirestoreAssets
              && (!assetsState.ready || assetsState.key !== course.id),
          )}
        />
      ) : null}

      {tab === "lives" && !previewMode ? <CourseEventsAgenda courseId={course.id} /> : null}

      {tab === "community" && communityEnabled ? (
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

      {tab === "messages" && !previewMode ? <CourseMessagesPanel courseId={course.id} /> : null}

      {tab === "review" ? (
        <CourseReviewPanel
          courseId={course.id}
          progressPercent={progressPercent}
          previewMode={previewMode}
        />
      ) : null}

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
// teacher-event-studio writes). Renders nothing when the course has no
// scheduled events, so lesson-only courses stay uncluttered.
function CourseEventsAgenda({ courseId }: { courseId: string }) {
  const { t, locale } = useTranslation();
  const [events, setEvents] = useState<CourseEvent[]>([]);
  // "Now" is sampled when the event list loads (render must stay pure), so
  // live-now state refreshes on every realtime change to the course's events.
  const [now, setNow] = useState(0);

  useEffect(() => {
    return subscribeToCourseEvents(
      courseId,
      (nextEvents) => {
        setEvents(nextEvents);
        setNow(Date.now());
      },
      // Agenda is additive: on error just leave it empty instead of surfacing
      // a banner inside the classroom.
      () => setEvents([]),
    );
  }, [courseId]);

  // Keep sessions visible for 2h after start so a student can still join a
  // live that already began.
  const upcoming = events.filter(
    (event) => Date.parse(event.startsAt) > now - 2 * 60 * 60 * 1000,
  );

  if (upcoming.length === 0) {
    return null;
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
          const isLiveNow = Date.parse(event.startsAt) <= now;
          const joinUrl = isValidExternalEventUrl(event.externalUrl)
            ? event.externalUrl
            : null;

          return (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] px-5 py-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="member-meta-chip">
                    {t(`creatorPanel.events.type.${event.type}`)}
                  </span>
                  {isLiveNow ? (
                    <span className="rounded-full bg-[rgba(178,34,52,0.1)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent-fg)]">
                      {t("learnWave2.agenda.now")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--color-primary)]">
                  {event.title}
                </p>
                <p className="mt-1 text-xs font-semibold text-[var(--color-ink-soft)]">
                  {formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"))}
                </p>
              </div>
              {joinUrl ? (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${isLiveNow ? "button-accent" : "button-outline"} inline-flex items-center gap-2 px-5 py-2.5 text-sm`}
                >
                  <PlayCircle size={16} aria-hidden />
                  {isLiveNow ? t("learnWave2.agenda.join") : t("learnWave2.agenda.open")}
                </a>
              ) : (
                <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
                  {t("learnWave2.agenda.soon")}
                </span>
              )}
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
  // Quem e o professor. O feed marca as respostas dele ("· Instructor"), poe
  // a resposta dele em primeiro no cartao e nomeia o filtro "From <nome>".
  // Sem isto o professor era so mais um membro e o filtro dizia "the
  // instructor". O nome vem da projecao publica (public_profiles), a mesma da
  // vitrine — nada alem do que qualquer visitante ja ve.
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

  const space: CommunitySpace = {
    id: `creator-${course.id}`,
    courseSlug: course.id,
    name: `${course.title} community`,
    description:
      t("learnWave2.agenda.communityDescription"),
    visibility: "enrolled_only",
    categories: ["announcement", "discussion", "question", "resource"],
  };

  // A comunidade simplificada (mockup 5): o feed tem o proprio cabecalho; o
  // painel com manchete ("Course community / Connect with other students")
  // repetia a aba e empurrava o feed para baixo.
  return (
    <section className="member-resource-panel">
      <CommunityFeed
        space={space}
        currentLesson={currentLesson}
        openPostId={openPostId}
        instructorName={instructorName}
        instructorIds={instructorIds}
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
}: {
  course: Course;
  coverAsset?: CourseAsset;
  progressPercent: number | null;
  completedCount: number | null;
  totalCount: number | null;
  certificateHref: string | null;
  backHref: string;
  /** Voltar sobe um nivel: da aba About, para a aula; da aula, para /learn. */
  backTo: "courses" | "lesson";
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
      subtitle={course.membersSubtitle ?? null}
      description={course.membersDescription ?? course.summary ?? null}
      progressPercent={progressPercent}
      completedCount={completedCount}
      totalCount={totalCount}
      certificateHref={certificateHref}
      backHref={backHref}
      backTo={backTo}
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

function formatUnlockMessage(unlockState: LessonUnlockState, locale: string, t: (key: string) => string) {
  if (unlockState.unlocked) {
    return t("learn.classroom.lesson.available");
  }

  if (unlockState.reason === "previous_lesson_required") {
    return t("learn.classroom.lesson.previousRequired");
  }

  if (unlockState.unlocksAt) {
    const date = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(unlockState.unlocksAt);
    return t("learn.classroom.lesson.unlocks").replace("{date}", () => date);
  }

  return t("learn.classroom.curriculum.locked");
}

// Anterior / proxima junto do titulo (paridade Hotmart, §4.3). A conta dos
// vizinhos ja existia (previousInOrder / nextInOrder); o botao "anterior" da
// barra inferior morava sozinho, sem "proxima". Aqui os dois, uma vez so.
// Desabilitado = aria-disabled (continua focavel; o leitor de tela ouve
// "indisponivel") e o clique nao faz nada: a proxima bloqueada NUNCA abre por
// aqui — o cadeado e do painel, nao da navegacao. O avanco automatico ao fim
// do video (NextLessonCard) segue como esta.
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

// "Informacoes da aula" sob o player (paridade Hotmart, §4.3): tipo, duracao,
// modulo, materiais e data de liberacao — so o que `lesson`, o modulo e o
// estado de liberacao ja trazem; nenhuma leitura nova. Estado local + botao
// (nao <details>): aria-expanded / aria-controls explicitos, alvo de 44px.
function LessonInfo({
  lesson,
  moduleTitle,
  materialsCount,
  unlocksAt,
}: {
  lesson: Lesson;
  moduleTitle: string | null;
  /** null = curso sem arquivos (catalogo) ou ainda carregando: a linha some. */
  materialsCount: number | null;
  unlocksAt: Date | null;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const rows: Array<[string, string]> = [
    [t("learn.classroom.lessonInfo.type"), t(lessonTypeLabels[lesson.type])],
    [t("learn.classroom.lessonInfo.duration"), lesson.duration],
  ];
  if (moduleTitle) {
    rows.push([t("learn.classroom.lessonInfo.module"), moduleTitle]);
  }
  if (materialsCount != null) {
    rows.push([
      t("learn.classroom.lessonInfo.materials"),
      t(`learn.classroom.resources.${materialsCount === 1 ? "fileOne" : "fileMany"}`)
        .replace("{count}", () => String(materialsCount)),
    ]);
  }
  if (unlocksAt) {
    rows.push([
      t("learn.classroom.lessonInfo.availableFrom"),
      new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" })
        .format(unlocksAt),
    ]);
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? "member-lesson-info" : undefined}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-2 text-sm font-semibold text-[var(--color-ink)] underline-offset-4 hover:underline"
      >
        <Info aria-hidden="true" size={15} />
        {t("learn.classroom.lessonInfo.toggle")}
        <ChevronDown aria-hidden="true" size={15} className={open ? "rotate-180" : ""} />
      </button>
      {/* Fechado = fora do DOM, nao `hidden`: o tipo da aula ja esta no
          cabecalho do painel, e uma copia oculta viraria texto duplicado para
          quem busca por ele (leitor de tela em modo de leitura, testes). */}
      {open ? (
        <dl
          id="member-lesson-info"
          className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm"
        >
          {rows.map(([term, value]) => (
            <Fragment key={term}>
              <dt className="font-semibold text-[var(--color-ink-soft)]">{term}</dt>
              <dd className="m-0 text-[var(--color-ink)]">{value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function CourseAssetResourceList({
  assets,
  isLoading,
}: {
  assets: CourseAsset[];
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="member-resource-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("learn.classroom.resources.title")}
          </p>
          <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
            {t("learn.classroom.resources.heading")}
          </h4>
        </div>
        <span className="member-meta-chip">
          <FileText size={14} aria-hidden />
          {t(`learn.classroom.resources.${assets.length === 1 ? "fileOne" : "fileMany"}`).replace("{count}", () => String(assets.length))}
        </span>
      </div>
      {isLoading ? (
        <p className="mt-4 rounded-[10px] bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
          {t("learn.classroom.resources.loading")}
        </p>
      ) : assets.length === 0 ? (
        <p className="mt-4 rounded-[10px] bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
          {t("learn.classroom.resources.empty")}
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="rounded-[14px] border border-[var(--color-line)] bg-white p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    {asset.fileName}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {getCourseAssetKindLabel(asset.kind, t)} - {formatCourseAssetSize(asset.size)}
                  </p>
                </div>
                <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                  {t(asset.isPreview ? "learn.classroom.resources.preview" : "learn.classroom.resources.enrolled")}
                </span>
              </div>
              <ProtectedAssetPreview asset={asset} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// "Mark complete" used to live at the end of this panel. It now sits in the
// sticky lesson action bar with Previous / All lessons / Next, so the student
// never has to scroll past the discussion to find it.
function LessonContentPanel({
  assets,
  autoplay = false,
  enrollmentId,
  enableFirestoreAssets,
  isLoadingAssets,
  isLoadingContent,
  lesson,
  lessonComments = null,
  moduleTitle,
  nextUp = null,
  onCancelNextUp,
  onEnded,
  onPlayNextUp,
  previewMode,
  unlockState,
}: {
  assets: CourseAsset[];
  /** A aula abriu pelo cartão "Próxima aula": começa a tocar sozinha. */
  autoplay?: boolean;
  /** A matricula do aluno: sem ela (preview do professor) a posicao do video
   *  nao vai para o banco, so para o navegador. */
  enrollmentId: string | null;
  enableFirestoreAssets: boolean;
  isLoadingAssets: boolean;
  /** Aula proposta ao fim do vídeo; o cartão de 5 s fica sobre o player. */
  nextUp?: Lesson | null;
  onCancelNextUp?: () => void;
  onPlayNextUp?: () => void;
  isLoadingContent: boolean;
  lesson: Lesson;
  /** Comentarios da aula (feed da comunidade filtrado), logo abaixo de
   *  "Informacoes da aula". O painel nao sabe de comunidade: quem monta e a
   *  sala, que tem o caminho base e o numero da aula. */
  lessonComments?: ReactNode;
  /** Modulo da aula, para "Informacoes da aula". */
  moduleTitle: string | null;
  onEnded: () => void;
  previewMode: boolean;
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
  // O que toca é o vídeo MAIS RECENTE da aula, não o primeiro da lista.
  // fetchCourseAssets ordena por fileName (bom para a lista de anexos), então
  // um `.find()` aqui escolhia por ordem alfabética: quem regravava e subia
  // `final-v2.mp4` sobre `aula-01.mp4` via "arquivo enviado" e os alunos
  // continuavam vendo a take antiga, sem nenhuma forma de trocar.
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
  // No preview do professor não se guarda posição: ele não é o aluno.
  // Memoizado porque a referência é objeto: uma nova a cada render reabriria
  // a aula (e o evento "abriu" do funil) a cada quadro.
  const resume = useMemo(
    () =>
      previewMode ? null : lessonPositionRef(viewerId, enrollmentId, lesson.id),
    [enrollmentId, lesson.id, previewMode, viewerId],
  );

  return (
    <div className="member-lesson-panel">
      <div className="member-lesson-panel__head">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t(lessonTypeLabels[lesson.type])}
          </p>
          <h4 className="display-title mt-2 text-3xl text-[var(--color-ink)]">
            {lesson.title}
          </h4>
        </div>
        <span className="member-meta-chip">
          <Clock size={14} aria-hidden />
          {lesson.duration}
        </span>
      </div>

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
            <h5>{t("learn.classroom.lesson.locked")}</h5>
            <p>{unlockState ? formatUnlockMessage(unlockState, locale, t) : t("learn.classroom.curriculum.locked")}</p>
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
        ) : lessonContentPending ? (
          <div className="member-video-empty">
            <PlayCircle size={34} aria-hidden />
            <h5>{t("learn.classroom.lesson.loading")}</h5>
            <p>{t("learn.classroom.lesson.loadingDetails")}</p>
          </div>
        ) : (
          <div className="member-video-empty">
            <PlayCircle size={34} aria-hidden />
            <h5>{t(lesson.type === "text" ? "learn.classroom.lesson.textFirst" : "learn.classroom.lesson.mediaMissing")}</h5>
            <p>
              {lesson.type === "text"
                ? t("learn.classroom.lesson.textDetails")
                : t("learn.classroom.lesson.mediaDetails")}
            </p>
          </div>
        )}
      </div>
      </VideoDock>

      <LessonInfo
        lesson={lesson}
        moduleTitle={moduleTitle}
        materialsCount={
          enableFirestoreAssets && !isLoadingAssets ? supportingAssets.length : null
        }
        unlocksAt={unlockState?.unlocksAt ?? null}
      />

      {/* Aula trancada: sem comentarios. */}
      {!locked ? lessonComments : null}

      <div id="member-lesson-content" className="member-lesson-body">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {t("learn.classroom.lesson.content")}
          </p>
          {lesson.isPreview ? (
            <span className="rounded-[8px] border border-[rgba(178,34,52,0.18)] bg-[rgba(178,34,52,0.05)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-fg)]">
              {t("learn.classroom.lesson.freePreview")}
            </span>
          ) : null}
        </div>
        {!locked && lesson.description ? (
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink)]">
            {lesson.description}
          </p>
        ) : null}
        {!locked && lessonContentPending ? (
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("learn.classroom.lesson.loading")}
          </p>
        ) : null}
        {!locked && lesson.contentText ? (
          <div className="mt-4 whitespace-pre-line rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {lesson.contentText}
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
        {!locked && enableFirestoreAssets ? (
          <LessonAssetList assets={supportingAssets} isLoading={isLoadingAssets} />
        ) : null}
      </div>
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
    return (
      <p className="mt-4 rounded-[10px] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink-soft)]">
        {t("learn.classroom.resources.loadingLesson")}
      </p>
    );
  }

  if (assets.length === 0) {
    return (
      <p className="mt-4 rounded-[10px] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink-soft)]">
        {t("learn.classroom.resources.emptyLesson")}
      </p>
    );
  }

  return (
    <div className="mt-5 grid gap-3">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                  {asset.fileName}
                </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                <FileText size={13} aria-hidden />
                <span>{getCourseAssetKindLabel(asset.kind, t)} - {formatCourseAssetSize(asset.size)}</span>
              </div>
            </div>
            <span className="rounded-[8px] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
              {t(asset.isPreview ? "learn.classroom.resources.preview" : "learn.classroom.resources.enrolled")}
            </span>
          </div>

          <ProtectedAssetPreview asset={asset} />
        </div>
      ))}
    </div>
  );
}
