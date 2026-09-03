"use client";

import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import { PanelCard } from "@/components/teacher/course-commerce-panels";
import { Button, InlineAlert } from "@/components/ui";
import { isCourseStudentComplete } from "@/domain/course-overview";
import { sendCourseMessage } from "@/lib/data/course-messages";
import { getMyCourseStudents, type CourseStudent } from "@/lib/data/enrollments";

// Who bought this course. Hotmart calls this tab "Alunos"; before this the hub
// had 11 tabs and none of them answered "who is in my course" -- the sales tab
// only carries an order id, never a name or an e-mail.
//
// Data comes from the `get_my_course_students` RPC, not a table read: RLS on
// `enrollments` only lets the STUDENT read their own row, so a teacher SELECT
// returns zero rows with no error. See the migration for the full reasoning.
//
// O que faltava depois disso: a tabela vinha sozinha. Numa turma de 40 pessoas
// nao dava para achar ninguem, nem separar quem terminou de quem nem comecou,
// nem falar com um aluno sem sair da tela.

const sourceLabels: Record<string, string> = {
  payment: "One-time purchase",
  subscription: "Subscription",
  free_course: "Free enrollment",
  admin: "Granted by support",
  manual_demo: "Demo",
};

const progressFilters = [
  { value: "all", label: "Any progress" },
  { value: "not_started", label: "Not started (0%)" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
] as const;

const statusFilters = [
  { value: "all", label: "Any access" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "refunded", label: "Refunded" },
  { value: "revoked", label: "Revoked" },
  { value: "expired", label: "Expired" },
] as const;

type ProgressFilter = (typeof progressFilters)[number]["value"];
type StatusFilter = (typeof statusFilters)[number]["value"];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function formatDate(value: string): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "--"
    : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function matchesProgress(student: CourseStudent, filter: ProgressFilter): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return isCourseStudentComplete(student);
  if (filter === "not_started") return student.progressPercent === 0;
  return student.progressPercent > 0 && !isCourseStudentComplete(student);
}

function selectClasses() {
  return "min-h-11 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)]";
}

/**
 * Compositor de mensagem por aluno.
 *
 * `send_course_message` e a MESMA porta que o aluno usa: SECURITY DEFINER,
 * checa a matricula e limita a taxa por remetente. E por isso que nao existe
 * botao de "mensagem para todos" aqui — nao ha envio em lote do outro lado, e
 * um laco no cliente bateria no limite de taxa no terceiro aluno.
 */
