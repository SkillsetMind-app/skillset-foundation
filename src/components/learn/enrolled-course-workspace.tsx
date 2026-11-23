"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  LockKeyhole,
  PlayCircle,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BunnyVideoPlayer } from "@/components/courses/bunny-video-player";
import { ClassroomLoading } from "@/components/learn/classroom-loading";
import { ClassroomTabs, useTabChanged, type ClassroomTabItem } from "@/components/learn/classroom-tabs";
import { CommunityFeed, type CommunityFeedLesson } from "@/components/learn/community-feed";
import { CourseMessagesPanel } from "@/components/learn/course-messages-panel";
import {
  CourseMaterialsPanel,
  groupReleasedMaterials,
  LessonAssetActions,
  MaterialAppHint,
  MaterialFileList,
} from "@/components/learn/course-materials-panel";
import { CoursePlaylist } from "@/components/learn/course-playlist";
import { CourseReviewPanel } from "@/components/learn/course-review-panel";
import { LessonComments } from "@/components/learn/lesson-comments";
import { LessonListOverlay } from "@/components/learn/lesson-list-overlay";
import { NextLessonCard } from "@/components/learn/next-lesson-card";
import { MembersAreaHero } from "@/components/learn/members-area-hero";
import { TrustedEmbedPlayer } from "@/components/learn/trusted-embed-player";
import { CourseSubscriptionCard } from "@/components/learn/course-subscription-card";
import { CourseUnlockModal, unlockCopyKeys } from "@/components/learn/course-unlock-modal";
import { VideoDock } from "@/components/learn/video-dock";
import {
  VideoWatermark,
} from "@/components/learn/watermarked-video-player";
import { ProtectedAssetPreview } from "@/components/shared/protected-asset-preview";
import { MilestoneSeal, useJustDone } from "@/components/ui/drawn-check";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { CourseAsset } from "@/domain/course-asset";
import {
  formatCourseAssetSize,
  getCourseAssetTitle,
  getModuleCoverAsset,
  getPrimaryLessonVideoAsset,
  isVideoAssetKind,
} from "@/domain/course-asset";
import { getCourseAssetKindLabel } from "@/lib/i18n/course-assets";
import type { CourseEvent } from "@/domain/course-event";
import {
  formatEventDateTime,
  getEventLiveState,
  getEventUpdatedAt,
  isCancelledEventShown,
  isValidExternalEventUrl,
} from "@/domain/course-event";
import {
  ClassroomLiveStrip,
  EventCalendarActions,
  noJoinLinkKey,
  useNow,
} from "@/components/learn/live-session-parts";
import {
  formatUnlockDate,
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
import { linkify } from "@/lib/format/linkify";
import {
  resolveLessonContent,
  subscribeToLessonContent,
  type LessonContent,
} from "@/lib/data/lesson-content";
import { useCreatorAreaLink } from "@/components/learn/member-area-links";
import { track } from "@/lib/posthog/events";
import { scrollBehavior } from "@/lib/ui/scroll-behavior";
import { LessonQuiz } from "@/components/learn/lesson-quiz";
import { isTeacherAiEnabled } from "@/lib/ai/config";

// Liberação de aula pelo calendário (migration 20260915020000).
// Folga depois do prazo: o relógio do aparelho pode estar à frente do banco.
const RELEASE_GRACE_MS = 5_000;
// O banco ainda não abriu a aula (relógio adiantado): tenta de novo, com teto.
const RELEASE_RETRY_MS = 30_000;
const RELEASE_RETRIES = 3;
// Janela do relógio adiantado: perto do prazo, "voltou vazio" pode ser só o
// banco atrasado. Longe dele, é aula sem conteúdo protegido.
const RELEASE_SKEW_WINDOW_MS = 2 * 60 * 1000;

// "l1@1700000000000|l2@" -> [{ id: "l1", unlocksAt: 1700000000000 }, { id: "l2", unlocksAt: null }]
function parseUnlockedKey(key: string): { id: string; unlocksAt: number | null }[] {
  if (key === "") {
    return [];
  }
  return key.split("|").map((part) => {
    const at = part.lastIndexOf("@");
    const time = part.slice(at + 1);
    return { id: part.slice(0, at), unlocksAt: time === "" ? null : Number(time) };
  });
}
// Prazos distantes são rearmados a cada 24h (setTimeout estoura acima de ~24
// dias). O tique que não abre nada não busca nada.
const MAX_RELEASE_WAIT_MS = 24 * 60 * 60 * 1000;

// `reload` é opcional aqui: os testes que dublam os módulos de dados devolvem
// só a função de desligar.
type ReloadableSubscription = (() => void) & { reload?: () => Promise<void> };

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
  /** A matrícula que o pai (CreatorCourseWorkspace) já assina. Sem ela a sala
   *  buscava a mesma linha de novo, atrás de mais uma tela de espera. */
  enrollment?: Enrollment;
};

