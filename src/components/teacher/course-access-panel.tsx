"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PanelCard } from "@/components/teacher/course-commerce-panels";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { isActivationRequiredError } from "@/domain/creator-verification";
import { Button } from "@/components/ui";
import { changeCourseAccess, listCourseAccess, type CourseAccessAction, type CourseAccessGrant } from "@/lib/data/course-access";

const statusLabels = {
  pending: "courseAccess.pending",
  granted: "courseAccess.granted",
  preserved: "courseAccess.preserved",
  revoked: "courseAccess.revoked",
  conflict: "courseAccess.conflict",
};

const accessErrorKeys: Record<string, string> = {
  "Only the course owner can manage access to a published course.": "courseAccess.ownerError",
  "Enter a valid email address.": "courseAccess.emailError",
  "Too many attempts. Please wait before trying again.": "courseAccess.rateError",
  "Sign in to manage course access.": "courseAccess.signInError",
  "Choose a course.": "courseAccess.courseError",
  "Request is too large.": "courseAccess.requestLargeError",
  "Invalid request.": "courseAccess.requestError",
  "Invalid action.": "courseAccess.actionError",
  "Invalid request fields.": "courseAccess.fieldsError",
  "Choose a course and enter a valid email address.": "courseAccess.courseEmailError",
  "Choose an access record.": "courseAccess.recordError",
  "Access record is not available.": "courseAccess.recordUnavailable",
};

export function CourseAccessPanel({ courseId, onChange }: { courseId: string; onChange?: () => void }) {
  const { t } = useTranslation();
  const inputId = useId();
  const revokeTrigger = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  function closeConfirmation() {
    setConfirmId(null);
    revokeTrigger.current?.focus();
  }
  const [email, setEmail] = useState("");
  const [grants, setGrants] = useState<CourseAccessGrant[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [messageStatus, setMessageStatus] = useState<CourseAccessGrant["access_status"]>("pending");
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void listCourseAccess(courseId).then((rows) => { if (current) setGrants(rows); }).catch(() => {
      if (current) setError("courseAccess.loadError");
    }).finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [courseId]);

  async function act(action: CourseAccessAction) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await changeCourseAccess(action);
      setGrants((rows) => [result.grant, ...rows.filter((row) => row.id !== result.grant.id)]);
      setConfirmId(null);
      if ("courseId" in action) setEmail("");
      setMessageStatus(result.accessStatus);
      setMessage(result.accessStatus === "conflict"
        ? "courseAccess.conflictNotice"
        : result.accessStatus === "revoked"
          ? "courseAccess.revokedNotice"
          : result.emailStatus === "failed"
            ? "courseAccess.emailFailed"
            : "courseAccess.sent");
      if (result.accessStatus === "revoked") statusRef.current?.focus();
      onChange?.();
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : "";
      setError(isActivationRequiredError(detail)
        ? "courseCreation.activationError"
        : Object.hasOwn(accessErrorKeys, detail) ? accessErrorKeys[detail] : "courseAccess.updateError");
    } finally { setBusy(false); }
  }

  return <PanelCard title={t("courseAccess.title")} description={t("courseAccess.description")}>
    <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
      {t("courseAccess.help")}
    </p>
    <form className="mt-4 flex min-w-0 flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void act({ courseId, email }); }}>
      <div className="min-w-0 flex-1 basis-60">
        <label htmlFor={inputId} className="mb-2 block text-sm font-semibold text-[var(--color-ink)]">{t("courseAccess.email")}</label>
        <input id={inputId} type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy}
          className="min-h-11 w-full min-w-0 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]" />
      </div>
      <Button type="submit" disabled={busy || !loaded || !email.trim()}>{t("courseAccess.grant")}</Button>
    </form>
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--color-danger-fg)]">{t(error)}</p> : null}
    <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="mt-3 text-sm text-[var(--color-ink-soft)]">{message ? t(message).replace("{status}", () => t(statusLabels[messageStatus])) : ""}</p>
    <ul className="mt-4 grid min-w-0 gap-3">
      {grants.map((grant) => <li key={grant.id} className="min-w-0 rounded-[8px] border border-[var(--color-line)] p-3">
        <p className="break-all text-sm font-semibold text-[var(--color-ink)]">{grant.learner_email}</p>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t(statusLabels[grant.access_status])}</p>
        {!grant.revoked_at ? <div className="mt-3 flex flex-wrap gap-2" onKeyDown={(event) => {
          if (event.key === "Escape" && confirmId === grant.id && !busy) { event.preventDefault(); closeConfirmation(); }
        }}>
          {grant.access_status !== "conflict" ? <Button variant="outline" disabled={busy} aria-label={t("courseAccess.resendLabel").replace("{email}", () => grant.learner_email)} onClick={() => void act({ action: "resend", grantId: grant.id })}>{t("courseAccess.resend")}</Button> : null}
          <Button variant="outline" disabled={busy} aria-label={t("courseAccess.revokeLabel").replace("{email}", () => grant.learner_email)}
            aria-expanded={confirmId === grant.id} aria-controls={confirmId === grant.id ? `${inputId}-${grant.id}-confirm` : undefined}
            onClick={(event) => { revokeTrigger.current = event.currentTarget; setConfirmId(grant.id); }}>{t("courseAccess.revoke")}</Button>
          {confirmId === grant.id ? <div id={`${inputId}-${grant.id}-confirm`} className="flex basis-full flex-wrap gap-2">
            <p className="basis-full text-sm text-[var(--color-ink-soft)]">{t("courseAccess.confirmation")}</p>
            <Button disabled={busy} onClick={() => void act({ action: "revoke", grantId: grant.id })}>{t("courseAccess.confirm")}</Button>
            <Button variant="outline" disabled={busy} onClick={closeConfirmation}>{t("courseAccess.cancel")}</Button>
          </div> : null}
        </div> : null}
      </li>)}
    </ul>
    {grants.length >= 200 ? <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{t("courseAccess.limit")}</p> : null}
  </PanelCard>;
}
