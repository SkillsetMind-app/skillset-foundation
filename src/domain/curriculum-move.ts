import type { TeacherCourseModule } from "@/domain/teacher-course";

// Moves a lesson to another module (or another position) without swapping the object: the id
// goes along, and with it video, materials, progress and comments; every field
// of the lesson, including those that left the screen, survives the autosave.
// An out-of-range index falls to the nearest end. Same position, or a lesson or
// module that does not exist: returns the array itself, with no change.
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
