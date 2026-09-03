"use client";

/**
 * Onde a aula parou, em SEGUNDOS, por pessoa e por aula.
 *
 * O "retomar" da plataforma era por AULA — qual aula abrir — nunca por
 * posição: quem parava aos 22 minutos voltava no segundo zero e tinha de
 * arrastar a barra até achar o ponto.
 *
 * Por que localStorage e não o banco: `lesson_progress` só registra aula
 * CONCLUÍDA (enrollment_id, lesson_id, user_id, completed_at). Não há coluna
 * de posição, e criar uma é migração de banco — fora desta onda.
 *
 * CAMINHO DE UPGRADE: uma coluna `position_seconds` em `lesson_progress` (ou
 * uma tabela `lesson_playback`) mais um RPC de upsert com a mesma checagem de
 * matrícula que o `record_lesson_progress` já faz. Este módulo então vira o
 * cache local e o banco passa a ser a fonte — o que dá continuidade ENTRE
 * APARELHOS. Hoje a posição é por navegador: quem começa no celular e termina
 * no computador recomeça do zero lá.
 */

const PREFIX = "skillset_lesson_pos:";

/** Abaixo disso não há o que retomar — a pessoa mal abriu a aula. */
const MIN_SECONDS = 5;

/** E o fim fica de fora, para a aula não reabrir nos últimos segundos. */
const END_MARGIN_SECONDS = 15;

/**
 * A chave que identifica "esta pessoa nesta aula". Sem usuário (preview do
 * professor, sessão anônima) devolve null e todo o resto vira no-op — não se
 * guarda posição de quem não se sabe quem é.
 */
export function lessonPositionKey(
  userId: string | null | undefined,
  lessonId: string | null | undefined,
): string | null {
  return userId && lessonId ? `${PREFIX}${userId}:${lessonId}` : null;
}

export function readLessonPosition(key: string | null): number {
  if (!key) {
    return 0;
  }

  try {
    const seconds = Number(window.localStorage.getItem(key));

    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    // Navegador com armazenamento bloqueado: sem posição, começa do início.
    return 0;
  }
}

/**
 * Grava a posição — ou APAGA, quando ela deixa de valer a pena (começo ou fim
 * da aula). Apagar no fim é o que evita o pior caso: terminar a aula, voltar
 * nela e cair direto nos créditos.
 */
export function saveLessonPosition(
  key: string | null,
  seconds: number,
  duration?: number,
): void {
  if (!key || !Number.isFinite(seconds)) {
    return;
  }

  const nearEnd =
    Number.isFinite(duration)
    && (duration ?? 0) > 0
    && seconds > (duration as number) - END_MARGIN_SECONDS;

  try {
    if (seconds < MIN_SECONDS || nearEnd) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, String(Math.floor(seconds)));
  } catch {
    // Cota estourada ou armazenamento bloqueado: retomar é conforto, não
    // pode derrubar a aula.
  }
}

export function clearLessonPosition(key: string | null): void {
  if (!key) {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // idem
  }
}
