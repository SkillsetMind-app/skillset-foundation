"use client";

import { Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { Lesson } from "@/domain/learning";
import { useTranslation } from "@/components/i18n/i18n-provider";

const COUNTDOWN_SECONDS = 5;
/** O aviso entra na região viva um instante DEPOIS de ela existir. */
const ANNOUNCE_DELAY_MS = 50;
/** Tem que bater com a transição de `.member-next-lesson.is-leaving`
 *  (--duration-base, o tempo padrão do sistema). */
const EXIT_MS = 180;

// O cartão "Próxima aula" que sobe sobre o vídeo quando ele termina.
//
// POR QUE ISTO EXISTE
//
// O avanço automático já existia — só acontecia em silêncio: a aula mudava sem
// aviso, sem "cancelar", e o próximo vídeo carregava mas não tocava. Se o
// aluno tinha rolado até a discussão, a troca acontecia fora da tela: ele
// voltava e encontrava outro vídeo, sem saber por quê.
//
// Aqui: título da próxima aula, contagem de 5 s com anel, "Assistir agora" e
// "Cancelar". Sem ação, a próxima começa (o pai troca a aula e pede autoplay).
//
// Entrada e saída são do cartão, não do pai: ele entra subindo (CSS) e, ao
// cancelar, marca `is-leaving`, desce, e SÓ ENTÃO avisa o pai — que o
// desmonta. Sem isso o cartão sumia no mesmo quadro em que aparecia.
export function NextLessonCard({
  lesson,
  onCancel,
  onPlay,
}: {
  lesson: Lesson;
  onCancel: () => void;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [leaving, setLeaving] = useState(false);
  // Região viva que já nasce com o texto muitas vezes não é lida (NVDA/JAWS
  // anunciam MUDANÇAS): ela monta vazia e o texto chega 50ms depois. Timer
  // próprio, fora da contagem e da navegação.
  const [announced, setAnnounced] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounced(true), ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Saindo: a contagem para (senão o cartão em queda ainda trocaria de aula) e
  // o pai só desmonta quando a animação termina.
  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = window.setTimeout(onCancel, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onCancel]);

  useEffect(() => {
    if (leaving) {
      return;
    }

    if (secondsLeft <= 0) {
      onPlay();
      return;
    }

    const timer = window.setTimeout(
      () => setSecondsLeft((current) => current - 1),
      1000,
    );

    return () => window.clearTimeout(timer);
  }, [leaving, secondsLeft, onPlay]);

  const progress = 1 - secondsLeft / COUNTDOWN_SECONDS;

  // Aviso para leitor de tela: UMA vez, quando o cartão aparece. Antes o cartão
  // inteiro era aria-live e o número mudava a cada segundo, então o leitor
  // relia o cartão cinco vezes. O texto usa a contagem inicial (constante),
  // não `secondsLeft`, para não mudar a cada tique; a contagem visível fica
  // fora da árvore de acessibilidade.
  const announcement = t("learn.classroom.nextLesson.announce")
    .replace("{seconds}", () => String(COUNTDOWN_SECONDS))
    .replace("{title}", () => lesson.title);

  // Região rotulada, não diálogo: o cartão não prende o foco nem bloqueia o
  // vídeo, e "dialog" prometia ao leitor de tela uma janela que não existe.
  return (
    <div
      role="region"
      aria-label={t("learn.classroom.nextLesson.title")}
      className={`member-next-lesson ${leaving ? "is-leaving" : ""} absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center gap-3 sm:flex-nowrap rounded-lg bg-[rgba(15,39,68,0.92)] p-3 text-white shadow-[0_18px_36px_rgba(15,39,68,0.35)] backdrop-blur sm:inset-x-auto sm:right-3 sm:max-w-[360px]`}
    >
      <div
        aria-hidden="true"
        className="member-next-lesson__ring grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums"
        style={{
          background: `conic-gradient(var(--ma-accent, var(--color-accent)) ${Math.round(progress * 360)}deg, rgba(255,255,255,0.18) 0deg)`,
        }}
      >
        <span className="grid size-8 place-items-center rounded-full bg-[rgba(15,39,68,0.95)]">
          {secondsLeft}
        </span>
      </div>
      <p className="sr-only" role="status">
        {announced ? announcement : ""}
      </p>
      {/* basis-28 + flex-wrap: no celular o título ficava com 63 a 103px numa
          linha só ("1.2 What Em…"). Agora ele ocupa a linha, em até duas
          linhas, e os botões descem para a direita. Do sm para cima o cartão
          se ajusta ao conteúdo e não quebra (sm:flex-nowrap): com título
          curto os botões desciam à toa. */}
      <div className="min-w-0 flex-1 basis-28">
        {/* A contagem fica só no anel; aqui, "Next lesson" parado (o mesmo
            nome da região, por isso fora da árvore de acessibilidade). */}
        <p aria-hidden="true" className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">
          {t("learn.classroom.nextLesson.title")}
        </p>
        <p className="line-clamp-2 break-words text-sm font-semibold">{lesson.title}</p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* button-solid: na sala ele pinta com a cor do curso e o texto que
            ela pede (--ma-accent / --ma-on-accent). O dourado da plataforma
            com texto branco dava 2.56:1. */}
        <button
          type="button"
          onClick={onPlay}
          className="button-solid inline-flex min-h-11 items-center gap-1.5 px-3 text-xs font-bold"
        >
          <Play aria-hidden="true" size={14} strokeWidth={2.5} />
          {t("learn.classroom.nextLesson.watch")}
        </button>
        <button
          type="button"
          onClick={() => setLeaving(true)}
          aria-label={t("learn.classroom.nextLesson.cancel")}
          className="grid size-11 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" size={16} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
