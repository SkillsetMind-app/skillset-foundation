"use client";

import type { CourseMessage } from "@/domain/course-message";
import { countThreadsAwaitingReply, normalizeCourseMessageBody } from "@/domain/course-message";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const courseMessagesTable = "course_messages";
type CourseMessageRow = Database["public"]["Tables"]["course_messages"]["Row"];

function rowToMessage(row: CourseMessageRow): CourseMessage {
  return {
    id: row.id,
    courseId: row.course_id,
    courseTitle: row.course_title,
    studentId: row.student_id,
    studentName: row.student_name,
    teacherId: row.teacher_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

// Both directions go through the send_course_message SECURITY DEFINER RPC —
// it gates on the enrollment, rate-limits the sender, and notifies the
// recipient through the notifications rail. Students pass their own uid as
// studentId; teachers pass the student they are replying to.
export async function sendCourseMessage(input: {
  courseId: string;
  studentId: string;
  body: string;
}): Promise<{ success: true; messageId: string }> {
  const body = normalizeCourseMessageBody(input.body);
  if (!body) {
    throw new Error("Message cannot be empty.");
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("send_course_message", {
    p_course_id: input.courseId,
    p_student_id: input.studentId,
    p_body: body,
  });
  if (error) {
    throw error;
  }
  return data as unknown as { success: true; messageId: string };
}

// One student's thread inside one course (the student panel and the teacher
// thread view both render this). Oldest-first for chat layout.
export function subscribeToCourseThread(
  courseId: string,
  studentId: string,
  callback: (messages: CourseMessage[]) => void,
  onError: (error: Error) => void,
  maxMessages = 200,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(courseMessagesTable)
      .select("*")
      .eq("course_id", courseId)
      .eq("student_id", studentId)
      .order("created_at", { ascending: true })
      .limit(maxMessages);
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    callback((data ?? []).map(rowToMessage));
  };

  void load();

  const channel = supabase
    .channel(`course_messages:${courseId}:${studentId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: courseMessagesTable,
        filter: `student_id=eq.${studentId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

// Every message across a teacher's courses, newest-first; the inbox groups
// them into threads client-side (groupCourseMessageThreads).
// `reload()` reads again WITHOUT touching the channel, as in the learner inbox below.
export function subscribeToTeacherMessages(
  teacherId: string,
  callback: (messages: CourseMessage[]) => void,
  onError: (error: Error) => void,
  maxMessages = 400,
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();
  // Only the newest read delivers: a "Try again" that comes back after the
  // re-read of a new message would bring the list without it.
  let active = true;
  let latestLoad = 0;

  const load = async () => {
    const thisLoad = ++latestLoad;
    const { data, error } = await supabase
      .from(courseMessagesTable)
      .select("*")
      .eq("teacher_id", teacherId)
      .order("created_at", { ascending: false })
      .limit(maxMessages);
    if (!active || thisLoad !== latestLoad) {
      return;
    }
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    callback((data ?? []).map(rowToMessage));
  };

  void load();

  const channel = supabase
    .channel(`course_messages:teacher:${teacherId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: courseMessagesTable,
        filter: `teacher_id=eq.${teacherId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return Object.assign(
    () => {
      active = false;
      void supabase.removeChannel(channel);
    },
    { reload: load },
  );
}

// Every conversation of ONE learner, across all their courses — the mirror of
// subscribeToTeacherMessages. Before there was only the per-course read: the learner
// with three courses had three places to reply to the teacher, each at the
// end of the lesson page, and no list of conversations (the teacher had one).
//
// `reload()` reads again WITHOUT touching the channel (the inbox's "Try again"): without the
// gap between leaving and rejoining Realtime, in which a new message
// would be lost, and without a free second read.
export function subscribeToStudentMessages(
  studentId: string,
  callback: (messages: CourseMessage[]) => void,
  onError: (error: Error) => void,
  maxMessages = 400,
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();
  // Only the newest read delivers: a "Try again" that comes back after the
  // re-read of a new message would bring the list without it.
  let active = true;
  let latestLoad = 0;

  const load = async () => {
    const thisLoad = ++latestLoad;
    const { data, error } = await supabase
      .from(courseMessagesTable)
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(maxMessages);
    if (!active || thisLoad !== latestLoad) {
      return;
    }
    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    callback((data ?? []).map(rowToMessage));
  };

  void load();

  const channel = supabase
    .channel(`course_messages:student:${studentId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: courseMessagesTable,
        filter: `student_id=eq.${studentId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return Object.assign(
    () => {
      active = false;
      void supabase.removeChannel(channel);
    },
    { reload: load },
  );
}

/** How many conversations are waiting for the teacher's reply (the last message is the
 *  learner's). Reads only who sent it and when: the message text does not enter the
 *  count. ponytail: the 400 newest messages, the same cap as the inbox; a
 *  conversation idle for longer than that is left out of the number. */
export async function countThreadsAwaitingTeacher(teacherId: string): Promise<number> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from(courseMessagesTable)
    .select("course_id, student_id, sender_id, created_at")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(400);

  if (error) throw error;
  return countThreadsAwaitingReply(
    (data ?? []).map((row) => ({
      courseId: row.course_id,
      studentId: row.student_id,
      senderId: row.sender_id,
      createdAt: row.created_at,
    })),
    teacherId,
  );
}
