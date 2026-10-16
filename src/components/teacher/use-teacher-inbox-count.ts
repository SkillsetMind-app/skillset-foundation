"use client";

import { useEffect, useState } from "react";

import { getOpenCommunityQuestions } from "@/lib/data/community-posts";
import { countThreadsAwaitingTeacher } from "@/lib/data/course-messages";
import { getMyCourseSummaries } from "@/lib/data/teacher-courses";

export type TeacherInbox = {
  courses: Awaited<ReturnType<typeof getMyCourseSummaries>>;
  /** Ids das perguntas sem resposta, so das comunidades LIGADAS. */
  questions: string[];
  /** Conversas em que o aluno falou por ultimo; null se a leitura falhou. */
  threads: number | null;
};

const inFlight = new Map<string, Promise<TeacherInbox>>();

/**
 * O que espera pelo professor, lido UMA vez por vez: na pagina Inbox a casca
 * (o numero da barra) e a lista de perguntas pedem ao mesmo tempo e dividem a
 * mesma leitura. Curso com a comunidade desligada fica de fora: o aluno nao
 * tem onde perguntar, e o professor nao tem onde responder.
 *
 * ponytail: so junta pedidos simultaneos, sem cache; cada pagina le de novo.
 * Se o custo por clique pesar, o upgrade e guardar o resultado por um minuto.
 */
export function loadTeacherInbox(teacherId: string): Promise<TeacherInbox> {
  const pending = inFlight.get(teacherId);
  if (pending) return pending;

  const load = (async () => {
    const courses = await getMyCourseSummaries(teacherId);
    const withCommunity = courses.filter((course) => course.communityEnabled).map((course) => course.id);
    const [questions, threads] = await Promise.all([
      getOpenCommunityQuestions(withCommunity, teacherId),
      countThreadsAwaitingTeacher(teacherId).catch(() => null),
    ]);
    return { courses, questions, threads };
  })().finally(() => inFlight.delete(teacherId));

  inFlight.set(teacherId, load);
  return load;
}

/**
 * O numero ao lado de "Inbox" na barra do professor: perguntas da comunidade
 * sem resposta + conversas em que o aluno escreveu por ultimo. `null` desliga
 * (aluno, ou fora do lado do professor).
 *
 * Falhar nao mostra erro: a barra apenas fica sem o numero.
 */
export function useTeacherInboxCount(teacherId: string | null): number | undefined {
  const [result, setResult] = useState<{ teacherId: string; count: number } | null>(null);

  useEffect(() => {
    if (!teacherId) {
      return;
    }

    let alive = true;
    loadTeacherInbox(teacherId).then(
      ({ questions, threads }) => {
        if (alive && threads !== null) setResult({ teacherId, count: questions.length + threads });
      },
      () => {
        // Sem numero; a Caixa de entrada continua a um clique.
      },
    );

    return () => {
      alive = false;
    };
  }, [teacherId]);

  return teacherId && result?.teacherId === teacherId ? result.count : undefined;
}
