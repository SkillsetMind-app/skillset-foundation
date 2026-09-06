"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PanelCard } from "@/components/teacher/course-commerce-panels";
import { Button } from "@/components/ui";
import { changeCourseAccess, listCourseAccess, type CourseAccessAction, type CourseAccessGrant } from "@/lib/data/course-access";

const statusLabels = {
  pending: "Waiting for email confirmation",
  granted: "Access granted",
  preserved: "Existing access preserved",
  revoked: "Creator access revoked",
  conflict: "Existing access needs support review",
};

export function CourseAccessPanel({ courseId, onChange }: { courseId: string; onChange?: () => void }) {
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
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void listCourseAccess(courseId).then((rows) => { if (current) setGrants(rows); }).catch(() => {
      if (current) setError("Could not load access records. Reload to try again.");
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
      setMessage(result.accessStatus === "conflict"
        ? "Existing access needs support review. No access was changed and no email was sent."
        : result.accessStatus === "revoked"
          ? "Creator access revoked. Progress, certificates and purchased access are preserved."
          : result.emailStatus === "failed"
            ? "Access recorded, but the email could not be sent. Use Resend link to try again (up to 3 attempts per hour)."
            : `${statusLabels[result.accessStatus]}. Sign-in link sent.`);
      if (result.accessStatus === "revoked") statusRef.current?.focus();
      onChange?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not update course access.");
    } finally { setBusy(false); }
  }

  return <PanelCard title="Grant course access" description="Give someone this published course without a Stripe charge.">
    <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
      They receive a secure sign-in link to confirm their email and access the course. No password or paid plan is required.
    </p>
    <form className="mt-4 flex min-w-0 flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void act({ courseId, email }); }}>
      <div className="min-w-0 flex-1 basis-60">
        <label htmlFor={inputId} className="mb-2 block text-sm font-semibold text-[var(--color-ink)]">Learner email</label>
        <input id={inputId} type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy}
          className="min-h-11 w-full min-w-0 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]" />
      </div>
      <Button type="submit" disabled={busy || !loaded || !email.trim()}>Grant access and send link</Button>
    </form>
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--color-danger-fg)]">{error}</p> : null}
    <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="mt-3 text-sm text-[var(--color-ink-soft)]">{message}</p>
    <ul className="mt-4 grid min-w-0 gap-3">
      {grants.map((grant) => <li key={grant.id} className="min-w-0 rounded-[8px] border border-[var(--color-line)] p-3">
        <p className="break-all text-sm font-semibold text-[var(--color-ink)]">{grant.learner_email}</p>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{statusLabels[grant.access_status]}</p>
        {!grant.revoked_at ? <div className="mt-3 flex flex-wrap gap-2" onKeyDown={(event) => {
          if (event.key === "Escape" && confirmId === grant.id && !busy) { event.preventDefault(); closeConfirmation(); }
        }}>
          {grant.access_status !== "conflict" ? <Button variant="outline" disabled={busy} aria-label={`Resend link to ${grant.learner_email}`} onClick={() => void act({ action: "resend", grantId: grant.id })}>Resend link</Button> : null}
          <Button variant="outline" disabled={busy} aria-label={`Revoke access for ${grant.learner_email}`}
            aria-expanded={confirmId === grant.id} aria-controls={confirmId === grant.id ? `${inputId}-${grant.id}-confirm` : undefined}
            onClick={(event) => { revokeTrigger.current = event.currentTarget; setConfirmId(grant.id); }}>Revoke access</Button>
          {confirmId === grant.id ? <div id={`${inputId}-${grant.id}-confirm`} className="flex basis-full flex-wrap gap-2">
            <p className="basis-full text-sm text-[var(--color-ink-soft)]">Revoke this creator grant? Purchased access and learning history will stay intact.</p>
            <Button disabled={busy} onClick={() => void act({ action: "revoke", grantId: grant.id })}>Confirm revocation</Button>
            <Button variant="outline" disabled={busy} onClick={closeConfirmation}>Cancel</Button>
          </div> : null}
        </div> : null}
      </li>)}
    </ul>
    {grants.length >= 200 ? <p className="mt-3 text-sm text-[var(--color-ink-soft)]">Showing the latest 200 records.</p> : null}
  </PanelCard>;
}
