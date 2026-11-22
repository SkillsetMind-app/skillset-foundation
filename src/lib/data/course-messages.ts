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
// `reload()` le de novo SEM mexer no canal, como na caixa do aluno abaixo.
export function subscribeToTeacherMessages(
  teacherId: string,
  callback: (messages: CourseMessage[]) => void,
  onError: (error: Error) => void,
  maxMessages = 400,
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(courseMessagesTable)
      .select("*")
      .eq("teacher_id", teacherId)
      .order("created_at", { ascending: false })
      .limit(maxMessages);
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
      void supabase.removeChannel(channel);
    },
    { reload: load },
  );
}

// Toda conversa de UM aluno, em todos os cursos dele — o espelho de
// subscribeToTeacherMessages. Antes so existia a leitura por curso: o aluno
// com tres cursos tinha tres lugares para responder ao professor, cada um no
// fim da pagina da aula, e nenhuma lista de conversas (o professor tinha).
//
// `reload()` le de novo SEM mexer no canal (o "Try again" da caixa). Desligar
// e religar o canal com o mesmo nome devolvia o canal antigo, ainda saindo, e
// a caixa parava de receber as mensagens novas.
export function subscribeToStudentMessages(
  studentId: string,
  callback: (messages: CourseMessage[]) => void,
  onError: (error: Error) => void,
  maxMessages = 400,
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(courseMessagesTable)
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(maxMessages);
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
      void supabase.removeChannel(channel);
    },
    { reload: load },
  );
}

/** Quantas conversas esperam a resposta do professor (a ultima mensagem e do
 *  aluno). Le so quem mandou e quando: o texto das mensagens nao entra na
 *  conta. ponytail: as 400 mensagens mais novas, o mesmo teto da caixa; uma
 *  conversa parada ha mais tempo que isso fica fora do numero. */
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
