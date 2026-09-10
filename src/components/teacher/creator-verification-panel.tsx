"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import {
  buttonClasses,
  Button,
  Card,
  Eyebrow,
  Field,
  InlineAlert,
} from "@/components/ui";
import { validateProfessionalEvidence } from "@/domain/creator-verification";
import type { CreatorVerificationCase, ProfessionalVerificationKind, SubmitCreatorVerificationInput } from "@/domain/creator-verification";
import {
  fetchRequireCreatorVerification,
  removeVerificationEvidence,
  submitCreatorVerification,
  subscribeToMyVerificationCase,
  uploadVerificationEvidence,
} from "@/lib/data/creator-verification";
import { logSubscriptionError } from "@/lib/data/subscription-error";

const MAX_EVIDENCE_LINKS = 6;
const copy = "professionalBadge";
// Canonical persisted values, independent of the interface language.
const professionLabels = {
  psychologist: "Psychologist",
  coach: "Coach",
  holistic: "Holistic practitioner",
  other: "Other",
};

const validationErrorKeys = new Map([
  ["Choose your profession.", "chooseProfession"],
  ["Describe your profession (2-120 characters).", "professionLength"],
  ["Add your license number and issuing country or state.", "registrationRequired"],
  ["Shorten the registration details or note.", "detailsTooLong"],
  ["Add a professional link or a certificate to request a badge.", "evidenceRequired"],
  ["Attach at most 6 evidence links.", "tooManyLinks"],
  ["Use a valid https:// professional link.", "invalidLink"],
  ["Use a valid https:// professional link (max 300 characters).", "invalidSecureLink"],
]);

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
  const { t } = useTranslation();
  const [verificationCase, setVerificationCase] =
    useState<CreatorVerificationCase | null>(null);
  const [caseLoaded, setCaseLoaded] = useState(false);
  const [requireVerification, setRequireVerification] = useState(false);
  const [formRequested, setFormRequested] = useState(false);
  const [profession, setProfession] = useState("");
  const [verificationKind, setVerificationKind] = useState<ProfessionalVerificationKind | "">("");
  const [registrationId, setRegistrationId] = useState("");
  const [registrationRegion, setRegistrationRegion] = useState("");
  const [evidenceLinksText, setEvidenceLinksText] = useState("");
  const [note, setNote] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [documentPath, setDocumentPath] = useState<string | undefined>();
  const documentInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cleaningDocument, setCleaningDocument] = useState(false);
  const operationRef = useRef(false);
  const uploadedPathRef = useRef<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const seededCaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToMyVerificationCase(
      user.uid,
      (nextCase) => {
        if (nextCase?.documentPath === uploadedPathRef.current) {
          uploadedPathRef.current = null;
        }
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
            setVerificationKind(nextCase.verificationKind === "legacy" ? "" : nextCase.verificationKind ?? "");
            setRegistrationId(nextCase.registrationId ?? "");
            setRegistrationRegion(nextCase.registrationRegion ?? "");
            setDocumentPath(nextCase.documentPath);
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
  const canRequest =
    caseLoaded
    && (!verificationCase
      || status === "needs_changes"
      || status === "rejected");
  const showForm = canRequest && formRequested;

  const selectFile = async (file: File | null) => {
    if (operationRef.current) return;
    if (documentInputRef.current) documentInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (file && (
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)
      || file.size === 0
      || file.size > 10 * 1024 * 1024
    )) {
      setSubmitError("invalidFile");
      return;
    }
    if (documentPath && uploadedPathRef.current === documentPath) {
      operationRef.current = true;
      setCleaningDocument(true);
      setSubmitError(null);
      try {
        await removeVerificationEvidence(documentPath);
        uploadedPathRef.current = null;
      } catch {
        setSubmitError("removeFailed");
        return;
      } finally {
        operationRef.current = false;
        setCleaningDocument(false);
      }
    }
    setEvidenceFile(file);
    setDocumentPath(undefined);
    setSubmitError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (operationRef.current) return;
    if (!verificationKind) {
      setSubmitError("chooseProfession");
      return;
    }
    const links = evidenceLinksText
      .split(/\r?\n/)
      .map((link) => link.trim())
      .filter(Boolean);

    const input: SubmitCreatorVerificationInput = {
      verificationKind,
      profession: verificationKind === "other" ? profession.trim() : professionLabels[verificationKind],
      registrationId: verificationKind === "psychologist" ? registrationId.trim() : undefined,
      registrationRegion: verificationKind === "psychologist" ? registrationRegion.trim() : undefined,
      evidenceLinks: links,
      documentPath,
      note: note.trim() || undefined,
    };
    try {
      validateProfessionalEvidence(input, Boolean(evidenceFile || documentPath));
    } catch (error) {
      // Keep keys in state so existing feedback follows a language change.
      setSubmitError(error instanceof Error ? validationErrorKeys.get(error.message) ?? "invalidEvidence" : "invalidEvidence");
      return;
    }

    operationRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let uploadedPath = documentPath;
      if (evidenceFile && !uploadedPath) {
        uploadedPath = await uploadVerificationEvidence(evidenceFile);
        uploadedPathRef.current = uploadedPath;
        setDocumentPath(uploadedPath);
      }
      await submitCreatorVerification({
        ...input,
        documentPath: uploadedPath,
      });
      uploadedPathRef.current = null;
      // The realtime subscription flips the panel to "in review".
    } catch {
      setSubmitError("submitFailed");
    } finally {
      operationRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <Card as="section" padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>{t(`${copy}.eyebrow`)}</Eyebrow>
            <h1 className="display-title mt-1 text-2xl text-[var(--color-primary)]">
              {t(`${copy}.title`)}
            </h1>
          </div>
          {caseLoaded && verificationCase ? (
            <StatusChip status={verificationCase.status} label={t(`${copy}.status.${verificationCase.status}`)} />
          ) : null}
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t(`${copy}.description`)}{" "}
          {t(`${copy}.${requireVerification ? "required" : "optional"}`)}
        </p>
        <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
          {t(`${copy}.privacy`)}
        </p>
        {caseLoaded && status !== "approved" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {canRequest ? (
              <Button
                aria-expanded={showForm}
                aria-controls="professional-badge-form"
                onClick={() => setFormRequested(true)}
              >
                {t(`${copy}.${status === "needs_changes" || status === "rejected" ? "edit" : "request"}`)}
              </Button>
            ) : null}
            <Link href="/teach" className={buttonClasses({ variant: "outline" })}>
              {t(`${copy}.notNow`)}
            </Link>
          </div>
        ) : null}
      </Card>

      {!caseLoaded ? (
        <Card as="section" padding="lg">
          <p className="text-sm text-[var(--color-ink-soft)]">
            {t(`${copy}.loading`)}
          </p>
        </Card>
      ) : null}

      {caseLoaded && status === "approved" ? (
        <Card as="section" padding="lg">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-ink)]">
            <BadgeCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
            {verificationCase?.verificationKind === "psychologist"
              ? t(`${copy}.credentialVerified`)
              : verificationCase?.verificationKind && verificationCase.verificationKind !== "legacy"
                ? t(`${copy}.evidenceReviewed`)
                : t(`${copy}.verificationApproved`)}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.approvedDescription`)}
          </p>
          <Link href="/teach" className={buttonClasses({ size: "sm" }, "mt-4")}>
            {t(`${copy}.backToStudio`)}
          </Link>
        </Card>
      ) : null}

      {caseLoaded && status === "pending" && verificationCase ? (
        <Card as="section" padding="lg">
          <h2 className="text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.inReview`)}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.${requireVerification ? "pendingRequired" : "pendingOptional"}`)}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <DetailRow label={t(`${copy}.profession`)} value={
              verificationCase.verificationKind && verificationCase.verificationKind !== "legacy"
                && verificationCase.verificationKind !== "other"
                && verificationCase.profession === professionLabels[verificationCase.verificationKind]
                ? t(`${copy}.professions.${verificationCase.verificationKind}`)
                : verificationCase.profession
            } />
            {verificationCase.registrationType ? <DetailRow
              label={t(`${copy}.registry`)}
              value={verificationCase.registrationType}
            /> : null}
            {verificationCase.registrationId ? <DetailRow
              label={t(`${copy}.registrationNumber`)}
              value={verificationCase.registrationId}
            /> : null}
            {verificationCase.registrationRegion ? <DetailRow
              label={t(`${copy}.issuingRegion`)}
              value={verificationCase.registrationRegion}
            /> : null}
          </div>
          {verificationCase.documentPath ? (
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{t(`${copy}.documentSubmitted`)}</p>
          ) : null}
          {verificationCase.evidenceLinks.length > 0 ? (
            <div className="mt-3">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                {t(`${copy}.evidenceLinks`)}
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
            {t(`${copy}.${status === "needs_changes" ? "changesRequested" : "applicationRejected"}`)}
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-ink)]">
            {verificationCase.reviewNote}
          </p>
          <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
            {t(`${copy}.${status === "needs_changes" ? "changesDescription" : "rejectedDescription"}`)}
          </p>
        </Card>
      ) : null}

      {showForm ? (
        <Card as="section" padding="lg">
          <form id="professional-badge-form" onSubmit={handleSubmit} className="grid gap-4">
            <h2 className="text-base font-semibold text-[var(--color-ink)]">
              {t(`${copy}.${status === "needs_changes" ? "resubmitTitle" : "applyTitle"}`)}
            </h2>
            <fieldset disabled={submitting || cleaningDocument} className="grid min-w-0 gap-4">
              <legend className="sr-only">{t(`${copy}.evidenceLegend`)}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="verification-kind" label={t(`${copy}.profession`)} required>
                {(a11y) => (
                  <select
                    {...a11y}
                    value={verificationKind}
                    onChange={(event) => setVerificationKind(event.target.value as ProfessionalVerificationKind | "")}
                    className={inputClass}
                  >
                    <option value="" disabled>{t(`${copy}.chooseProfession`)}</option>
                    {Object.keys(professionLabels).map((value) => (
                      <option key={value} value={value}>{t(`${copy}.professions.${value}`)}</option>
                    ))}
                  </select>
                )}
              </Field>
              {verificationKind === "other" ? <Field id="verification-profession" label={t(`${copy}.yourProfession`)} required>
                {(a11y) => (
                  <input
                    {...a11y}
                    value={profession}
                    onChange={(event) => setProfession(event.target.value)}
                    minLength={2}
                    maxLength={120}
                    className={inputClass}
                  />
                )}
              </Field> : null}
              {verificationKind === "psychologist" ? <>
              <Field
                id="verification-registration-id"
                label={t(`${copy}.registrationNumber`)}
                required
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    value={registrationId}
                    onChange={(event) => setRegistrationId(event.target.value)}
                    minLength={2}
                    maxLength={80}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field
                id="verification-region"
                label={t(`${copy}.issuingCountry`)}
                required
              >
                {(a11y) => (
                  <input
                    {...a11y}
                    value={registrationRegion}
                    onChange={(event) => setRegistrationRegion(event.target.value)}
                    minLength={2}
                    maxLength={80}
                    className={inputClass}
                  />
                )}
              </Field>
              </> : null}
            </div>
            <Field
              id="verification-evidence"
              label={t(`${copy}.evidenceLinks`)}
              hint={t(`${copy}.evidenceHint`).replace("{max}", () => String(MAX_EVIDENCE_LINKS))}
            >
              {(a11y) => (
                <textarea
                  {...a11y}
                  value={evidenceLinksText}
                  onChange={(event) => setEvidenceLinksText(event.target.value)}
                  rows={4}
                  className={`resize-none ${inputClass}`}
                />
              )}
            </Field>
            <Field id="verification-document" label={t(`${copy}.document`)} hint={t(`${copy}.documentHint`)}>
              {(a11y) => (
                <input {...a11y} ref={documentInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => { if (event.target.files?.[0]) selectFile(event.target.files[0]); }}
                  className={`${inputClass} min-w-0 w-full`} />
              )}
            </Field>
            <Field id="verification-photo" label={t(`${copy}.takePhoto`)}>
              {(a11y) => (
                <input {...a11y} ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                  onChange={(event) => { if (event.target.files?.[0]) selectFile(event.target.files[0]); }}
                  className={`${inputClass} min-w-0 w-full`} />
              )}
            </Field>
            {evidenceFile || documentPath ? (
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <span className="min-w-0 break-all text-sm">{evidenceFile?.name ?? t(`${copy}.documentAttached`)}</span>
                <Button variant="ghost" onClick={() => selectFile(null)}>{t(`${copy}.removeDocument`)}</Button>
              </div>
            ) : null}
            <Field
              id="verification-note"
              label={t(`${copy}.note`)}
            >
              {(a11y) => (
                <textarea
                  {...a11y}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder={t(`${copy}.notePlaceholder`)}
                  className={`resize-none ${inputClass}`}
                />
              )}
            </Field>
            </fieldset>
            {/* O erro do envio era um <p> vermelho solto: quem usa leitor de
                tela mandava o formulário e não ouvia nada. */}
            {submitError ? (
              <InlineAlert tone="error">{t(`${copy}.errors.${submitError}`)}</InlineAlert>
            ) : null}
            <div>
              <Button type="submit" disabled={submitting || cleaningDocument}>
                {t(`${copy}.${cleaningDocument
                  ? "removingDocument"
                  : submitting
                  ? "submitting"
                  : status === "needs_changes"
                    ? "resubmit"
                    : "submit"}`)}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
