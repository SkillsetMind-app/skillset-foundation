"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import {
  buttonClasses,
  Button,
  Card,
  Eyebrow,
  Field,
  InlineAlert,
} from "@/components/ui";
import type { CreatorVerificationCase } from "@/domain/creator-verification";
import {
  fetchRequireCreatorVerification,
  submitCreatorVerification,
  subscribeToMyVerificationCase,
} from "@/lib/data/creator-verification";
import { logSubscriptionError } from "@/lib/data/subscription-error";

const MAX_EVIDENCE_LINKS = 6;

const inputClass =
  "rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
        {label}
      </span>
      <span className="text-sm text-[var(--color-ink)]">{value}</span>
    </div>
  );
}

export function CreatorVerificationPanel() {
  const { user } = useAuth();
  const [verificationCase, setVerificationCase] =
    useState<CreatorVerificationCase | null>(null);
  const [caseLoaded, setCaseLoaded] = useState(false);
  const [requireVerification, setRequireVerification] = useState(false);
  const [profession, setProfession] = useState("");
  const [registrationType, setRegistrationType] = useState("");
  const [registrationId, setRegistrationId] = useState("");
  const [registrationRegion, setRegistrationRegion] = useState("");
  const [evidenceLinksText, setEvidenceLinksText] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const seededCaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToMyVerificationCase(
      user.uid,
      (nextCase) => {
        setVerificationCase(nextCase);
        setCaseLoaded(true);
        // Prefill the resubmission form from the reviewed case, once per
        // case+status, so an in-progress edit is never clobbered by realtime.
        if (
          nextCase
          && (nextCase.status === "needs_changes" || nextCase.status === "rejected")
        ) {
          const seedKey = `${nextCase.id}:${nextCase.status}`;
          if (seededCaseRef.current !== seedKey) {
            seededCaseRef.current = seedKey;
            setProfession(nextCase.profession);
            setRegistrationType(nextCase.registrationType);
            setRegistrationId(nextCase.registrationId);
            setRegistrationRegion(nextCase.registrationRegion);
            setEvidenceLinksText(nextCase.evidenceLinks.join("\n"));
            setNote(nextCase.note ?? "");
          }
        }
      },
      (error) => {
        logSubscriptionError("CreatorVerificationPanel.case")(error);
        setCaseLoaded(true);
      },
    );
  }, [user]);

  useEffect(() => {
    let active = true;
    fetchRequireCreatorVerification()
      .then((value) => {
        if (active) {
          setRequireVerification(value);
        }
      })
      .catch(logSubscriptionError("CreatorVerificationPanel.flag"));
    return () => {
      active = false;
    };
  }, []);

  const status = verificationCase?.status;
  const showForm =
    caseLoaded
    && (!verificationCase
      || status === "needs_changes"
      || status === "rejected");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const links = evidenceLinksText
      .split(/\r?\n/)
      .map((link) => link.trim())
      .filter(Boolean);

    if (links.length > MAX_EVIDENCE_LINKS) {
      setSubmitError(`Attach at most ${MAX_EVIDENCE_LINKS} evidence links.`);
      return;
    }
    if (links.some((link) => !/^https:\/\//i.test(link))) {
      setSubmitError("Evidence links must start with https://");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitCreatorVerification({
        profession,
        registrationType,
        registrationId,
        registrationRegion,
        evidenceLinks: links,
        note: note.trim() || undefined,
      });
      // The realtime subscription flips the panel to "in review".
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Could not submit verification. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <Card as="section" padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>Teacher studio</Eyebrow>
            <h1 className="display-title mt-1 text-2xl text-[var(--color-primary)]">
              Professional verification
            </h1>
          </div>
          {caseLoaded && verificationCase ? (
            <StatusChip status={verificationCase.status} />
          ) : null}
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          Verify your professional credentials to earn reviewed-instructor
          standing.{" "}
          {requireVerification
            ? "Verification is required before you can publish a course."
            : "Verification is optional today — it becomes required to publish once professional admission opens."}
        </p>
        <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
          Share your registration details and public links that prove them
          (registry lookup page, license directory, professional profile).
          Document upload ships later — for now the review works from links.
        </p>
      </Card>

      {!caseLoaded ? (
        <Card as="section" padding="lg">
          <p className="text-sm text-[var(--color-ink-soft)]">
            Loading your verification status...
          </p>
        </Card>
      ) : null}

      {caseLoaded && status === "approved" ? (
        <Card as="section" padding="lg">
          <h2 className="text-base font-semibold text-[var(--color-ink)]">
            You are verified
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            Your professional verification is approved. It applies to every
            course you publish — nothing else to do here.
          </p>
          <Link href="/teach" className={buttonClasses({ size: "sm" }, "mt-4")}>
            Back to studio
          </Link>
        </Card>
      ) : null}

      {caseLoaded && status === "pending" && verificationCase ? (
        <Card as="section" padding="lg">
          <h2 className="text-base font-semibold text-[var(--color-ink)]">
            In review
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            Your application is with the review team. You can keep building
            courses while you wait.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <DetailRow label="Profession" value={verificationCase.profession} />
            <DetailRow
              label="Registry / license"
              value={verificationCase.registrationType}
            />
            <DetailRow
              label="Registration number"
              value={verificationCase.registrationId}
            />
            <DetailRow
              label="Issuing region"
              value={verificationCase.registrationRegion}
            />
          </div>
          {verificationCase.evidenceLinks.length > 0 ? (
            <div className="mt-3">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                Evidence links
              </span>
              <ul className="mt-1 grid gap-1">
                {verificationCase.evidenceLinks.map((link) => (
                  <li
                    key={link}
                    className="truncate text-sm text-[var(--color-ink)]"
                  >
                    {link}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {caseLoaded
      && (status === "needs_changes" || status === "rejected")
      && verificationCase?.reviewNote ? (
        <Card as="section" tone="soft" padding="lg" shadow={false}>
          <h2 className="text-base font-semibold text-[var(--color-ink)]">
            {status === "needs_changes"
              ? "The review team asked for changes"
              : "Your application was rejected"}
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink)]">
            {verificationCase.reviewNote}
          </p>
          <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
            {status === "needs_changes"
              ? "Update the form below and resubmit."
              : "You can submit a new application below."}
          </p>
        </Card>
      ) : null}

      {showForm ? (
        <Card as="section" padding="lg">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <h2 className="text-base font-semibold text-[var(--color-ink)]">
              {status === "needs_changes"
                ? "Resubmit your application"
                : "Apply for verification"}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="verification-profession" label="Profession" required>
                {(a11y) => (
                  <input
                    {...a11y}
                    value={profession}
                    onChange={(event) => setProfession(event.target.value)}
                    placeholder="e.g. Performance coach"
                    minLength={2}
                    maxLength={120}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field
                id="verification-registry-type"
                label="Registry / license type"
                required
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    value={registrationType}
                    onChange={(event) => setRegistrationType(event.target.value)}
                    placeholder="e.g. State medical board"
                    minLength={2}
                    maxLength={60}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field
                id="verification-registration-id"
                label="Registration number"
                required
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    value={registrationId}
                    onChange={(event) => setRegistrationId(event.target.value)}
                    placeholder="e.g. 123456-7"
                    minLength={2}
                    maxLength={80}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field
                id="verification-region"
                label="Issuing country or state"
                required
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    value={registrationRegion}
                    onChange={(event) => setRegistrationRegion(event.target.value)}
                    placeholder="e.g. Florida, USA"
                    minLength={2}
                    maxLength={80}
                    className={inputClass}
                  />
                )}
              </Field>
            </div>
            <Field
              id="verification-evidence"
              label="Evidence links"
              hint={`One https:// link per line, up to ${MAX_EVIDENCE_LINKS} — registry lookup page, license directory, professional profile.`}
            >
              {(a11y) => (
                <textarea
                  {...a11y}
                  value={evidenceLinksText}
                  onChange={(event) => setEvidenceLinksText(event.target.value)}
                  rows={4}
                  placeholder={"https://registry.example.gov/lookup?id=123456\nhttps://www.linkedin.com/in/you"}
                  className={`resize-none ${inputClass}`}
                />
              )}
            </Field>
            <Field
              id="verification-note"
              label="Note to the review team (optional)"
            >
              {(a11y) => (
                <textarea
                  {...a11y}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Anything that helps us verify you faster."
                  className={`resize-none ${inputClass}`}
                />
              )}
            </Field>
            {/* O erro do envio era um <p> vermelho solto: quem usa leitor de
                tela mandava o formulário e não ouvia nada. */}
            {submitError ? (
              <InlineAlert tone="error">{submitError}</InlineAlert>
            ) : null}
            <div>
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? "Submitting..."
                  : status === "needs_changes"
                    ? "Resubmit for review"
                    : "Submit for review"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