function MessageComposer({
  courseId,
  student,
  onClose,
}: {
  courseId: string;
  student: CourseStudent;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    setError("");
    try {
      await sendCourseMessage({ courseId, studentId: student.uid, body });
      setSent(true);
      setBody("");
    } catch (sendError) {
      setError(
        sendError instanceof Error && sendError.message
          ? sendError.message
          : "Could not send the message.",
      );
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <InlineAlert tone="success" title={`Message sent to ${student.displayName || "the student"}.`}>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </InlineAlert>
    );
  }

  return (
    <div className="grid gap-2">
      <label
        htmlFor={`message-${student.enrollmentId}`}
        className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]"
      >
        Message {student.displayName || "student"}
      </label>
      <textarea
        id={`message-${student.enrollmentId}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        className="w-full rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
        placeholder="They get it in their course inbox and as a notification."
      />
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void handleSend()}
          disabled={sending || !body.trim()}
        >
          {sending ? "Sending..." : "Send message"}
        </Button>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function CourseStudentRosterView({
  state,
  students,
  courseId,
  now,
}: {
  state: "loading" | "ready" | "error";
  students: CourseStudent[];
  courseId: string;
  now?: Date;
}) {
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<ProgressFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openThread, setOpenThread] = useState<string | null>(null);
  // Um unico "agora" por montagem: `new Date()` no valor padrao da prop cria
  // uma dependencia nova a cada render, e a janela de "esta semana" andava
  // sozinha entre um render e o seguinte.
  const [mountedAt] = useState(() => new Date());
  const clock = now ?? mountedAt;

  const stats = useMemo(() => {
    const cutoff = clock.getTime() - WEEK_MS;
    const completed = students.filter(isCourseStudentComplete).length;
    return {
      total: students.length,
      newThisWeek: students.filter((student) => {
        const at = new Date(student.enrolledAt).getTime();
        return Number.isFinite(at) && at >= cutoff;
      }).length,
      completed,
      averageProgress: students.length
        ? Math.round(
            students.reduce((sum, student) => sum + student.progressPercent, 0) /
              students.length,
          )
        : 0,
    };
  }, [clock, students]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return students.filter((student) => {
      if (status !== "all" && student.status !== status) return false;
      if (!matchesProgress(student, progress)) return false;
      if (!needle) return true;
      return (
        student.displayName.toLowerCase().includes(needle) ||
        student.email.toLowerCase().includes(needle)
      );
    });
  }, [progress, search, status, students]);

  const exportRows = useMemo(
    () =>
      visible.map((student) => ({
        name: student.displayName,
        email: student.email,
        access: student.status,
        progressPercent: student.progressPercent,
        certificate: isCourseStudentComplete(student) ? "Ready" : "In progress",
        source: sourceLabels[student.source] ?? student.source,
        enrolledAt: student.enrolledAt,
      })),
    [visible],
  );

  if (state === "loading") {
    return (
      <PanelCard title="Students" description="Everyone enrolled in this course.">
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">Loading students...</p>
      </PanelCard>
    );
  }

  if (state === "error") {
    return (
      <PanelCard title="Students" description="Everyone enrolled in this course.">
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
          We could not load the roster. Reload the page — if it keeps failing, contact support.
        </p>
      </PanelCard>
    );
  }

  if (students.length === 0) {
    return (
      <PanelCard title="Students" description="Everyone enrolled in this course.">
        <p className="mt-5 text-sm leading-6 text-[var(--color-ink-soft)]">
          No one is enrolled yet. Buyers show up here the moment a purchase clears, with their
          name, e-mail, and progress — so you can support them without leaving the studio.
        </p>
      </PanelCard>
    );
  }

  const active = students.filter((s) => s.status === "active" || s.status === "completed").length;

  return (
    <PanelCard
      title="Students"
      description={`${students.length} enrolled · ${active} with active access`}
    >
      <dl data-testid="roster-summary" className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Enrolled", value: String(stats.total) },
          { label: "New this week", value: String(stats.newThisWeek) },
          { label: "Completed", value: String(stats.completed) },
          { label: "Average progress", value: `${stats.averageProgress}%` },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3"
          >
            <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
              {stat.label}
            </dt>
            <dd className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[var(--color-primary)]">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label htmlFor="roster-search" className="sr-only">
          Search students by name or e-mail
        </label>
        <input
          id="roster-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or e-mail"
          className="min-h-11 min-w-0 flex-1 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
        />
        <label htmlFor="roster-progress" className="sr-only">
          Filter by progress
        </label>
        <select
          id="roster-progress"
          value={progress}
          onChange={(event) => setProgress(event.target.value as ProgressFilter)}
          className={selectClasses()}
        >
          {progressFilters.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label htmlFor="roster-status" className="sr-only">
          Filter by access
        </label>
        <select
          id="roster-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          className={selectClasses()}
        >
          {statusFilters.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ExportTableButton rows={exportRows} filename={`students-${courseId}`} />
      </div>

      {visible.length === 0 ? (
        <p className="mt-5 text-sm leading-6 text-[var(--color-ink-soft)]">
          No student matches this search and filter. Clear them to see the whole roster.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b fine-rule">
                {["Student", "Access", "Progress", "Certificate", "How", "Joined", ""].map(
                  (head, index) => (
                    <th
                      key={head || `actions-${index}`}
                      className="py-2 pr-4 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]"
                    >
                      {head || <span className="sr-only">Actions</span>}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((student) => (
                <tr key={student.enrollmentId} className="border-b fine-rule last:border-b-0">
                  <td className="py-3 pr-4">
                    <strong className="block font-medium text-[var(--color-ink)]">
                      {student.displayName || "Unnamed student"}
                    </strong>
                    {student.email ? (
                      <a
                        href={`mailto:${student.email}`}
                        className="text-xs text-[var(--color-ink-soft)] underline"
                      >
                        {student.email}
                      </a>
                    ) : null}
                    {openThread === student.enrollmentId ? (
                      <div className="mt-3 max-w-md">
                        <MessageComposer
                          courseId={courseId}
                          student={student}
                          onClose={() => setOpenThread(null)}
                        />
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusChip status={student.status} />
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-[var(--color-ink)]">
                    {student.progressPercent}%
                  </td>
                  {/* "Emitido" nao da para saber daqui: a tabela de certificados
                      so e legivel pelo dono do certificado. Isto e elegibilidade,
                      a mesma regra do fluxo de emissao, e o rotulo diz isso. */}
                  <td className="py-3 pr-4 text-xs text-[var(--color-ink-soft)]">
                    {isCourseStudentComplete(student) ? "Ready to issue" : "In progress"}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[var(--color-ink-soft)]">
                    {sourceLabels[student.source] ?? student.source}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[var(--color-ink-soft)]">
                    {formatDate(student.enrolledAt)}
                  </td>
                  <td className="py-3 pr-4">
                    <Button
                      variant="outline"
                      size="sm"
                      // O nome do aluno entra no rotulo, nao no texto visivel:
                      // numa lista de 40 linhas, "Message" sozinho deixa 40
                      // botoes com o mesmo nome acessivel.
                      aria-label={`Message ${student.displayName || "student"}`}
                      onClick={() =>
                        setOpenThread((current) =>
                          current === student.enrollmentId ? null : student.enrollmentId,
                        )
                      }
                    >
                      <MessageSquare aria-hidden="true" size={14} strokeWidth={1.9} />
                      Message
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  );
}

export function CourseStudentRoster({ courseId }: { courseId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [students, setStudents] = useState<CourseStudent[]>([]);

  useEffect(() => {
    let current = true;
    // ponytail: the RPC returns every course the teacher owns and this filters
    // client-side. One round trip serves any course tab; add `p_course_id` when
    // a single teacher's total roster gets big enough to notice.
    void getMyCourseStudents()
      .then((rows) => {
        if (!current) return;
        setStudents(rows.filter((row) => row.courseId === courseId));
        setState("ready");
      })
      .catch(() => {
        if (!current) return;
        setState("error");
      });
    return () => {
      current = false;
    };
  }, [courseId]);

  return <CourseStudentRosterView state={state} students={students} courseId={courseId} />;
}
