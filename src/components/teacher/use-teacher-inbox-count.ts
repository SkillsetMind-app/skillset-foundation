"use client";

import { useEffect, useState } from "react";

import { getOpenCommunityQuestions } from "@/lib/data/community-posts";
import { countThreadsAwaitingTeacher } from "@/lib/data/course-messages";
import { getMyCourseSummaries } from "@/lib/data/teacher-courses";

/**
 * O numero ao lado de "Inbox" na barra do professor: perguntas da comunidade
 * sem resposta + conversas em que o aluno escreveu por ultimo. `null` desliga
 * (aluno, ou fora do lado do professor).
 *
 * Falhar nao mostra erro: a barra apenas fica sem o numero. ponytail: leitura
 * unica por pagina; vira inscricao se o numero precisar mudar sozinho.
 */
export function useTeacherInboxCount(teacherId: string | null): number | undefined {
  const [result, setResult] = useState<{ teacherId: string; count: number } | null>(null);

  useEffect(() => {
    if (!teacherId) {
      return;
    }

    let alive = true;
    void (async () => {
      try {
        const courses = await getMyCourseSummaries(teacherId);
        const [questions, threads] = await Promise.all([
          getOpenCommunityQuestions(courses.map((course) => course.id), teacherId),
          countThreadsAwaitingTeacher(teacherId),
        ]);
        if (alive) setResult({ teacherId, count: questions.length + threads });
      } catch {
        // Sem numero; a Caixa de entrada continua a um clique.
      }
    })();

    return () => {
      alive = false;
    };
  }, [teacherId]);

  return teacherId && result?.teacherId === teacherId ? result.count : undefined;
}
