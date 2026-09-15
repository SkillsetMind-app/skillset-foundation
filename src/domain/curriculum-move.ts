import type { TeacherCourseModule } from "@/domain/teacher-course";

// Move uma aula para outro modulo (ou outra posicao) sem trocar o objeto: o id
// vai junto, e com ele video, materiais, progresso e comentarios; todo campo
// da aula, inclusive os que sairam da tela, sobrevive ao autosave.
// Indice fora da faixa cai na ponta mais proxima. Mesma posicao, ou aula ou
// modulo que nao existem: devolve o proprio array, sem mudanca.
export function moveLessonTo(
  modules: TeacherCourseModule[],
  lessonId: string,
  targetModuleId: string,
  targetIndex: number,
): TeacherCourseModule[] {
  const source = modules.find((module) => module.lessons.some((item) => item.id === lessonId));
  const lesson = source?.lessons.find((item) => item.id === lessonId);
  const target = modules.find((module) => module.id === targetModuleId);
  if (!source || !lesson || !target) {
    return modules;
  }

  const remaining = target.lessons.filter((item) => item.id !== lessonId);
  const index = Math.min(Math.max(Math.trunc(targetIndex) || 0, 0), remaining.length);
  if (source === target && source.lessons.indexOf(lesson) === index) {
    return modules;
  }

  const targetLessons = [...remaining.slice(0, index), lesson, ...remaining.slice(index)];
  return modules.map((module) => {
    if (module === target) {
      return { ...module, lessons: targetLessons };
    }
    if (module === source) {
      return { ...module, lessons: module.lessons.filter((item) => item.id !== lessonId) };
    }
    return module;
  });
}
