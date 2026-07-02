// Student <-> teacher course messages (v1). One thread per (course, student)
// enrollment: students write inside their own enrollment, teachers reply only
// to enrolled students. No student<->student messaging on purpose — that keeps
// the abuse surface near zero for a first version.

export type CourseMessage = {
  id: string;
  courseId: string;
  courseTitle: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  senderId: string;
  body: string;
  // ISO string from Supabase created_at.
  createdAt: string;
};

export const COURSE_MESSAGE_MAX_CHARS = 2000;

export function normalizeCourseMessageBody(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, COURSE_MESSAGE_MAX_CHARS);
}

export type CourseMessageThread = {
  // `${courseId}__${studentId}` — mirrors the enrollment id convention.
  key: string;
  courseId: string;
  courseTitle: string;
  studentId: string;
  studentName: string;
  lastMessage: CourseMessage;
  messages: CourseMessage[];
};

// Groups a teacher's messages (any order) into threads sorted by most recent
// activity; messages inside each thread are oldest-first for chat rendering.
export function groupCourseMessageThreads(
  messages: CourseMessage[],
): CourseMessageThread[] {
  const threads = new Map<string, CourseMessageThread>();

  for (const message of messages) {
    const key = `${message.courseId}__${message.studentId}`;
    const existing = threads.get(key);
    if (existing) {
      existing.messages.push(message);
    } else {
      threads.set(key, {
        key,
        courseId: message.courseId,
        courseTitle: message.courseTitle,
        studentId: message.studentId,
        studentName: message.studentName,
        lastMessage: message,
        messages: [message],
      });
    }
  }

  const result = [...threads.values()];
  for (const thread of result) {
    thread.messages.sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    thread.lastMessage = thread.messages[thread.messages.length - 1];
  }
  result.sort(
    (a, b) =>
      Date.parse(b.lastMessage.createdAt) - Date.parse(a.lastMessage.createdAt),
  );
  return result;
}
