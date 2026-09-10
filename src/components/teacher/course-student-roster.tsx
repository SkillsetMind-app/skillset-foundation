"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { Locale } from "@/lib/i18n/config";
import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ExportTableButton } from "@/components/shared/export-table-button";
import { StatusChip } from "@/components/shared/status-chip";
import { PanelCard } from "@/components/teacher/course-commerce-panels";
import { CourseAccessPanel } from "@/components/teacher/course-access-panel";
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
  creator: "Granted by creator",
  manual_demo: "Demo",
};

const progressFilters = [
  { value: "all", label: "courseRoster.progressAll" },
  { value: "not_started", label: "courseRoster.notStarted" },
  { value: "in_progress", label: "courseRoster.inProgress" },
  { value: "completed", label: "courseRoster.completed" },
] as const;

const statusFilters = [
  { value: "all", label: "courseRoster.accessAll" },
  { value: "active", label: "courseRoster.active" },
  { value: "completed", label: "courseRoster.completed" },
  { value: "refunded", label: "courseRoster.refunded" },
  { value: "revoked", label: "courseRoster.revoked" },
  { value: "expired", label: "courseRoster.expired" },
] as const;

type ProgressFilter = (typeof progressFilters)[number]["value"];
type StatusFilter = (typeof statusFilters)[number]["value"];

const messageErrorKeys: Record<string, string> = {
  "Sign in before sending a message.": "courseRoster.signInError",
  "A valid course id is required.": "courseRoster.courseIdError",
  "A valid student id is required.": "courseRoster.studentIdError",
  "Message cannot be empty.": "courseRoster.emptyMessage",
  "Course not found.": "courseRoster.courseNotFound",
  "You can only send messages in your own thread.": "courseRoster.ownThread",
  "You cannot message yourself.": "courseRoster.selfMessage",
  "Only enrolled students can use course messages.": "courseRoster.enrolledOnly",
  "This enrollment does not match the thread.": "courseRoster.threadMismatch",
  "This enrollment cannot send messages.": "courseRoster.inactiveMessage",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function formatDate(value: string, locale: Locale): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "--"
    : date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
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
  const { t } = useTranslation();
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
      const message = sendError && typeof sendError === "object" && "message" in sendError
        && typeof sendError.message === "string" ? sendError.message : "";
      setError(message.startsWith("RATE_LIMIT")
        ? "courseRoster.rateError"
        : Object.hasOwn(messageErrorKeys, message) ? messageErrorKeys[message] : "courseRoster.sendError");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <InlineAlert tone="success" title={t("courseRoster.sent").replace("{name}", () => student.displayName || t("courseRoster.theStudent"))}>
        <Button variant="outline" size="sm" onClick={onClose}>
          {t("courseRoster.close")}
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
        {t("courseRoster.messageLabel").replace("{name}", () => student.displayName || t("courseRoster.student"))}
      </label>
      <textarea
        id={`message-${student.enrollmentId}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        className="w-full rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
        placeholder={t("courseRoster.messagePlaceholder")}
      />
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void handleSend()}
          disabled={sending || !body.trim()}
        >
          {sending ? t("courseRoster.sending") : t("courseRoster.send")}
        </Button>
        <Button variant="outline" size="sm" onClick={onClose}>
          {t("courseRoster.cancel")}
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
  const { t, locale } = useTranslation();
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
      <PanelCard title={t("courseRoster.title")} description={t("courseRoster.description")}>
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">{t("courseRoster.loading")}</p>
      </PanelCard>
    );
  }

  if (state === "error") {
    return (
      <PanelCard title={t("courseRoster.title")} description={t("courseRoster.description")}>
        <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
          {t("courseRoster.loadError")}
        </p>
      </PanelCard>
    );
  }

  if (students.length === 0) {
    return (
      <PanelCard title={t("courseRoster.title")} description={t("courseRoster.description")}>
        <p className="mt-5 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("courseRoster.empty")}
        </p>
      </PanelCard>
    );
  }

  const active = students.filter((s) => s.status === "active" || s.status === "completed").length;

  return (
    <PanelCard
      title={t("courseRoster.title")}
      description={t("courseRoster.count")
        .replace("{total}", () => String(students.length)).replace("{active}", () => String(active))}
    >
      <dl data-testid="roster-summary" className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "courseRoster.enrolled", value: String(stats.total) },
          { label: "courseRoster.new", value: String(stats.newThisWeek) },
          { label: "courseRoster.completed", value: String(stats.completed) },
          { label: "courseRoster.average", value: `${stats.averageProgress}%` },
        ].map((stat) => (
          <div
            key={t(stat.label)}
            className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3"
          >
            <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
              {t(stat.label)}
            </dt>
            <dd className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[var(--color-primary)]">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label htmlFor="roster-search" className="sr-only">
          {t("courseRoster.search")}
        </label>
        <input
          id="roster-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("courseRoster.searchPlaceholder")}
          className="min-h-11 min-w-0 flex-1 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
        />
        <label htmlFor="roster-progress" className="sr-only">
          {t("courseRoster.progressFilter")}
        </label>
        <select
          id="roster-progress"
          value={progress}
          onChange={(event) => setProgress(event.target.value as ProgressFilter)}
          className={selectClasses()}
        >
          {progressFilters.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
        <label htmlFor="roster-status" className="sr-only">
          {t("courseRoster.accessFilter")}
        </label>
        <select
          id="roster-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          className={selectClasses()}
        >
          {statusFilters.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
        <ExportTableButton rows={exportRows} filename={`students-${courseId}`} />
      </div>

      {visible.length === 0 ? (
        <p className="mt-5 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("courseRoster.noMatches")}
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b fine-rule">
                {[t("courseRoster.studentHead"), t("courseRoster.access"), t("courseRoster.progress"), t("courseRoster.certificate"), t("courseRoster.source"), t("courseRoster.joined"), ""].map(
                  (head, index) => (
                    <th
                      key={head || `actions-${index}`}
                      className="py-2 pr-4 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]"
                    >
                      {head || <span className="sr-only">{t("courseRoster.actions")}</span>}
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
                      {student.displayName || t("courseRoster.unnamed")}
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
                    {isCourseStudentComplete(student) ? t("courseRoster.ready") : t("courseRoster.inProgress")}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[var(--color-ink-soft)]">
                    {Object.hasOwn(sourceLabels, student.source) ? t(`courseRoster.source_${student.source}`) : student.source}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[var(--color-ink-soft)]">
                    {formatDate(student.enrolledAt, locale)}
                  </td>
                  <td className="py-3 pr-4">
                    <Button
                      variant="outline"
                      size="sm"
                      // O nome do aluno entra no rotulo, nao no texto visivel:
                      // numa lista de 40 linhas, "Message" sozinho deixa 40
                      // botoes com o mesmo nome acessivel.
                      aria-label={t("courseRoster.messageLabel").replace("{name}", () => student.displayName || t("courseRoster.student"))}
                      onClick={() =>
                        setOpenThread((current) =>
                          current === student.enrollmentId ? null : student.enrollmentId,
                        )
                      }
                    >
                      <MessageSquare aria-hidden="true" size={14} strokeWidth={1.9} />
                      {t("courseRoster.message")}
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
  const [revision, setRevision] = useState(0);
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
  }, [courseId, revision]);

  return <div className="grid min-w-0 gap-5">
    <CourseAccessPanel key={courseId} courseId={courseId} onChange={() => setRevision((value) => value + 1)} />
    <CourseStudentRosterView state={state} students={students} courseId={courseId} />
  </div>;
}
