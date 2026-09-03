"use client";

import {
  fetchLessonPosition,
  recordLessonPlayback,
} from "@/lib/data/lesson-playback";

/**
 * Onde a aula parou, em SEGUNDOS, por pessoa e por aula.
 *
 * O "retomar" da plataforma era por AULA — qual aula abrir — nunca por
 * posição: quem parava aos 22 minutos voltava no segundo zero e tinha de
 * arrastar a barra até achar o ponto.
 *
 * A posição mora no BANCO (`lesson_playback`, migração 20260903120000) e o
 * navegador virou a RESERVA. Era o contrário até o PR #186, e o preço era
 * conhecido: a posição ficava por navegador, então quem começava no celular e
 * terminava no computador recomeçava do zero lá.
 *
 * As duas pontas continuam sendo escritas em toda gravação, de propósito:
 * - **banco primeiro na leitura**, porque é ele que atravessa aparelhos;
 * - **navegador sempre**, porque ele responde sem rede e cobre sessão anônima,
 *   preview do professor e a hora em que a escrita no banco falha.
 *
 * Abrir a aula também é gravado, com posição NULA — o banco entende isso como
 * "só registra a visita", sem tocar a posição. É a metade "abriu" do funil:
 * `lesson_progress` só nasce quando a aula é CONCLUÍDA, então quem desiste no
 * meio não deixava rastro nenhum.
 */

const PREFIX = "skillset_lesson_pos:";

/** Abaixo disso não há o que retomar — a pessoa mal abriu a aula. */
const MIN_SECONDS = 5;

/** E o fim fica de fora, para a aula não reabrir nos últimos segundos. */
const END_MARGIN_SECONDS = 15;

/**
 * "Esta pessoa, nesta aula". `enrollmentId` nulo (preview do professor, sessão
 * anônima) mantém tudo no navegador: sem matrícula não há linha a escrever.
 */
export type LessonPositionRef = {
  storageKey: string;
  enrollmentId: string | null;
  lessonId: string;
};

export function lessonPositionRef(
  userId: string | null | undefined,
  enrollmentId: string | null | undefined,
  lessonId: string | null | undefined,
): LessonPositionRef | null {
  if (!userId || !lessonId) {
    return null;
  }

  return {
    storageKey: `${PREFIX}${userId}:${lessonId}`,
    enrollmentId: enrollmentId ?? null,
    lessonId,
  };
}

function readLocal(ref: LessonPositionRef | null): number {
  if (!ref) {
    return 0;
  }

  try {
    const seconds = Number(window.localStorage.getItem(ref.storageKey));

    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    // Navegador com armazenamento bloqueado: sem posição, começa do início.
    return 0;
  }
}

function writeLocal(ref: LessonPositionRef | null, seconds: number): void {
  if (!ref) {
    return;
  }

  try {
    if (seconds <= 0) {
      window.localStorage.removeItem(ref.storageKey);
      return;
    }

    window.localStorage.setItem(ref.storageKey, String(seconds));
  } catch {
    // Cota estourada ou armazenamento bloqueado: retomar é conforto, não
    // pode derrubar a aula.
  }
}

/**
 * Manda para o banco sem esperar e sem quebrar: a aula continua tocando se a
 * rede cair, e o navegador já guardou a mesma posição.
 *
 * ponytail: sem fila e sem trava de concorrência. Os players só gravam a cada
 * 10 s (SAVE_EVERY_SECONDS), então o pior caso de duas escritas se cruzarem na
 * rede custa os 10 s entre elas — e o freio real é `enforce_rate_limit` no
 * servidor. Se um dia a cadência apertar, o lugar de resolver é aqui.
 */
function pushToDatabase(
  ref: LessonPositionRef,
  seconds: number | null,
  duration?: number,
): void {
  if (!ref.enrollmentId) {
    return;
  }

  void recordLessonPlayback(
    ref.enrollmentId,
    ref.lessonId,
    seconds,
    Number.isFinite(duration) ? duration : null,
  ).catch(() => {
    // Sem posição no banco a aula abre no que o navegador guardou.
  });
}

/** A aula foi aberta. Só a visita — a posição guardada não é tocada. */
export function markLessonOpened(ref: LessonPositionRef | null): void {
  if (ref) {
    pushToDatabase(ref, null);
  }
}

/**
 * Banco primeiro (atravessa aparelhos), navegador como reserva quando não há
 * matrícula ou a leitura falha.
 */
export async function readLessonPosition(
  ref: LessonPositionRef | null,
): Promise<number> {
  if (!ref) {
    return 0;
  }

  if (ref.enrollmentId) {
    try {
      const seconds = await fetchLessonPosition(ref.enrollmentId, ref.lessonId);

      if (seconds > 0) {
        return seconds;
      }
    } catch {
      // Cai para o navegador: sem rede a aula ainda retoma neste aparelho.
    }
  }

  return readLocal(ref);
}

/**
 * Grava a posição — ou APAGA, quando ela deixa de valer a pena (começo ou fim
 * da aula). Apagar no fim é o que evita o pior caso: terminar a aula, voltar
 * nela e cair direto nos créditos.
 */
export function saveLessonPosition(
  ref: LessonPositionRef | null,
  seconds: number,
  duration?: number,
): void {
  if (!ref || !Number.isFinite(seconds)) {
    return;
  }

  const nearEnd =
    Number.isFinite(duration)
    && (duration ?? 0) > 0
    && seconds > (duration as number) - END_MARGIN_SECONDS;
  const guardar = seconds < MIN_SECONDS || nearEnd ? 0 : Math.floor(seconds);

  writeLocal(ref, guardar);
  pushToDatabase(ref, guardar, duration);
}

export function clearLessonPosition(ref: LessonPositionRef | null): void {
  if (!ref) {
    return;
  }

  writeLocal(ref, 0);
  pushToDatabase(ref, 0);
}
