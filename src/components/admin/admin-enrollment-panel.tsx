"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { BusyLabel, Button, ConfirmDialog, Field, InlineAlert } from "@/components/ui";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import type { Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToAdminUserProfiles } from "@/lib/data/admin-users";
import {
  createAdminEnrollmentForTeacherCourse,
  revokeEnrollment,
  subscribeToAdminGrantedEnrollments,
} from "@/lib/data/enrollments";
import { subscribeToPublishedTeacherCourses } from "@/lib/data/published-courses";

// Nome e e-mail juntos: duas "Maria Lopez" só se separam pelo e-mail.
function accountLabel(user: UserProfile) {
  return user.displayName && user.email ? `${user.displayName} · ${user.email}` : user.displayName || user.email || user.uid;
}

export function AdminEnrollmentPanel() {
  const { t } = useTranslation();
  const copy = "platform.ops.enrollmentPanel";
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [userId, setUserId] = useState("");
  const [learnerFilter, setLearnerFilter] = useState("");
  const [courseId, setCourseId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [readErrors, setReadErrors] = useState({ users: false, courses: false, grants: false });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [grantedEnrollments, setGrantedEnrollments] = useState<Enrollment[]>([]);
  const [isLoadingGranted, setIsLoadingGranted] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [asking, setAsking] = useState<Enrollment | null>(null);
  // O "Try again" rele so o que falhou, pelo reload() de cada inscricao, sem
  // fechar e abrir o canal (com o mesmo nome, o canal novo pegava o velho
  // ainda fechando e a lista parava de se atualizar).
  const subscriptions = useRef<{
    users: { reload: () => Promise<void> } | null;
    courses: { reload: () => Promise<void> } | null;
    grants: { reload: () => Promise<void> } | null;
  }>({ users: null, courses: null, grants: null });
  const [retryingFields, setRetryingFields] = useState(false);
  // O foco vai para o que fica na tela nos dois desfechos: o botao some
  // quando a leitura da certo.
  const panelRef = useRef<HTMLElement | null>(null);
  const grantsRef = useRef<HTMLDivElement | null>(null);

  async function retryFieldReads() {
    if (retryingFields) return;
    panelRef.current?.focus();
    setRetryingFields(true);
    try {
      await Promise.all([
        readErrors.users ? subscriptions.current.users?.reload() : null,
        readErrors.courses ? subscriptions.current.courses?.reload() : null,
      ]);
    } finally {
      setRetryingFields(false);
    }
  }

  useEffect(() => {
    const subscription = subscribeToAdminUserProfiles(
      (nextUsers) => {
        setUsers(nextUsers);
        setReadErrors(current => ({ ...current, users: false }));
        setIsLoadingUsers(false);
      },
      () => {
        setReadErrors(current => ({ ...current, users: true }));
        setIsLoadingUsers(false);
      },
    );
    const store = subscriptions.current;
    store.users = subscription;
    return () => {
      store.users = null;
      subscription();
    };
  }, []);

  useEffect(() => {
    const subscription = subscribeToPublishedTeacherCourses(
      (nextCourses) => {
        setCourses(nextCourses);
        setReadErrors(current => ({ ...current, courses: false }));
        setIsLoadingCourses(false);
      },
      () => {
        setReadErrors(current => ({ ...current, courses: true }));
        setIsLoadingCourses(false);
      },
    );
    const store = subscriptions.current;
    store.courses = subscription;
    return () => {
      store.courses = null;
      subscription();
    };
  }, []);

  useEffect(() => {
    const subscription = subscribeToAdminGrantedEnrollments(
      (nextEnrollments) => {
        setGrantedEnrollments(nextEnrollments);
        setReadErrors(current => ({ ...current, grants: false }));
        setIsLoadingGranted(false);
      },
      () => {
        setReadErrors(current => ({ ...current, grants: true }));
        setIsLoadingGranted(false);
      },
    );
    const store = subscriptions.current;
    store.grants = subscription;
    return () => {
      store.grants = null;
      subscription();
    };
  }, []);

  // O mesmo rótulo da linha da lista e da janela de revogar.
  function learnerLabel(userId: string) {
    const learner = users.find((user) => user.uid === userId);
    return learner?.displayName || learner?.email || userId;
  }

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === courseId) ?? null,
    [courseId, courses],
  );

  // Filtro local sobre as contas que o painel já carregou: achar a pessoa
  // digitando, em vez de rolar a lista do navegador com todas as contas
  // (I-13). Quem já está escolhido fica na lista, senão o select perderia o valor.
  const term = learnerFilter.trim().toLowerCase();
  const matches = (user: UserProfile) =>
    [user.displayName, user.email, user.uid].join(" ").toLowerCase().includes(term);
  const learnerOptions = term ? users.filter((user) => user.uid === userId || matches(user)) : users;
  const noLearnerMatch = term !== "" && !users.some(matches);
  // Como o curso: a conta escolhida só vale se ainda está na lista carregada.
  // Se ela sai (apagada, ou fora das linhas que a leitura traz), o select fica
  // sem nada marcado e o botão não pode dar acesso a uma conta que não se vê.
  const selectedUser = users.find((user) => user.uid === userId) ?? null;
  // Por que o botão está cinza, dito embaixo dele (I-13). Nada enquanto as
  // listas carregam; falha de leitura já tem o próprio aviso acima.
  const blockedReason = isLoadingUsers || isLoadingCourses || readErrors.users || readErrors.courses ? null
    : courses.length === 0 ? "noCourses"
      : users.length === 0 ? "noUsers"
        : !selectedUser || !selectedCourse ? "choose" : null;

  async function handleCreateEnrollment() {
    if (!selectedUser || !selectedCourse) {
      setError("choose");
      return;
    }

    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      await createAdminEnrollmentForTeacherCourse(selectedUser.uid, selectedCourse);
      setSuccess("created");
    } catch {
      setError("create");
    } finally {
      setIsSaving(false);
    }
  }

  // Roda só pelo confirmar da janela, que antes era o OK do window.confirm.
  async function handleRevoke(enrollment: Enrollment) {
    setError("");
    setSuccess("");
    setRevokingId(enrollment.id);

    try {
      await revokeEnrollment(enrollment.id);
      setSuccess("revoked");
    } catch {
      setError("revoke");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section ref={panelRef} tabIndex={-1} className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)] outline-none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t(`${copy}.eyebrow`)}
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        <span className="rounded-md bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {t("platform.ops.paymentsPanel.adminOnly")}
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Field id="ops-enrollment-user" label={t(`${copy}.learner`)} error={readErrors.users ? t(`${copy}.readErrors.users`) : undefined}>
          {a11y => <>
            <input
              type="search"
              value={learnerFilter}
              onChange={(event) => setLearnerFilter(event.target.value)}
              aria-label={t(`${copy}.filterLabel`)}
              placeholder={t(`${copy}.filterPlaceholder`)}
              disabled={isLoadingUsers || users.length === 0 || readErrors.users}
              className="field-input min-h-11 min-w-0 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <select
              {...a11y}
              value={selectedUser ? userId : ""}
              onChange={(event) => setUserId(event.target.value)}
              disabled={isLoadingUsers || users.length === 0 || readErrors.users}
              className="field-input min-h-11 min-w-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {t(`${copy}.${isLoadingUsers ? "loadingUsers" : noLearnerMatch ? "noMatch" : "chooseUser"}`)}
              </option>
              {learnerOptions.map((user) => (
                <option key={user.uid} value={user.uid}>
                  {accountLabel(user)}
                </option>
              ))}
            </select>
          </>}
        </Field>

        <Field id="ops-enrollment-course" label={t(`${copy}.course`)} error={readErrors.courses ? t(`${copy}.readErrors.courses`) : undefined}>
          {a11y => <select
            {...a11y}
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            disabled={isLoadingCourses || courses.length === 0 || readErrors.courses}
            className="field-input min-h-11 min-w-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">
              {t(`${copy}.${isLoadingCourses ? "loadingCourses" : "chooseCourse"}`)}
            </option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>}
        </Field>
      </div>

      {readErrors.users || readErrors.courses ? (
        // A frase do erro fica em cada campo; o botão lê de novo os dois.
        <Button
          variant="outline"
          className="mt-3"
          loading={retryingFields}
          busyLabel={t("appErrors.retrying")}
          onClick={() => void retryFieldReads()}
        >
          {t("appErrors.retry")}
        </Button>
      ) : null}

      {error ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.errors.${error}`)}</InlineAlert> : null}
      {success ? <InlineAlert tone="success" className="mt-5">{t(`${copy}.success.${success}`)}</InlineAlert> : null}

      <button
        type="button"
        onClick={handleCreateEnrollment}
        disabled={isSaving || !selectedUser || !selectedCourse || readErrors.users || readErrors.courses}
        aria-describedby="ops-enrollment-create-hint"
        className="button-solid min-h-11 mt-6 px-4 py-2.5 text-sm"
      >
        <BusyLabel busy={isSaving} idle={t(`${copy}.create`)} busyText={t(`${copy}.creating`)} />
      </button>
      {/* Embaixo do botão: o que falta quando ele está cinza, ou para quem vai o
          acesso quando está pronto, para conferir antes de clicar. */}
      <p id="ops-enrollment-create-hint" className="mt-2 break-words text-xs text-[var(--color-ink-soft)]">
        {blockedReason === "choose" ? t(`${copy}.errors.choose`)
          : blockedReason ? t(`${copy}.${blockedReason}`)
            : selectedUser && selectedCourse ? t(`${copy}.grantsTo`).replace("{person}", () => accountLabel(selectedUser))
              : null}
      </p>

      <div ref={grantsRef} tabIndex={-1} className="mt-8 border-t border-[var(--color-line)] pt-6 outline-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t(`${copy}.grantedTitle`)}
          </h4>
          {!isLoadingGranted && !readErrors.grants ? <span className="rounded-md bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">{t(`${copy}.${grantedEnrollments.length === 1 ? "activeOne" : "active"}`).replace("{count}", () => String(grantedEnrollments.length))}</span> : null}
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t(`${copy}.grantedDescription`)}
        </p>

        {readErrors.grants ? (
          <LoadErrorAlert className="mt-4" focusRef={grantsRef} onRetry={() => subscriptions.current.grants?.reload()}>
            {t(`${copy}.readErrors.grants`)}
          </LoadErrorAlert>
        ) : null}

        <div className="mt-4 grid gap-3">
          {isLoadingGranted ? (
            <p role="status" className="text-sm text-[var(--color-ink-soft)]">
              {t(`${copy}.loadingGranted`)}
            </p>
          ) : grantedEnrollments.length === 0 ? (
            readErrors.grants ? null : <p className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
          ) : (
            grantedEnrollments.map((enrollment) => {
              return (
                <article
                  key={enrollment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-[var(--color-ink)]">
                      {enrollment.courseTitle}
                    </p>
                    <p className="mt-1 break-words text-xs leading-5 text-[var(--color-ink-soft)]">
                      {learnerLabel(enrollment.userId)}
                      {" - "}
                      {t(`${copy}.${enrollment.source === "admin" ? "adminGrant" : "demoGrant"}`)}
                    </p>
                  </div>
                  {/* Tirar o acesso é vermelho, como Unpublish e Reject (I-04); a
                      pergunta antes continua a mesma. */}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setAsking(enrollment)}
                    disabled={revokingId === enrollment.id}
                    className="min-h-11 px-3.5 py-2"
                  >
                    <BusyLabel
                      busy={revokingId === enrollment.id}
                      idle={t(`${copy}.revoke`)}
                      busyText={t(`${copy}.revoking`)}
                    />
                  </Button>
                </article>
              );
            })
          )}
        </div>
      </div>

      {/* A frase é a mesma do antigo window.confirm; o resultado continua no
          aviso do painel. */}
      {asking ? (
        <ConfirmDialog
          title={t(`${copy}.revokeTitle`)}
          confirmLabel={t(`${copy}.revoke`)}
          pendingLabel={t(`${copy}.revoking`)}
          cancelLabel={t("platform.ops.confirmDialog.cancel")}
          danger
          onConfirm={() => handleRevoke(asking)}
          onClose={() => setAsking(null)}
        >
          <p>{t(`${copy}.confirmRevoke`).replace("{title}", () => asking.courseTitle)}</p>
          {/* Dois estudantes no mesmo curso: sem o nome, não dá para conferir
              quem perde o acesso. */}
          <p className="mt-2 break-words font-semibold text-[var(--color-ink)]">
            {t(`${copy}.revokeLearner`).replace("{person}", () => learnerLabel(asking.userId))}
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
