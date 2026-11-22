"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { EmptyState, InlineAlert } from "@/components/ui";
import { SpotArt } from "@/components/ui/spot-art";
import { getMyCourseStudents, type CourseStudent } from "@/lib/data/enrollments";
import { getMyCourseSummaries } from "@/lib/data/teacher-courses";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; students: CourseStudent[]; communities: Set<string> };

// Todos os alunos de todos os produtos, numa lista so. Antes so existia a
// lista por curso (painel do produto > Students); "Members & communities"
// era, na verdade, uma lista de produtos. Cada linha leva para onde o
// professor age: a lista de alunos do produto e a comunidade dele.
export function TeacherStudentsList() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [state, setState] = useState<State>({ status: "loading" });
  const [search, setSearch] = useState("");
  // "Try again" pede a mesma leitura de novo (antes a saida era recarregar a
  // pagina inteira).
  const [attempt, setAttempt] = useState(0);
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) {
      return;
    }

    let alive = true;
    void (async () => {
      try {
        const [students, courses] = await Promise.all([
          getMyCourseStudents(),
          getMyCourseSummaries(uid),
        ]);
        if (alive) {
          setState({
            status: "ready",
            students: [...students].sort((a, b) => Date.parse(b.enrolledAt) - Date.parse(a.enrolledAt)),
            communities: new Set(courses.filter((course) => course.communityEnabled).map((course) => course.id)),
          });
        }
      } catch {
        if (alive) setState({ status: "error" });
      }
    })();

    return () => {
      alive = false;
    };
  }, [uid, attempt]);

  if (state.status === "loading") {
    return (
      <p role="status" className="text-sm text-[var(--color-ink-soft)]">
        {t("teach.studentsPage.loading")}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="grid gap-3">
        <InlineAlert tone="error">{t("teach.studentsPage.error")}</InlineAlert>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((current) => current + 1);
          }}
          className="button-outline justify-self-start px-4 text-sm"
        >
          {t("appErrors.retry")}
        </button>
      </div>
    );
  }

  if (state.students.length === 0) {
    return (
      <EmptyState
        art={<SpotArt scene="noStudents" />}
        title={t("teach.studentsPage.empty")}
        as="h2"
      />
    );
  }

  // Reembolsado, removido ou expirado continua na lista, com a situacao a
  // vista, mas nao conta como aluno: a mesma regra da lista por produto.
  const people = new Set(
    state.students.filter((student) => isActiveEnrollment(student.status)).map((student) => student.uid),
  ).size;
  // Busca so no que ja veio (sem consulta nova): com 300 alunos, achar um
  // nome era rolar 300 linhas.
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? state.students.filter((student) =>
        `${student.displayName} ${student.email} ${student.courseTitle}`.toLowerCase().includes(needle),
      )
    : state.students;

  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--color-ink)]">
          {people === 1
            ? t("teach.studentsPage.countOne")
            : t("teach.studentsPage.countMany").replace("{count}", () => new Intl.NumberFormat(locale).format(people))}
        </p>
        <label htmlFor="students-search" className="sr-only">
          {t("teach.studentsPage.searchLabel")}
        </label>
        <input
          id="students-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("teach.studentsPage.searchPlaceholder")}
          className="min-h-11 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] sm:w-72"
        />
      </div>
      {visible.length === 0 ? (
        <p role="status" className="mt-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("teach.studentsPage.noMatches")}
        </p>
      ) : (
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b fine-rule">
              {[t("courseRoster.studentHead"), t("teach.studentsPage.product"), t("courseRoster.access"), t("courseRoster.progress"), t("courseRoster.joined")].map((head, index) => (
                <th key={head} className={`py-2 pr-4 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]${index === 3 ? " text-right" : ""}`}>
                  {head}
                </th>
              ))}
              <th className="py-2 pr-4">
                <span className="sr-only">{t("courseRoster.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((student) => {
              const name = student.displayName || t("courseRoster.unnamed");
              const course = encodeURIComponent(student.courseId);
              return (
                <tr key={student.enrollmentId} className="border-b fine-rule last:border-b-0">
                  <td className="py-3 pr-4">
                    {/* O nome abre o aluno na lista do produto. Antes eram um ou
                        dois botoes de 44px iguais em toda linha: uma parede na
                        ultima coluna. */}
                    <Link
                      href={`/teach/courses/${course}/manage?section=students`}
                      className="block font-semibold text-[var(--color-primary)] underline decoration-[var(--color-line-strong)] underline-offset-4 hover:decoration-current"
                    >
                      {name}
                      <span className="sr-only">: {t("teach.studentsPage.seeInProduct")}, {student.courseTitle}</span>
                    </Link>
                    {student.email ? (
                      <span className="text-xs text-[var(--color-ink-soft)]">{student.email}</span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4 text-[var(--color-ink)]">{student.courseTitle}</td>
                  <td className="py-3 pr-4">
                    <StatusChip status={student.status} />
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-[var(--color-ink)]">{student.progressPercent}%</td>
                  <td className="py-3 pr-4 text-xs text-[var(--color-ink-soft)]">{formatDate(student.enrolledAt, locale)}</td>
                  <td className="py-3 pr-4">
                    {state.communities.has(student.courseId) ? (
                      <Link
                        href={`/teach/courses/${course}/community`}
                        className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary)] underline underline-offset-4"
                      >
                        {t("teach.studentsPage.community")}
                        <span className="sr-only">: {student.courseTitle}</span>
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

function isActiveEnrollment(status: CourseStudent["status"]): boolean {
  return status === "active" || status === "completed";
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })
    : "--";
}