export function EnrolledCourseWorkspace({
  course,
  enableFirestoreAssets = false,
  previewExitHref,
  previewMode = false,
  whitelabel = false,
  tab = "lesson",
  openPostId = null,
  enrollment: parentEnrollment,
}: EnrolledCourseWorkspaceProps) {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  // Stripe's success_url carries ?checkout=success while the webhook is still
  // creating the enrollment — show "finalizing" instead of "Enrollment
  // required" during that gap (the realtime listener opens the workspace).
  const cameFromCheckout = searchParams?.get("checkout") === "success";
  const [checkoutGraceExpired, setCheckoutGraceExpired] = useState(false);
  const [enrollmentRecheck, setEnrollmentRecheck] = useState(0);
  const [ownEnrollment, setEnrollment] = useState<Enrollment | null>(null);
  const enrollment = parentEnrollment ?? ownEnrollment;
  const hasParentEnrollment = Boolean(parentEnrollment);
  const [isLoading, setIsLoading] = useState(!previewMode && !hasParentEnrollment);
  // A area do criador, quando ele tem perfil publico: e para la que o
  // "voltar" da aula leva (a saida continua uma so). Fora do preview.
  const creatorArea = useCreatorAreaLink(previewMode ? null : course.instructorId, course.id);
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
    // A contagem da "Próxima aula" e o aviso de erro eram da aula que ficou
    // para trás. Pendente, a contagem puxaria o aluno para outra aula depois
    // (até de uma aula de texto, onde o cartão nem aparece).
    setNextUp(null);
    setActionError("");

    const params = new URLSearchParams(searchParams?.toString() ?? "");
    // The Stripe return marker must not ride along into every lesson URL: a
    // copied, bookmarked or reopened link would look like a fresh purchase.
    params.delete("checkout");
    params.set("lesson", lessonId);
    router.replace(`${basePath}?${params.toString()}`, { scroll: false });

    window.requestAnimationFrame(() => {
      document
        .getElementById("member-lesson-player")
        ?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
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
  // Uma falha por leitura. O cartão de erro fica enquanto QUALQUER uma estiver
  // falhando: a sala nunca abre com o progresso vazio ou sem materiais que a
  // leitura que falhou deixou no lugar. Cada leitura boa tira só a própria
  // falha; o "Try again" relê todas as que falharam, pelos mesmos canais.
  // Progresso e materiais guardam DE QUEM falhou (a matrícula, o curso): a
  // falha de uma inscrição que já acabou não prende o cartão.
  const [failedReads, setFailedReads] = useState<{
    enrollment: boolean;
    progress: string | null;
    assets: string | null;
  }>({ enrollment: false, progress: null, assets: null });
  const enrollmentSubscription = useRef<ReloadableSubscription | null>(null);
  const progressSubscription = useRef<ReloadableSubscription | null>(null);
  const errorCardRef = useRef<HTMLElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const focusRoomAfterRetry = useRef(false);
  // Erro de uma AÇÃO (concluir/desfazer aula): aviso dentro do player, a sala
  // fica. `error` acima é de carga e troca a sala inteira pelo cartão de erro —
  // uma falha momentânea ao salvar tirava o aluno da aula.
  const [actionError, setActionError] = useState("");
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
  // Os canais e o progresso dependem do ID da matrícula, não do objeto:
  // concluir uma aula grava em enrollments, e a matrícula chega de novo pelo
  // realtime como outro objeto, o que reinscreveria tudo e trocaria os anexos.
  const enrollmentId = workspaceEnrollment?.id ?? null;
  // Relógio da liberação de aulas (ver o bloco "Liberação pelo calendário").
  // Anda na montagem, quando a matrícula e o progresso chegam, no próximo
  // prazo + folga e ao voltar para a aba.
  const [clockNow, setClockNow] = useState(() => Date.now());

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
    if (previewMode || hasParentEnrollment) {
      return;
    }

    if (!user) {
      return;
    }

    const current = subscribeToEnrollment(
      user.uid,
      course.slug,
      (nextEnrollment) => {
        setEnrollment(nextEnrollment);
        setFailedReads((reads) => (reads.enrollment ? { ...reads, enrollment: false } : reads));
        setIsLoading(false);
        // Matrícula que chega depois da montagem (checkout): o relógio da
        // montagem ficou para trás e a aula 1 apareceria fechada.
        setClockNow(Date.now());
      },
      () => {
        focusRoomAfterRetry.current = false;
        setFailedReads((reads) => ({ ...reads, enrollment: true }));
        setIsLoading(false);
      },
    );
    enrollmentSubscription.current = current;
    return () => {
      enrollmentSubscription.current = null;
      current();
    };
  }, [course.slug, enrollmentRecheck, hasParentEnrollment, previewMode, user]);

  useEffect(() => {
    if (previewMode || !enrollmentId) {
      return;
    }

    const current = subscribeToCompletedLessons(
      enrollmentId,
      (lessonIds) => {
        setProgressState({
          key: enrollmentId,
          lessonIds,
          ready: true,
        });
        setFailedReads((reads) => (reads.progress === enrollmentId ? { ...reads, progress: null } : reads));
        setClockNow(Date.now());
      },
      () => {
        focusRoomAfterRetry.current = false;
        setFailedReads((reads) => ({ ...reads, progress: enrollmentId }));
        setProgressState({
          key: enrollmentId,
          lessonIds: [],
          ready: true,
        });
        setClockNow(Date.now());
      },
    );
    progressSubscription.current = current;
    return () => {
      progressSubscription.current = null;
      current();
    };
  }, [enrollmentId, previewMode]);

  // Liberação pelo calendário (migration 20260915020000). A RLS só entrega o
  // texto, o link e o material da aula que já abriu, e nada no banco muda
  // quando ela abre, então o realtime não acorda. A sala acompanha o conjunto
  // de aulas abertas pelo relógio (clockNow) e o conjunto de concluídas.
  // Quando um dos dois muda, pede uma recarga avulsa aos dois canais, sem
  // reinscrevê-los. Tique ou volta para a aba que não abre nada não busca nada.
  const assetsSubscription = useRef<ReloadableSubscription | null>(null);
  const contentSubscription = useRef<ReloadableSubscription | null>(null);
  const latestAssets = useRef<CourseAsset[]>([]);
  const latestContent = useRef<Map<string, LessonContent>>(new Map());
  // Sobrevive às re-execuções dos efeitos: o último retrato visto, as aulas que
  // o relógio abriu e o banco ainda não entregou, e o timer da nova tentativa.
  // Uma mudança no meio da janela de 30s não cancela a tentativa pendente.
  const release = useRef({
    snapshot: null as { courseId: string; unlocked: string; completed: string } | null,
    pending: new Map<string, { unlocksAt: number | null; tries: number }>(),
    retryTimer: undefined as number | undefined,
  });
  // Aulas cuja recarga de abertura está no ar: o painel mostra "carregando" só
  // para elas, nunca para as que já estavam abertas. Quando essa recarga volta,
  // a aula sai daqui e a tela mostra o estado real (as novas tentativas da fila
  // seguem por trás, sem "carregando").
  const [releasingLessonIds, setReleasingLessonIds] = useState<ReadonlySet<string>>(() => new Set());

  // O retrato de partida só sai depois que o banco entregou a primeira carga:
  // ele compara o relógio da tela com o que chegou de fato.
  const releaseDataReady =
    lessonContentState.ready
    && lessonContentState.key === course.id
    && (!enableFirestoreAssets || (assetsState.ready && assetsState.key === course.id));
  // No preview o professor já lê tudo (é o dono): nada a acompanhar.
  let unlockedKey: string | null = null;
  let nextUnlockAt: number | null = null;
  if (
    !previewMode
    && workspaceEnrollment
    && progressState.ready
    && progressState.key === enrollmentId
    && releaseDataReady
  ) {
    const unlocked: string[] = [];
    for (const lesson of course.modules.flatMap((module) => module.lessons)) {
      const state = getLessonUnlockState(
        course,
        lesson,
        workspaceEnrollment,
        progressState.lessonIds,
        new Date(clockNow),
      );
      if (state.unlocked) {
        // O prazo vai junto na chave: a janela do relógio adiantado usa ele.
        unlocked.push(`${lesson.id}@${state.unlocksAt?.getTime() ?? ""}`);
      } else if (state.unlocksAt) {
        nextUnlockAt = Math.min(nextUnlockAt ?? Number.POSITIVE_INFINITY, state.unlocksAt.getTime());
      }
    }
    unlockedKey = unlocked.join("|");
  }
  // A lista de concluídas já chega ordenada (subscribeToCompletedLessons).
  const completedKey = progressState.lessonIds.join("|");

  // Próximo prazo + folga. Prazo distante: acorda em 24h, não abre nada, não
  // busca nada, e rearma (clockNow mudou).
  useEffect(() => {
    if (nextUnlockAt === null) {
      return;
    }

    const wait = Math.min(Math.max(0, nextUnlockAt - Date.now()), MAX_RELEASE_WAIT_MS);
    const timer = window.setTimeout(() => setClockNow(Date.now()), wait + RELEASE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [clockNow, nextUnlockAt]);

  // Timer de aba em segundo plano atrasa: ao voltar, confere o relógio.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setClockNow(Date.now());
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Troca de curso (aba que vive muito) ou saída: esquece a fila e o timer.
  useEffect(() => {
    const tracker = release.current;
    return () => {
      window.clearTimeout(tracker.retryTimer);
      tracker.retryTimer = undefined;
      tracker.pending.clear();
      tracker.snapshot = null;
    };
  }, [course.id]);

  // A recarga só sai quando o conjunto de abertas ou o de concluídas muda.
  // Efeito de layout: a aula que abre neste render entra na fila (e o painel
  // mostra "carregando") antes da pintura, sem piscar o aviso de vazio.
  // ponytail: jsdom não distingue efeito de layout de efeito passivo (o act
  // roda os dois antes de devolver), então nenhum teste guarda esta escolha.
  // Trocar por useEffect volta a pintar o aviso de vazio por um quadro.
  useLayoutEffect(() => {
    if (unlockedKey === null) {
      return;
    }

    const tracker = release.current;
    const previous = tracker.snapshot;
    tracker.snapshot = { courseId: course.id, unlocked: unlockedKey, completed: completedKey };
    const unlocked = parseUnlockedKey(unlockedKey);

    // A miniatura é pública e já vinha com a aula fechada: não conta.
    const delivered = (lessonId: string) =>
      latestContent.current.has(lessonId)
      || latestAssets.current.some(
        (asset) => asset.lessonId === lessonId && asset.kind !== "lesson_thumbnail",
      );
    // Liga ou desliga o "carregando" das aulas dadas (só elas).
    const markReleasing = (lessonIds: string[], on: boolean) => {
      if (lessonIds.length === 0) {
        return;
      }
      setReleasingLessonIds((current) => {
        const next = new Set(current);
        for (const lessonId of lessonIds) {
          if (on) {
            next.add(lessonId);
          } else {
            next.delete(lessonId);
          }
        }
        return next;
      });
    };
    // Tira da fila a aula que chegou, ou que já gastou as tentativas, e arma a
    // próxima tentativa se sobrou aula. Relógio do aparelho adiantado: até 3
    // tentativas perto do prazo (janela de 2 min). Fora dela, ou em aula sem
    // prazo (sequencial), uma só: aula que volta vazia é aula sem conteúdo
    // protegido (texto só no currículo, quiz, embed sem linha).
    const settle = () => {
      const checkedAt = Date.now();
      for (const [lessonId, entry] of tracker.pending) {
        const inSkewWindow =
          entry.unlocksAt !== null && checkedAt - entry.unlocksAt <= RELEASE_SKEW_WINDOW_MS;
        if (delivered(lessonId) || entry.tries >= (inSkewWindow ? RELEASE_RETRIES : 1)) {
          tracker.pending.delete(lessonId);
        }
      }
      if (tracker.pending.size > 0 && tracker.retryTimer === undefined) {
        tracker.retryTimer = window.setTimeout(() => {
          tracker.retryTimer = undefined;
          for (const entry of tracker.pending.values()) {
            entry.tries += 1;
          }
          void reload();
        }, RELEASE_RETRY_MS);
      }
    };
    const reload = async () => {
      await Promise.all([
        contentSubscription.current?.reload?.(),
        assetsSubscription.current?.reload?.(),
      ]);
      settle();
    };

    if (!previous || previous.courseId !== course.id) {
      // Retrato de partida: aula que o relógio abriu há pouco e que o banco não
      // entregou (relógio adiantado já na montagem) entra na fila.
      const now = Date.now();
      for (const { id, unlocksAt } of unlocked) {
        if (unlocksAt !== null && now - unlocksAt <= RELEASE_SKEW_WINDOW_MS && !delivered(id)) {
          tracker.pending.set(id, { unlocksAt, tries: 0 });
        }
      }
      settle();
      return;
    }
    if (previous.unlocked === unlockedKey && previous.completed === completedKey) {
      return;
    }

    const before = new Set(parseUnlockedKey(previous.unlocked).map(({ id }) => id));
    for (const { id, unlocksAt } of unlocked) {
      if (!before.has(id) && !tracker.pending.has(id)) {
        tracker.pending.set(id, { unlocksAt, tries: 0 });
      }
    }
    // "Carregando" só enquanto a recarga que abriu a aula está no ar. Depois
    // dela a tela mostra o estado real; as novas tentativas seguem por trás e,
    // se o conteúdo chegar numa delas, ele simplesmente aparece.
    const opened = unlocked.filter(({ id }) => !before.has(id)).map(({ id }) => id);
    markReleasing(opened, true);
    void reload().finally(() => markReleasing(opened, false));
  }, [completedKey, course.id, unlockedKey]);

  useEffect(() => {
    if (!enableFirestoreAssets || !enrollmentId) {
      return;
    }

    latestAssets.current = [];
    const subscription = subscribeToCourseAssets(
      course.id,
      (assets) => {
        latestAssets.current = assets;
        setAssetsState({
          assets,
          key: course.id,
          ready: true,
        });
        setFailedReads((reads) => (reads.assets === course.id ? { ...reads, assets: null } : reads));
      },
      () => {
        focusRoomAfterRetry.current = false;
        setFailedReads((reads) => ({ ...reads, assets: course.id }));
        setAssetsState({
          assets: [],
          key: course.id,
          ready: true,
        });
      },
    );
    assetsSubscription.current = subscription;
    return subscription;
  }, [course.id, enableFirestoreAssets, enrollmentId]);

  // B1: subscribe to the gated lesson content for the active course. Only
  // meaningful for an enrolled (or preview) viewer, who passes the enrollment
  // gate in RLS; a permission error degrades gracefully to inline fallback
  // rather than blocking the workspace.
  useEffect(() => {
    if (!enrollmentId) {
      return;
    }

    latestContent.current = new Map();
    const subscription = subscribeToLessonContent(
      course.id,
      (content) => {
        latestContent.current = content;
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
    contentSubscription.current = subscription;
    return subscription;
  }, [course.id, enrollmentId]);

  // As sessões ao vivo do curso. A assinatura morava dentro da aba, que
  // aparecia sempre e, sem sessão marcada, abria uma página vazia. Aqui em
  // cima ela decide se a aba existe. "Agora" é amostrado quando a lista chega
  // (o render tem de ser puro).
  const [liveState, setLiveState] = useState<{ events: CourseEvent[]; now: number; failed: boolean }>({
    events: [],
    now: 0,
    failed: false,
  });
  const eventsSubscription = useRef<ReloadableSubscription | null>(null);
  // Só com matrícula: sem ela a sala não abre, e não há o que assinar.
  useEffect(() => {
    if (previewMode || !enrollmentId) {
      return;
    }

    const current = subscribeToCourseEvents(
      course.id,
      (events) => setLiveState({ events, now: Date.now(), failed: false }),
      // A agenda é acessória: com erro, a sala abre igual, sem aviso. Só a aba
      // das sessões diz que falhou e oferece "Try again" (nunca "nenhuma
      // sessão"); o que já tinha chegado fica.
      () => setLiveState((state) => ({ events: state.events, now: Date.now(), failed: true })),
      // A cancelada aparece marcada na aba das sessões, em vez de sumir.
      { includeCancelled: true },
    );
    eventsSubscription.current = current;
    return () => {
      eventsSubscription.current = null;
      // `?.`: antes o efeito devolvia a inscrição direto, e um dublê de teste
      // sem retorno passava sem erro.
      current?.();
    };
  }, [course.id, enrollmentId, previewMode]);
  // Ficam à vista enquanto não acabaram (a janela comum de course-event.ts);
  // a cancelada, por 7 dias depois da hora marcada.
  const upcomingEvents = liveState.events.filter((event) =>
    event.status === "cancelled"
      ? isCancelledEventShown(event.startsAt, liveState.now)
      : getEventLiveState(event.startsAt, liveState.now, event.type) !== "over",
  );

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

  // O check da aula e o selo de 100% so se mexem quando o aluno conclui com a
  // sala aberta: a primeira carga do progresso e a linha de base.
  const justCompletedIds = useJustDone(
    progressState.lessonIds,
    progressState.ready && progressState.key === enrollmentId,
  );
  // Painel novo so na troca de aba (ver useTabChanged).
  const tabChanged = useTabChanged(tab);

  // As falhas que valem agora: a de uma inscrição que já acabou não conta.
  const enrollmentFailed = failedReads.enrollment;
  const progressFailed = !previewMode && enrollmentId !== null && failedReads.progress === enrollmentId;
  const assetsFailed = enableFirestoreAssets && enrollmentId !== null && failedReads.assets === course.id;
  const error = enrollmentFailed
    ? "learn.classroom.workspace.enrollmentError"
    : progressFailed
      ? "learn.classroom.workspace.progressLoadError"
      : assetsFailed
        ? "learn.classroom.workspace.assetsError"
        : "";

  // O cartão de erro some quando o "Try again" dá certo: o foco vai para o
  // título da sala, em vez de cair no <body>. Uma falha no caminho desarma.
  useEffect(() => {
    if (error || isLoading || !focusRoomAfterRetry.current) {
      return;
    }
    focusRoomAfterRetry.current = false;
    const title = roomRef.current?.querySelector<HTMLElement>("h1");
    if (title) {
      title.tabIndex = -1;
      title.focus();
    }
  }, [error, isLoading]);

  if (isLoading) {
    // The classroom's one loading state, the same the route file and the
    // creator workspace paint, so a student never sees the wait change look.
    // Com a aula no endereço a sala abre no cabeçalho curto, não na capa (a
    // conta de isCourseHome, sem o progresso, que ainda não chegou).
    return (
      <ClassroomLoading
        label={t("learnWave2.courseLoading.title")}
        short={Boolean(lessonParam) && !previewMode && tab !== "about"}
      />
    );
  }

  if (error) {
    // "Try again" relê TODAS as leituras que falharam, pelos mesmos canais.
    return (
      <section ref={errorCardRef} tabIndex={-1} className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <LoadErrorAlert
          focusRef={errorCardRef}
          onRetry={() => {
            focusRoomAfterRetry.current = true;
            return Promise.all([
              enrollmentFailed ? enrollmentSubscription.current?.reload?.() : undefined,
              progressFailed ? progressSubscription.current?.reload?.() : undefined,
              assetsFailed ? assetsSubscription.current?.reload?.() : undefined,
            ]);
          }}
        >
          {t(error)}
        </LoadErrorAlert>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/learn" className="button-solid px-4 py-2.5 text-sm">
            {t("learn.classroom.workspace.backToLearning")}
          </Link>
          {/* Whitelabel: our public course page is not a way out. */}
          {whitelabel ? null : (
            <Link
              href={`/courses/${course.slug}`}
              className="button-outline px-4 py-2.5 text-sm"
            >
              {t("learn.classroom.workspace.openCourse")}
            </Link>
          )}
        </div>
      </section>
    );
  }

  if (!workspaceEnrollment) {
    if (cameFromCheckout) {
      return (
        <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
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
          <p role="status" className="mt-4 flex max-w-2xl items-start gap-2 text-sm leading-7 text-[var(--color-ink-soft)]">
            {/* Até 90s esperando a matrícula: o anel diz que algo está
                andando. Some quando a espera estoura (aí o texto pede ação). */}
            {checkoutGraceExpired ? null : (
              <Loader2 size={18} aria-hidden className="mt-1.5 shrink-0 motion-safe:animate-spin" />
            )}
            {checkoutGraceExpired
              ? t("learn.classroom.workspace.delayedDetails")
              : t("learn.classroom.workspace.openingDetails")}
          </p>
        </section>
      );
    }

    // No enrollment: the same buy popup as the course page and the members
    // area (cover + buy button to the course page), instead of a full page
    // "enrollment required" with a link out. Public course fields only: no
    // lesson content or video is fetched without an enrollment.
    return (
      <>
        <h1 className="sr-only">{course.title}</h1>
        <CourseUnlockModal
          course={{
            id: course.id,
            title: course.title,
            summary: course.summary,
            category: course.category,
            coverImageUrl: getSafeMediaUrl(course.image),
            priceAmountMinor: course.priceAmountMinor,
            currency: course.currency,
          }}
          ctaHref={`/courses/${course.slug}`}
          // No price here: the modal's fallback formats the raw course price
          // in English. The course page owns the real, resolved price. The
          // verb (and the modal's note) still follow it: buy, enroll free, or
          // the neutral "Unlock course" when the price is unknown.
          ctaLabel={t(unlockCopyKeys(course.priceAmountMinor).label)}
          secondaryLink={{ href: "/learn", label: t("learn.classroom.workspace.backToLearning") }}
          onClose={() => router.push("/learn")}
        />
      </>
    );
  }

  const completedLessonIds = progressState.lessonIds;
  const progressReady = progressState.ready && progressState.key === enrollmentId;
  const progressPercent = getCourseProgressPercent(course, completedLessonIds);
  const nextLesson = getNextCourseLesson(course, completedLessonIds)?.lesson ?? null;
  const allLessons = course.modules.flatMap((module) => module.lessons);
  const lessonUnlockStateById = new Map(
    allLessons.map((lesson) => [
        lesson.id,
        // O relógio da recarga (clockNow): a aula abre na tela junto com a busca.
        getLessonUnlockState(course, lesson, workspaceEnrollment, completedLessonIds, new Date(clockNow)),
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
  // Sequencial trancado: a aula que falta concluir (nome + botão na tela).
  const previousRequiredLesson =
    allLessons.find((lesson) => lesson.id === selectedLessonUnlockState?.previousLessonId) ?? null;
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
  // A aula que o relógio acabou de abrir e cujo conteúdo ainda está vindo (só
  // ela: as outras aulas abertas continuam como estavam).
  const selectedLessonReleasing = Boolean(
    selectedLesson && releasingLessonIds.has(selectedLesson.id),
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
  // Aba Materiais: os arquivos de todas as aulas já liberadas (e os do curso
  // inteiro), por módulo e aula. Aula trancada não entra.
  const materialGroups = groupReleasedMaterials(
    course.modules,
    assetsState.key === course.id ? assetsState.assets : [],
    (lessonId) => lessonUnlockStateById.get(lessonId)?.unlocked === true,
  );
  const assetCountByLessonId = new Map<string, number>();
  const thumbnailUrlByLessonId = new Map<string, string>();
  const thumbnailDateByLessonId = new Map<string, number>();
  const courseLessonIds = new Set(allLessons.map((lesson) => lesson.id));
  // Navigation uses public cover images only, never signed private assets.
  const moduleCoverAssets = assetsState.key === course.id
    ? assetsState.assets.filter((asset) => asset.courseId === course.id
      && asset.kind === "module_cover"
      && asset.contentType.startsWith("image/")
      && getSafeMediaUrl(asset.downloadUrl))
    : [];
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
  // E-book nao emite certificado (issue_skillset_certificate recusa).
  const productFormat = course.productFormat ?? "course";
  const certificateHref =
    progressPercent === 100 && !whitelabel && productFormat !== "ebook"
      ? "/learn/credentials"
      : null;
  const selectedLessonNumber = selectedLesson
    ? allLessons.findIndex((lesson) => lesson.id === selectedLesson.id) + 1
    : 0;
  const showModulePosters = course.modules.some((module) =>
    getSafeMediaUrl(getModuleCoverAsset(module, moduleCoverAssets)?.downloadUrl),
  );
  const moduleSummary = selectedModule?.summary?.trim() ? (
    <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--ma-ink-soft)] [overflow-wrap:anywhere]">
      {selectedModule.summary}
    </p>
  ) : null;
  // Sequential navigation. selectedLessonNumber is already the 1-based position
  // in the flattened curriculum, so the neighbours are just its edges. Locked
  // lessons stay reachable, exactly like clicking one in the sidebar strip: the
  // panel is what shows the lock, not the navigation.
  const previousInOrder =
    selectedLessonNumber > 1 ? allLessons[selectedLessonNumber - 2] : null;
  const nextInOrder =
    selectedLessonNumber > 0 ? allLessons[selectedLessonNumber] ?? null : null;
  // A próxima abre numa DATA (drip por prazo): concluir esta não a destranca.
  // O botão de baixo dizia "Next lesson" e não fazia nada; agora diz quando
  // ela abre. (Sequencial não entra aqui: concluir esta é o que abre a
  // próxima, e completeAndFindNext já trata isso.)
  const nextUnlockState = nextInOrder ? lessonUnlockStateById.get(nextInOrder.id) : undefined;
  const nextOpensAt =
    nextUnlockState && !nextUnlockState.unlocked && nextUnlockState.reason === "scheduled"
      ? nextUnlockState.unlocksAt
      : null;
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
    }
  }
  // Aula ABERTA sem capa própria e com link do YouTube: a capa do próprio
  // vídeo. A aula trancada fica sem: o link dela nunca chega à página (a RLS
  // esconde), e mesmo um link no currículo não vira capa enquanto ela está
  // fechada. Vimeo e Bunny ficam de fora. O id já vem limpo
  // ([a-zA-Z0-9_-]) de getTrustedLessonEmbed; o CSP (img-src https:) já cobre
  // i.ytimg.com.
  for (const lesson of allLessons) {
    if (thumbnailUrlByLessonId.has(lesson.id) || !lessonUnlockStateById.get(lesson.id)?.unlocked) {
      continue;
    }
    // Sem objeto de conteúdo, sem capa: o preview do professor pode receber
    // null daqui (preview-tabs.test.tsx dubla assim) e a sala não pode cair.
    const content = resolveLessonContent(lessonContentMap?.get(lesson.id), lesson);
    if (!content) {
      continue;
    }
    const embed = getTrustedLessonEmbed(content?.externalUrl);
    if (embed?.provider === "youtube") {
      thumbnailUrlByLessonId.set(lesson.id, `https://i.ytimg.com/vi/${embed.videoId}/hqdefault.jpg`);
    }
  }
  // Devolve se a gravação deu certo: quem avança para a próxima aula depende
  // disso (ver completeAndFindNext).
  async function toggleLessonCompletion(lessonId: string, completed: boolean): Promise<boolean> {
    if (previewMode) {
      setActionError("creatorEditor.preview.readOnly");
      return false;
    }

    if (!user || !workspaceEnrollment) {
      return false;
    }

    const unlockState = lessonUnlockStateById.get(lessonId);

    if (unlockState && !unlockState.unlocked) {
      setActionError("learn.classroom.workspace.lessonLockedError");
      return false;
    }

    setActionError("");
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
        // Salvou: a aula entra já na lista de concluídas, sem esperar o
        // realtime. Senão, num curso sequencial, "concluir e seguir" abria a
        // próxima como trancada até o canal entregar a escrita. Mesma ordem da
        // assinatura (sort), para a chave das concluídas não mudar de novo.
        setProgressState((current) =>
          current.lessonIds.includes(lessonId)
            ? current
            : { ...current, lessonIds: [...current.lessonIds, lessonId].sort() },
        );
      }

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
      return true;
    } catch {
      setActionError("learn.classroom.workspace.progressSaveError");
      return false;
    } finally {
      setActiveLessonId(null);
    }
  }

  // Hotmart parity: watching to the end completes the lesson and rolls into the
  // next one. That single write also fixes "resume where you left off" — the
  // mount-time fallback already opens getNextCourseLesson (first incomplete),
  // it just never had anything to resume from while completion was manual.
  //
  // Conclui a aula atual (se falta) e devolve a próxima, só se ela abriu.
  async function completeAndFindNext(): Promise<Lesson | null> {
    // Preview writes are hard-blocked upstream; calling through would only
    // surface "Preview mode is read-only" at the end of every clip.
    if (previewMode || !selectedLesson) {
      return null;
    }

    const endedLessonId = selectedLesson.id;

    if (
      !completedLessonIds.includes(endedLessonId)
      && !(await toggleLessonCompletion(endedLessonId, false))
    ) {
      // Não salvou: nada avança. Antes a próxima era proposta mesmo assim e,
      // num curso sequencial, abria trancada e o servidor negava o vídeo. O
      // aviso de erro já está no player.
      return null;
    }

    if (!nextInOrder) {
      return null;
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
      // O mesmo relógio do painel e da recarga.
      new Date(clockNow),
    );

    return nextUnlockState.unlocked ? nextInOrder : null;
  }

  async function handleLessonEnded() {
    const next = await completeAndFindNext();
    if (next) {
      // Não troca em silêncio: o cartão "Próxima aula" sobre o vídeo conta 5 s
      // com "Assistir agora" e "Cancelar". Sem ação, a próxima começa a tocar.
      setNextUp(next);
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

  // O botão sob a aula é um pedido explícito: vai direto para a próxima, sem a
  // contagem de 5 s (ela é para o fim do vídeo, quando ninguém clicou nada).
  async function completeAndGoNext() {
    const next = await completeAndFindNext();
    if (next) {
      selectLesson(next.id);
    }
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
    : creatorArea?.href ?? "/learn";
  const backLabel = inClassroomTab
    ? t("learn.membersHero.backToLesson")
    : creatorArea
      ? t("learn.memberArea.backToArea").replace("{name}", () => creatorArea.name)
      : t("learn.membersHero.back");

  // Sem aula, a sala abre no que o produto entrega: a comunidade, ou a aba
  // de lives do evento ao vivo. A aba Lessons sai da barra (repetiria a
  // mesma tela); em qualquer outro caso sem aula ela mostra o aviso vazio.
  const emptyDefaultTab: ClassroomTab | null =
    totalLessonCount > 0 || tab !== "lesson"
      ? null
      : productFormat === "community" && communityEnabled
        ? "community"
        : productFormat === "live_event" && !previewMode
          ? "lives"
          : null;
  const activeTab = emptyDefaultTab ?? tab;
  // Evento ao vivo depois da data: a aba fica, com "ja aconteceu" e a
  // gravacao (a aula que o professor acrescentar), se houver.
  const sessionAlreadyHappened =
    productFormat === "live_event"
    && liveState.events.some(
      (event) => event.status !== "cancelled" && Date.parse(event.startsAt) <= liveState.now,
    );

  // As abas que este curso tem. Materiais só quando os arquivos do curso são
  // lidos (cursos publicados por professor); lives, comunidade e mensagens não
  // existem na pré-visualização — e comunidade só se o professor ligou.
  const classroomTabs: ClassroomTabItem[] = [
    ...(emptyDefaultTab ? [] : [{ id: "lesson" as const, label: t("creatorEditor.preview.tabs.lesson") }]),
    ...(enableFirestoreAssets
      ? [{ id: "materials" as const, label: t("creatorEditor.preview.tabs.materials"), count: materialGroups.count }]
      : []),
    ...(!previewMode && (upcomingEvents.length > 0 || activeTab === "lives" || productFormat === "live_event")
      ? [{ id: "lives" as const, label: t("creatorEditor.preview.tabs.lives") }]
      : []),
    ...(communityEnabled
      ? [{ id: "community" as const, label: t("creatorEditor.preview.tabs.community"), count: openQuestionCount }]
      : []),
    ...(previewMode ? [] : [{ id: "messages" as const, label: t("creatorEditor.preview.tabs.messages") }]),
    { id: "review", label: t("creatorEditor.preview.tabs.review") },
    { id: "about", label: t("creatorEditor.preview.tabs.about") },
  ];

  return (
    <div
      ref={roomRef}
      className="member-classroom"
      data-members-theme={course.membersTheme ?? "light"}
    >
      {isCourseHome ? (
        <MembersAreaHeroBand
          course={course}
          coverAsset={membersCoverAsset}
          progressPercent={previewMode || totalLessonCount === 0 ? null : progressPercent}
          completedCount={previewMode || totalLessonCount === 0 ? null : completedLessonCount}
          totalCount={previewMode || totalLessonCount === 0 ? null : totalLessonCount}
          certificateHref={previewMode ? null : certificateHref}
          backHref={backHref}
          backTo={inClassroomTab ? "lesson" : "courses"}
          backLabel={backLabel}
          // A aula que a sala abriria (a do endereco, senao a primeira nao
          // concluida): o mesmo calculo de selectedLesson, sem leitura nova.
          primaryAction={
            // Só com o progresso em mãos: antes dele, quem já começou via
            // "Start lesson 1" piscar. O preview não tem progresso.
            selectedLesson && (previewMode || progressReady)
              ? {
                  href: classroomTabHref(basePath, "lesson", selectedLesson.id),
                  label: productFormat === "ebook"
                    ? t("learn.membersHero.openFile")
                    : completedLessonIds.length === 0 && selectedLesson.id === allLessons[0]?.id
                      ? t("learn.membersHero.start")
                      : t("learn.membersHero.continue").replace("{title}", () => selectedLesson.title),
                }
              : null
          }
        />
      ) : (
        <header className="member-classroom-head">
          {/* No celular so a seta fica a vista (o rotulo continua sendo o
              nome do link): "← Maria Fernanda's members area" espremia o nome
              do curso ate sumir. */}
          <Link href={backHref} className="member-classroom-head__back">
            ← <span className="max-[640px]:sr-only">{backLabel}</span>
          </Link>
          <div className="member-classroom-head__main">
            {/* O nome do CURSO, nao o titulo da area de membros: esse e a
                saudacao da capa, e quem o preenche com o proprio nome deixava
                a sala inteira sem dizer que curso era. */}
            <h1 className="member-classroom-head__title">
              {course.title}
            </h1>
            {activeTab === "lesson" && selectedLesson ? (
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
          {/* A barra da casa (ui/progress-bar), nas cores do curso: o trilho na
              linha do curso vem do CSS da sala, o preenchimento no acento. Ela
              desliza até a marca nova (transform), em vez de saltar. */}
          <ProgressBar
            value={progressPercent}
            label={t("learn.paths.percentComplete").replace("{percent}", () => String(progressPercent))}
            className="member-classroom-head__progress"
            fillClassName="bg-[var(--ma-accent)]"
          />
          <span className="member-classroom-head__percent inline-flex items-center gap-1">
            {progressPercent}%
            {/* O marco: a barra chegou ao fim (o mesmo selo do construtor). */}
            {progressPercent === 100 ? <MilestoneSeal animate={justCompletedIds.size > 0} /> : null}
          </span>
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
        active={activeTab}
        lessonId={selectedLesson?.id ?? null}
        tabs={classroomTabs}
        // Na capa a 100% o certificado já é a ação principal do hero (mesmas
        // condições do MembersAreaHeroBand acima); aqui seria o mesmo
        // "Get certificate" duas vezes na mesma tela.
        certificateHref={
          isCourseHome && !previewMode && totalLessonCount > 0 ? null : certificateHref
        }
      />

      {/* Sessão começando ou ao vivo: a faixa fica em TODAS as abas. Ao lado
          das leituras, não dentro delas: com a agenda falhando, a sala abre
          igual (a faixa usa o que já chegou). */}
      {previewMode ? null : <ClassroomLiveStrip events={liveState.events} />}

      {/* Um item so da grade para a aba aberta: na troca de aba ele entra
          subindo 8px (motion-panel-in); na carga da pagina, parado. A classe
          fixa leva o respiro de 24px ate a moldura da sala (globals.css): sem
          ela os paineis encostavam na borda e o video passava da tela no
          celular. */}
      <div className={tabChanged ? "member-classroom-body motion-panel-in" : "member-classroom-body"}>
      {activeTab === "lesson" && totalLessonCount === 0 ? (
        <section className="member-resource-panel">
          <p className="text-sm text-[var(--color-ink-soft)]">{t("learn.classroom.workspace.noLessons")}</p>
        </section>
      ) : null}

      {activeTab === "lesson" && totalLessonCount > 0 ? (
      <div className="member-classroom-layout">
        <section id="member-lesson-player" className="member-classroom-player">
        {actionError ? (
          <InlineAlert tone="error" className="mb-5">
            {t(actionError)}
          </InlineAlert>
        ) : null}
        {selectedLesson && resolvedSelectedLesson ? (
          <LessonContentPanel
            assets={selectedLessonAssets}
            courseId={course.id}
            enrollmentId={workspaceEnrollment?.id ?? null}
            enableFirestoreAssets={enableFirestoreAssets}
            isLoadingAssets={
              Boolean(
                enableFirestoreAssets
                  && (!assetsState.ready || assetsState.key !== course.id),
              )
              // Aula com texto no próprio currículo já tem o que mostrar: o
              // player fica em "Text-first lesson", não em "carregando".
              || (selectedLessonReleasing && !resolvedSelectedLesson?.contentText?.trim())
            }
            // Aula liberada agora com o texto já no currículo: nada a esperar
            // (o mesmo critério de isLoadingAssets acima).
            isLoadingContent={
              isLessonContentLoading
              || (selectedLessonReleasing && !resolvedSelectedLesson?.contentText?.trim())
            }
            lesson={resolvedSelectedLesson}
            onEnded={handleLessonEnded}
            unlockState={selectedLessonUnlockState}
            previousRequiredLesson={previousRequiredLesson}
            underHero={isCourseHome}
            onSelectLesson={selectLesson}
            previewMode={previewMode}
            lessonComments={
              // No fim do painel, depois do material (paridade Hotmart, P3):
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
          // As margens negativas anulam o padding do cartao (16px no celular,
          // 24px acima de 768): presa no pe da tela, a barra cobre o cartao de
          // borda a borda, sem o texto passando pelos lados.
          <nav
            aria-label={t("creatorEditor.preview.lessonNavigation")}
            className="sticky bottom-0 z-20 -mx-4 mt-5 flex flex-wrap items-center justify-center gap-3 border-t border-[var(--color-line)] bg-inherit px-4 py-3 md:-mx-6 md:px-6"
          >
            {/* "Anterior" morava aqui, sozinho, sem "proxima" ao lado. Os dois
                agora ficam junto do titulo (LessonStepper), uma vez so. */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <button
                type="button"
                onClick={() => setLessonListOpen(true)}
                // A partir de 1181px a playlist ja esta ao lado do video (o
                // layout vira uma coluna em max-width: 1180px).
                className="button-outline flex-1 px-4 py-2.5 text-sm sm:flex-none min-[1181px]:hidden"
              >
                {t("creatorEditor.preview.allLessons").replace("{count}", () => String(totalLessonCount))}
              </button>
              {/* One action instead of "Mark complete" + "Next": completing
                  and advancing is a single intent, and it gives every backend
                  the same auto-advance semantics even where the player never
                  reports "ended". Un-marking still lives on the lesson cards
                  in the curriculum strip.
                  Last lesson done: the action is the certificate, not a
                  "Completed" button that does nothing. */}
              {!previewMode
                && certificateHref
                && !nextInOrder
                && completedLessonIds.includes(selectedLesson.id) ? (
                <Link
                  href={certificateHref}
                  className="button-solid flex-1 px-4 py-2.5 text-sm sm:flex-none"
                >
                  {t("learn.classroom.workspace.certificate")}
                </Link>
              ) : (
              <button
                type="button"
                onClick={completeAndGoNext}
                disabled={
                  previewMode
                  || Boolean(
                    selectedLessonUnlockState
                      && !selectedLessonUnlockState.unlocked,
                  )
                  || activeLessonId === selectedLesson.id
                  || ((!nextInOrder || Boolean(nextOpensAt)) && completedLessonIds.includes(selectedLesson.id))
                }
                className="button-solid flex-1 px-4 py-2.5 text-sm sm:flex-none"
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
                          ? nextOpensAt
                            // "Next lesson · Unlocks Nov 24, 2026": a mesma frase
                            // da playlist, dita de qual aula se trata.
                            ? `${t("learn.classroom.nextLesson.title")} · ${t("learn.classroom.lesson.unlocks").replace("{date}", () => formatUnlockDate(nextOpensAt, locale))}`
                            : t("learn.classroom.nextLesson.title")
                          : t("learn.classroom.curriculum.completed")
                        : nextInOrder && !nextOpensAt
                          ? t("learn.classroom.workspace.completeAndNext")
                          : t("learn.classroom.workspace.complete")}
              </button>
              )}
            </div>
          </nav>
        ) : null}
        </section>

        {/* Ao lado do vídeo mora a PLAYLIST — não um cartão de números
            ("Aula 3/12 · Arquivos 2"), nem "Continuar" (a aula atual já está
            destacada), nem "links do workspace" (a única saída é "← My courses"
            no topo; a página de vendas não pertence à sala). */}
        <aside className="member-classroom-sidebar min-w-0">
          {/* Sem arte de modulo os posters eram so numero + titulo: os mesmos
              grupos da playlist logo abaixo. A descricao do modulo fica. */}
          {showModulePosters ? (
            <nav className="min-w-0 max-w-full" aria-label={t("learn.classroom.curriculum.modules")}>
              <h2 className="mb-2 text-sm font-semibold text-[var(--ma-ink)]">
                {t("learn.classroom.curriculum.modules")}
              </h2>
              <ol className="flex min-w-0 max-w-full gap-3 overflow-x-scroll p-1 [scrollbar-width:auto]">
                {course.modules.map((module, moduleIndex) => {
                  const coverUrl = getSafeMediaUrl(getModuleCoverAsset(module, moduleCoverAssets)?.downloadUrl);
                  const targetLesson = module.lessons.find((lesson) => !completedLessonIds.includes(lesson.id))
                    ?? module.lessons[0];
                  const isCurrent = selectedModule?.id === module.id;
                  return (
                    <li key={module.id} className="shrink-0">
                      <button
                        type="button"
                        className="group block w-[120px] rounded-md text-left text-[var(--ma-ink)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--ma-accent-ink)] disabled:cursor-default disabled:opacity-60 sm:w-[160px]"
                        aria-label={t("learn.classroom.curriculum.openModule").replace("{title}", () => module.title)}
                        aria-current={isCurrent ? "true" : undefined}
                        disabled={!targetLesson}
                        onClick={() => { if (targetLesson) selectLesson(targetLesson.id); }}
                      >
                        <span className={`relative block aspect-[2/3] w-full overflow-hidden rounded-md border-2 bg-[var(--ma-surface-2)] ${isCurrent ? "border-[var(--ma-accent-ink)]" : "border-transparent group-hover:border-[var(--ma-line)]"}`}>
                          {coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-3xl font-semibold text-[var(--ma-ink-soft)]">
                              {moduleIndex + 1}
                            </span>
                          )}
                        </span>
                        <span className="mt-2 block text-sm font-semibold [overflow-wrap:anywhere]">{module.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {moduleSummary}
            </nav>
          ) : moduleSummary}
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
            justCompletedIds={justCompletedIds}
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
      {activeTab === "materials" && enableFirestoreAssets ? (
        <CourseMaterialsPanel
          groups={materialGroups}
          isLoading={Boolean(
            enableFirestoreAssets
              && (!assetsState.ready || assetsState.key !== course.id),
          )}
        />
      ) : null}

      {activeTab === "lives" && !previewMode ? (
        <CourseEventsAgenda
          upcoming={upcomingEvents}
          now={liveState.now}
          failed={liveState.failed}
          onRetry={() => eventsSubscription.current?.reload?.()}
          alreadyHappened={sessionAlreadyHappened}
          replayHref={allLessons[0] ? classroomTabHref(basePath, "lesson", allLessons[0].id) : null}
        />
      ) : null}

      {activeTab === "community" && communityEnabled ? (
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

      {activeTab === "messages" && !previewMode ? <CourseMessagesPanel courseId={course.id} whitelabel={whitelabel} /> : null}

      {activeTab === "review" ? (
        <CourseReviewPanel
          courseId={course.id}
          progressPercent={progressPercent}
          // Sem trilha de aulas (outro tipo, ou nenhuma aula) nao ha 50% a
          // cumprir. Mesma regra de submit_course_review.
          requiresProgress={productFormat === "course" && totalLessonCount > 0}
          previewMode={previewMode}
        />
      ) : null}
      </div>

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
// teacher-event-studio writes). The workspace subscribes and only lists the tab
// when there is a session; opened by its address with none, it says so.
function CourseEventsAgenda({
  upcoming: listed,
  now,
  failed = false,
  onRetry,
  alreadyHappened = false,
  replayHref = null,
}: {
  upcoming: CourseEvent[];
  now: number;
  failed?: boolean;
  onRetry?: () => Promise<unknown> | void;
  alreadyHappened?: boolean;
  replayHref?: string | null;
}) {
  const { t, locale } = useTranslation();
  // O relógio que anda: "Happening now" e o "Join now" aparecem na hora, sem
  // recarregar (antes o "agora" parava na hora em que a lista chegou).
  const clock = useNow();
  const panelRef = useRef<HTMLElement>(null);
  const upcoming = listed.filter(
    (event) => event.status === "cancelled" || getEventLiveState(event.startsAt, clock, event.type) !== "over",
  );

  // now = 0: a primeira leitura ainda não voltou. Não dá para dizer "nenhuma".
  if (now === 0) {
    return null;
  }

  // A leitura falhou: o erro e "Try again", nunca "nenhuma sessão marcada"
  // (para quem comprou um evento ao vivo, a sessão é o produto inteiro).
  if (failed) {
    return (
      <section ref={panelRef} tabIndex={-1} className="member-resource-panel">
        <LoadErrorAlert focusRef={panelRef} onRetry={() => onRetry?.()}>
          {t("learnWave2.agenda.loadError")}
        </LoadErrorAlert>
      </section>
    );
  }

  if (upcoming.length === 0) {
    return (
      <section className="member-resource-panel">
        <p className="text-sm text-[var(--color-ink-soft)]">
          {t(alreadyHappened ? "learnWave2.agenda.happened" : "learnWave2.agenda.empty")}
        </p>
        {alreadyHappened && replayHref ? (
          <Link href={replayHref} className="button-outline mt-4 inline-flex items-center gap-2 px-5 py-2.5 text-sm">
            <PlayCircle size={16} aria-hidden />
            {t("learnWave2.agenda.replay")}
          </Link>
        ) : null}
      </section>
    );
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
          // Prazo nunca fica "ao vivo" nem "Join now" (getEventLiveState):
          // aparece como data de entrega, com "Open link".
          const isDeadline = event.type === "deadline";
          const state = getEventLiveState(event.startsAt, clock, event.type);
          const isLiveNow = state === "live";
          // De 15 min antes em diante, o botão de entrar ganha destaque.
          const isJoinTime = isLiveNow || state === "startingSoon";
          const isCancelled = event.status === "cancelled";
          const date = formatEventDateTime(event.startsAt, locale, t("platform.events.datePending"));
          const when = isDeadline ? t("platform.events.dueBy").replace("{when}", () => date) : date;
          const updatedAt = isCancelled ? null : getEventUpdatedAt(event);
          const joinUrl = isValidExternalEventUrl(event.externalUrl)
            ? event.externalUrl
            : null;

          return (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border fine-rule bg-[var(--color-surface-soft)] px-5 py-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="member-meta-chip">
                    {t(`creatorPanel.events.type.${event.type}`)}
                  </span>
                  {isCancelled ? (
                    <span className="member-meta-chip">{t("creatorPanel.events.status.cancelled")}</span>
                  ) : isLiveNow ? (
                    <span className="rounded-full bg-[rgba(178,34,52,0.1)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent-fg)]">
                      {t("learnWave2.agenda.now")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--color-primary)]">
                  {event.title}
                </p>
                <p className="mt-1 text-xs font-semibold text-[var(--color-ink-soft)]">
                  {isCancelled ? <s>{when}</s> : when}
                </p>
                {updatedAt ? (
                  <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                    {t("learnWave2.eventsHub.updated").replace("{date}", () =>
                      formatEventDateTime(updatedAt, locale, t("platform.events.datePending")),
                    )}
                  </p>
                ) : null}
              </div>
              {/* Cancelada: sem link de entrar e sem calendário. */}
              {isCancelled ? null : joinUrl ? (
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${isJoinTime ? "button-accent" : "button-outline"} inline-flex items-center gap-2 px-5 py-2.5 text-sm`}
                >
                  <PlayCircle size={16} aria-hidden />
                  {t(isDeadline ? "platform.events.openLink" : isJoinTime ? "learnWave2.agenda.join" : "learnWave2.agenda.open")}
                </a>
              ) : (
                <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
                  {t(noJoinLinkKey(event.type))}
                </span>
              )}
              {!isCancelled && state === "upcoming" ? (
                <div className="basis-full">
                  <EventCalendarActions event={event} joinUrl={joinUrl} />
                </div>
              ) : null}
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
  // O dono do curso que tambem esta matriculado modera daqui (fixa, apaga).
  // O banco confere de novo (owns_course_reference).
  const { user } = useAuth();
  const canModerate = Boolean(user && instructorId && user.uid === instructorId);

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
        canModerate={canModerate}
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
  backLabel,
  primaryAction,
}: {
  course: Course;
  coverAsset?: CourseAsset;
  progressPercent: number | null;
  completedCount: number | null;
  totalCount: number | null;
  certificateHref: string | null;
  backHref: string;
  primaryAction: { href: string; label: string } | null;
  /** Voltar sobe um nivel: da aba About, para a aula; da aula, para /learn. */
  backTo: "courses" | "lesson";
  backLabel: string;
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
      // Titulo proprio na capa (muitas vezes o nome do professor) e sem
      // subtitulo: o nome do curso entra na linha de baixo, senao a capa nao
      // dizia em nenhum lugar que curso e este.
      subtitle={
        course.membersSubtitle
          ?? (course.membersTitle && course.membersTitle !== course.title ? course.title : null)
      }
      description={course.membersDescription ?? course.summary ?? null}
      progressPercent={progressPercent}
      completedCount={completedCount}
      totalCount={totalCount}
      certificateHref={certificateHref}
      backHref={backHref}
      backTo={backTo}
      backLabel={backLabel}
      primaryAction={primaryAction}
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

function formatUnlockMessage(
  unlockState: LessonUnlockState,
  locale: string,
  t: (key: string) => string,
  // Sequencial: o nome da aula que falta concluir, quando se sabe qual é.
  previousTitle: string | null = null,
) {
  if (unlockState.unlocked) {
    return t("learn.classroom.lesson.available");
  }

  if (unlockState.reason === "previous_lesson_required") {
    return previousTitle
      ? t("learn.classroom.lesson.previousRequiredNamed").replace("{title}", () => previousTitle)
      : t("learn.classroom.lesson.previousRequired");
  }

  if (unlockState.unlocksAt) {
    const date = formatUnlockDate(unlockState.unlocksAt, locale);
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

// "Mark complete" used to live at the end of this panel. It now sits in the
// sticky lesson action bar with Previous / All lessons / Next, so the student
// never has to scroll past the discussion to find it.
function LessonContentPanel({
  assets,
  autoplay = false,
  courseId,
  enrollmentId,
  enableFirestoreAssets,
  isLoadingAssets,
  isLoadingContent,
  lesson,
  lessonComments = null,
  nextUp = null,
  onCancelNextUp,
  onEnded,
  onPlayNextUp,
  onSelectLesson,
  previewMode,
  previousRequiredLesson = null,
  underHero = false,
  unlockState,
}: {
  assets: CourseAsset[];
  /** Curso da aula: o quiz é lido por curso + aula (o id da aula sozinho não é único). */
  courseId: string;
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
  /** Comentarios da aula (feed da comunidade filtrado), no fim do painel.
   *  O painel nao sabe de comunidade: quem monta e a sala, que tem o caminho
   *  base e o numero da aula. */
  lessonComments?: ReactNode;
  onEnded: () => void;
  /** Abre outra aula da sala (o botão "Go to that lesson" da aula trancada). */
  onSelectLesson?: (lessonId: string) => void;
  previewMode: boolean;
  /** Sequencial trancado: a aula que falta concluir antes desta. */
  previousRequiredLesson?: Pick<Lesson, "id" | "title"> | null;
  /** A capa do curso está acima do painel (primeira visita, preview, About). */
  underHero?: boolean;
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
  // fetchCourseAssets ordena pela ordem dos anexos (posição, nome), então
  // um `.find()` aqui escolhia pela ordem da lista: quem regravava e subia
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
  // Sem video, quem decide o aviso e o CORPO da aula, nao o tipo: aula nova
  // nasce "video" e o professor nao troca mais o tipo (decisao de 14/09). Aula
  // so de leitura nao pode dizer "Media not attached yet". A descricao nao
  // conta: quase toda aula de video tem uma linha de resumo. O tipo "text"
  // antigo continua valendo.
  // A aula do e-book ("download") e o arquivo, listado logo abaixo.
  const isTextFirstLesson =
    lesson.type === "text"
    || lesson.type === "download"
    || Boolean(lesson.contentText?.trim());
  // Aula de leitura pronta: sem caixa de vídeo nenhuma. Antes ficava ali uma
  // caixa vazia de 260-520px dizendo "leia as notas abaixo", com os
  // comentários entre ela e as notas. Agora o texto vem logo, e depois os
  // comentários. (Trancada ou carregando, a caixa segue com o aviso dela: em
  // curso antigo o link do vídeo chega com o conteúdo protegido, e decidir
  // "só texto" antes disso fazia a página pular.)
  // Aula só de arquivo (PDF, e-book, mapa mental): sem vídeo e com arquivo
  // para baixar. Era "Media not attached yet" em cima do PDF, e a aula
  // parecia quebrada; agora é o arquivo com um botão grande de baixar. Vale
  // para a aula "download" do e-book e para a aula comum que só tem arquivo.
  const lessonFiles = supportingAssets.filter((asset) => asset.kind === "lesson_material");
  const otherSupportingAssets = supportingAssets.filter((asset) => asset.kind !== "lesson_material");
  const contentReady = !locked && !hasPlayableVideo && !isLoadingContent && !isLoadingAssets;
  const fileOnly = contentReady && lessonFiles.length > 0;
  const textOnly = contentReady && (isTextFirstLesson || fileOnly);
  // O tipo dito pelo que a aula mostra, nao pelo campo: aula nova nasce
  // "video" (acima), e uma aula so de leitura ou so de arquivo dizia "VIDEO
  // LESSON" no topo.
  const shownType: LessonType =
    lesson.type === "video" && fileOnly
      ? "download"
      : lesson.type === "video" && textOnly
        ? "text"
        : lesson.type;
  // No preview do professor não se guarda posição: ele não é o aluno.
  // Memoizado porque a referência é objeto: uma nova a cada render reabriria
  // a aula (e o evento "abriu" do funil) a cada quadro.
  const resume = useMemo(
    () =>
      previewMode ? null : lessonPositionRef(viewerId, enrollmentId, lesson.id),
    [enrollmentId, lesson.id, previewMode, viewerId],
  );

  const lessonBody = (
      <div id="member-lesson-content" className="member-lesson-body">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {t("learn.classroom.lesson.content")}
          </p>
          {lesson.isPreview ? (
            <span className="rounded-chip border border-[rgba(178,34,52,0.18)] bg-[rgba(178,34,52,0.05)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-fg)]">
              {t("learn.classroom.lesson.freePreview")}
            </span>
          ) : null}
        </div>
        {!locked && lesson.description ? (
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink)]">
            {lesson.description}
          </p>
        ) : null}
        {/* Traços no lugar de um segundo "Loading lesson content...": o
            aviso de carregando e um so, o da caixa do video. */}
        {!locked && lessonContentPending ? <SkeletonLines /> : null}
        {!locked && lesson.contentText ? (
          <div className="mt-4 whitespace-pre-line rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {linkify(lesson.contentText)}
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
        {isTeacherAiEnabled && !locked && !fileOnly ? <LessonQuiz key={lesson.id} courseId={courseId} lessonId={lesson.id} /> : null}
        {fileOnly ? (
          <>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("learn.classroom.lesson.fileOnlyHint")}
            </p>
            <MaterialFileList files={lessonFiles} large />
            {otherSupportingAssets.length > 0 ? (
              <LessonAssetList assets={otherSupportingAssets} isLoading={false} />
            ) : null}
          </>
        ) : !locked && enableFirestoreAssets ? (
          <LessonAssetList assets={supportingAssets} isLoading={isLoadingAssets} />
        ) : null}
      </div>
  );

  return (
    // F-02: o painel diz que esta carregando enquanto o conteudo ou os anexos
    // nao chegam; o anuncio e um so, o do palco (os comentarios nao repetem).
    <div className="member-lesson-panel" aria-busy={!locked && (isLoadingContent || isLoadingAssets) ? true : undefined}>
      <div className="member-lesson-panel__head">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t(lessonTypeLabels[shownType])}
          </p>
          {/* h2: a aula é a seção principal sob o h1 do curso (antes h4, e
              as subseções h5). Sob a capa, que já traz o título de 56px do
              curso, o da aula vai na letra do texto, em 18px: uma serifa
              grande por tela. No cabeçalho curto a serifa fica com a aula. */}
          <h2
            className={`mt-2 text-[var(--color-ink)] ${underHero ? "text-lg font-semibold" : "display-title text-3xl"}`}
          >
            {lesson.title}
          </h2>
        </div>
        {/* Sem duracao real (o fallback "Self-paced" de published-courses)
            nao ha relogio a mostrar: a duracao nao se digita mais. */}
        {/\d/.test(lesson.duration) ? (
          <span className="member-meta-chip">
            <Clock size={14} aria-hidden />
            {lesson.duration}
          </span>
        ) : null}
      </div>

      {textOnly ? null : (
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
            <h3>{t("learn.classroom.lesson.locked")}</h3>
            <p>
              {unlockState
                ? formatUnlockMessage(unlockState, locale, t, previousRequiredLesson?.title ?? null)
                : t("learn.classroom.curriculum.locked")}
            </p>
            {previousRequiredLesson && onSelectLesson ? (
              <button
                type="button"
                onClick={() => onSelectLesson(previousRequiredLesson.id)}
                className="button-outline mt-3 px-4 py-2 text-sm"
              >
                {t("learn.classroom.lesson.goToPreviousLesson")}
              </button>
            ) : null}
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
        ) : isLoadingContent || isLoadingAssets ? (
          // Com os anexos ainda chegando, a aula de video piscava "Media not
          // attached yet" antes do player aparecer.
          // Carregando = palco no formato 16:9 do player que vem (nada pula
          // quando ele chega) e so um anel girando. O icone de play e a frase
          // ficam para "Media not attached yet": antes as duas caixas eram
          // iguais. O texto segue para o leitor de tela, num aviso so.
          <div className="member-video-empty member-video-empty--loading" role="status">
            <Loader2 size={32} aria-hidden className="motion-safe:animate-spin" />
            <h3 className="sr-only">{t("learn.classroom.lesson.loading")}</h3>
          </div>
        ) : (
          <div className="member-video-empty">
            <PlayCircle size={34} aria-hidden />
            <h3>{t("learn.classroom.lesson.mediaMissing")}</h3>
            <p>{t("learn.classroom.lesson.mediaDetails")}</p>
          </div>
        )}
      </div>
      </VideoDock>
      )}

      {/* "Lesson information" saiu: repetia tipo (acima), duracao (o chip),
          modulo (a lista de aulas) e arquivos (a lista abaixo); a data de
          uma aula trancada segue no aviso do palco.
          O material do professor (descricao, notas, arquivos, quiz) vem logo
          sob a aula, e os comentarios por ultimo. Na aula de video o corpo
          ficava embaixo de uma lista de comentarios sem fim. */}
      {lessonBody}

      {/* Aula trancada: sem comentarios. */}
      {!locked ? lessonComments : null}
    </div>
  );
}

// Linhas de espera do corpo da aula e dos arquivos. Escondidas do leitor de
// tela: o aviso de carregando e um so, o da caixa do video. Cor da paleta do
// curso com reserva na da plataforma, a mesma da ClassroomLoading.
const skeletonWidths = ["w-full", "w-[92%]", "w-3/5"];

function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="mt-4 grid gap-2">
      {skeletonWidths.slice(0, count).map((width) => (
        <span
          key={width}
          className={`block h-3 ${width} rounded-sm bg-[var(--ma-line,var(--color-surface-strong))] motion-safe:animate-pulse`}
        />
      ))}
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
    // Traço, nao a pilula "Loading lesson assets...": ela era identica a
    // "No files are attached" e somava mais um "Loading" na tela.
    return <SkeletonLines count={1} />;
  }

  if (assets.length === 0) {
    return (
      <p className="mt-4 rounded-md bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink-soft)]">
        {t("learn.classroom.resources.emptyLesson")}
      </p>
    );
  }

  return (
    <div className="mt-5 grid gap-3">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {getCourseAssetTitle(asset)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                <FileText size={13} aria-hidden />
                <span>{getCourseAssetKindLabel(asset.kind, t)} - {formatCourseAssetSize(asset.size)}</span>
              </div>
              <MaterialAppHint fileName={asset.fileName} />
            </div>
            {/* "Preview" só vale para vídeo (a aula de amostra). O selo
                "Enrolled" saiu: valia para todo anexo e não dizia nada. */}
            {asset.isPreview && isVideoAssetKind(asset.kind) ? (
              <span className="rounded-chip bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                {t("learn.classroom.resources.preview")}
              </span>
            ) : null}
          </div>

          <LessonAssetActions asset={asset} />
        </div>
      ))}
    </div>
  );
}
