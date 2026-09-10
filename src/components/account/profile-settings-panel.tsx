"use client";

import { UploadCloud } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { isValidE164Phone, PhoneInput } from "@/components/shared/phone-input";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { UserGoal } from "@/domain/user-profile";
import {
  maxCredentialEntries,
  maxCredentialLength,
} from "@/domain/user-profile";
import {
  formatValidationMessage,
  normalizeCredentials,
  normalizeGoals,
  normalizeUsername,
  validateBio,
  validateCredentials,
  validateDisplayName,
  validateUsername,
} from "@/lib/auth/profile-validation";
import { getUserProfile, updateUserIdentity } from "@/lib/data/user-profiles";
import {
  allowedAvatarTypes,
  isAllowedAvatarFile,
  uploadTeacherSignature,
  uploadUserAvatar,
  type UploadAvatarProgress,
} from "@/lib/data/profile-media";
import { UploadProgressNote } from "@/components/teacher/upload-progress-note";

const goalOptions = [
  ["career_growth", "accountProfile.goals.career_growth"],
  ["skill_certification", "accountProfile.goals.skill_certification"],
  ["teach_online", "accountProfile.goals.teach_online"],
  ["build_community", "accountProfile.goals.build_community"],
  ["live_mentorship", "accountProfile.goals.live_mentorship"],
  ["business_training", "accountProfile.goals.business_training"],
] as const satisfies Array<[UserGoal, string]>;

const timezoneOptions = [
  "America/New_York",
  "America/Sao_Paulo",
  "America/Los_Angeles",
  "Europe/London",
  "Africa/Lagos",
  "Africa/Johannesburg",
];

export function ProfileSettingsPanel() {
  const { refreshUser, user } = useAuth();
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [credentials, setCredentials] = useState<string[]>([]);
  const [isTeacher, setIsTeacher] = useState(false);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [avatarProgress, setAvatarProgress] = useState<UploadAvatarProgress | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [signatureProgress, setSignatureProgress] = useState<UploadAvatarProgress | null>(null);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    let mounted = true;

    getUserProfile(user.uid)
      .then((profile) => {
        if (!mounted) {
          return;
        }

        setDisplayName(profile?.displayName ?? user.displayName ?? "");
        setUsername(profile?.username ?? "");
        setBio(profile?.bio ?? "");
        setPhoneNumber(profile?.phoneNumber ?? "");
        setPhotoURL(profile?.photoURL ?? user.photoURL ?? null);
        setTimezone(
          profile?.timezone ??
            Intl.DateTimeFormat().resolvedOptions().timeZone ??
            "America/New_York",
        );
        setGoals(profile?.goals ?? []);
        setCredentials(profile?.credentials ?? []);
        setSignatureUrl(profile?.teacherSignatureUrl ?? null);
        setIsTeacher(
          (profile?.roles ?? []).includes("teacher") ||
            (profile?.roles ?? []).includes("admin"),
        );
      })
      .catch(() => {
        if (mounted) {
          setError("accountProfile.errors.load");
        }
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [user]);

  const safeTimezoneOptions = useMemo(() => {
    if (timezoneOptions.includes(timezone)) {
      return timezoneOptions;
    }

    return [timezone, ...timezoneOptions];
  }, [timezone]);

  function toggleGoal(goal: UserGoal) {
    setGoals((currentGoals) =>
      currentGoals.includes(goal)
        ? currentGoals.filter((currentGoal) => currentGoal !== goal)
        : normalizeGoals([...currentGoals, goal]),
    );
  }

  function updateCredential(index: number, value: string) {
    setCredentials((current) =>
      current.map((entry, position) => (position === index ? value : entry)),
    );
  }

  function addCredential() {
    setCredentials((current) =>
      current.length >= maxCredentialEntries ? current : [...current, ""],
    );
  }

  function removeCredential(index: number) {
    setCredentials((current) =>
      current.filter((_, position) => position !== index),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) {
      setError("accountProfile.errors.signIn");
      return;
    }

    const validationError =
      validateDisplayName(displayName) ||
      validateUsername(username) ||
      validateBio(bio) ||
      validateCredentials(credentials) ||
      (!isValidE164Phone(phoneNumber) ? "accountProfile.errors.phone" : "") ||
      (!timezone ? "accountProfile.errors.timezone" : "");

    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      await updateUserIdentity(user.uid, {
        displayName,
        username: normalizeUsername(username),
        bio,
        phoneNumber,
        timezone,
        goals,
        ...(isTeacher ? { credentials: normalizeCredentials(credentials) } : {}),
      });
      setSuccess("accountProfile.success.profile");
    } catch {
      setError("accountProfile.errors.save");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAvatarChange(file: File | null) {
    if (!user || !file) {
      return;
    }

    if (!isAllowedAvatarFile(file)) {
      setError("accountProfile.errors.avatarFile");
      return;
    }

    setError("");
    setSuccess("");
    setAvatarProgress(null);
    setIsUploadingAvatar(true);

    try {
      const uploadedPhotoURL = await uploadUserAvatar(
        user.uid,
        file,
        setAvatarProgress,
      );
      setPhotoURL(uploadedPhotoURL);
      await refreshUser();
      setSuccess("accountProfile.success.photo");
    } catch {
      setError("accountProfile.errors.avatarUpload");
    } finally {
      setIsUploadingAvatar(false);
      setAvatarProgress(null);
    }
  }

  async function handleSignatureChange(file: File | null) {
    if (!user || !file) {
      return;
    }

    if (!isAllowedAvatarFile(file)) {
      setError("accountProfile.errors.signatureFile");
      return;
    }

    setError("");
    setSuccess("");
    setSignatureProgress(null);
    setIsUploadingSignature(true);

    try {
      const uploadedSignatureUrl = await uploadTeacherSignature(
        user.uid,
        file,
        setSignatureProgress,
      );
      setSignatureUrl(uploadedSignatureUrl);
      setSuccess("accountProfile.success.signature");
    } catch {
      setError("accountProfile.errors.signatureUpload");
    } finally {
      setIsUploadingSignature(false);
      setSignatureProgress(null);
    }
  }

  if (isLoading) {
    return (
      <section className="settings-section-card">
        <p className="text-sm text-[var(--color-ink-soft)]">{t("accountProfile.loading")}</p>
      </section>
    );
  }

  return (
    <section className="settings-section-card">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("accountProfile.identity")}
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
        {t("accountProfile.title")}
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {t("accountProfile.description")}
      </p>

      <form className="mt-6 grid grid-cols-1 gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 sm:flex-row sm:items-center">
          <UserAvatar
            name={displayName || user?.email}
            photoURL={photoURL}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              {t("accountProfile.photo.title")}
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("accountProfile.photo.hint")}
            </p>
            <label
              className={`relative mt-3 inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-primary)] ${
                isUploadingAvatar ? "pointer-events-none opacity-60" : ""
              }`}
            >
              <UploadCloud size={16} aria-hidden />
              {isUploadingAvatar
                ? t("accountProfile.uploading")
                : photoURL
                  ? t("accountProfile.photo.replace")
                  : t("accountProfile.photo.upload")}
              <input
                type="file"
                accept={allowedAvatarTypes.join(",")}
                disabled={isUploadingAvatar}
                aria-label={t("accountProfile.photo.uploadAria")}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  void handleAvatarChange(file);
                }}
                className="sr-only"
              />
            </label>
            {avatarProgress ? (
              <div className="mt-2">
                <UploadProgressNote progress={avatarProgress} />
              </div>
            ) : null}
          </div>
        </div>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          {t("accountProfile.publicName")}
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="min-w-0 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          {t("accountProfile.username")}
          <div className="flex overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white focus-within:border-[var(--color-primary-light)]">
            <span className="grid place-items-center border-r border-[var(--color-line)] px-3 text-sm font-semibold text-[var(--color-ink-soft)]">
              @
            </span>
            <input
              value={username}
              onChange={(event) => setUsername(normalizeUsername(event.target.value))}
              className="min-w-0 flex-1 px-4 py-3 text-sm font-normal outline-none"
            />
          </div>
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          {t("accountProfile.bio")}
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={4}
            className="min-w-0 resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
          />
          <span className="text-xs font-normal text-[var(--color-ink-soft)]">
            {t("accountProfile.bioCount").replace("{count}", String(bio.trim().length))}
          </span>
        </label>

        {isTeacher ? (
          <>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {t("accountProfile.credentials.title")}
              </p>
              <span className="text-xs font-normal text-[var(--color-ink-soft)]">
                {t("accountProfile.credentials.publicHint")}
              </span>
            </div>
            <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("accountProfile.credentials.hint")}
            </p>
            {credentials.length > 0 ? (
              <div className="grid gap-2">
                {credentials.map((credential, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      value={credential}
                      maxLength={maxCredentialLength}
                      onChange={(event) =>
                        updateCredential(index, event.target.value)
                      }
                      placeholder={t("accountProfile.credentials.placeholder")}
                      className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                    />
                    <button
                      type="button"
                      onClick={() => removeCredential(index)}
                      className="shrink-0 rounded-[10px] border border-[var(--color-line)] px-3 py-3 text-xs font-semibold text-[var(--color-ink-soft)] hover:border-[var(--color-accent-fg)] hover:text-[var(--color-accent-fg)]"
                      aria-label={t("accountProfile.credentials.removeAria").replace("{number}", String(index + 1))}
                    >
                      {t("accountProfile.credentials.remove")}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {credentials.length < maxCredentialEntries ? (
              <button
                type="button"
                onClick={addCredential}
                className="button-outline justify-self-start px-4 py-2 text-xs"
              >
                {t("accountProfile.credentials.add")}
              </button>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 sm:flex-row sm:items-center">
            <div className="relative grid h-16 w-32 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-[var(--color-line)] bg-white">
              {signatureUrl ? (
                <Image
                  src={signatureUrl}
                  alt={t("accountProfile.signature.alt")}
                  fill
                  sizes="128px"
                  className="object-contain p-1"
                  unoptimized
                />
              ) : (
                <span className="px-2 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                  {t("accountProfile.signature.empty")}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {t("accountProfile.signature.title")}
              </p>
              <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
                {t("accountProfile.signature.hint")}
              </p>
              <label
                className={`relative mt-3 inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-primary)] ${
                  isUploadingSignature ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <UploadCloud size={16} aria-hidden />
                {isUploadingSignature
                  ? t("accountProfile.uploading")
                  : signatureUrl
                    ? t("accountProfile.signature.replace")
                    : t("accountProfile.signature.upload")}
                <input
                  type="file"
                  accept={allowedAvatarTypes.join(",")}
                  disabled={isUploadingSignature}
                  aria-label={t("accountProfile.signature.uploadAria")}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    void handleSignatureChange(file);
                  }}
                  className="sr-only"
                />
              </label>
              {signatureProgress ? (
                <div className="mt-2">
                  <UploadProgressNote progress={signatureProgress} />
                </div>
              ) : null}
            </div>
          </div>
          </>
        ) : null}

        <PhoneInput
          value={phoneNumber}
          onChange={setPhoneNumber}
          label={t("accountProfile.phone")}
        />

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          {t("accountProfile.timezone")}
          <select
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="min-w-0 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
          >
            {safeTimezoneOptions.map((option) => (
              <option key={option} value={option}>
                {option.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-2">
          <p className="text-sm font-semibold text-[var(--color-ink)]">{t("accountProfile.goalsTitle")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {goalOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={goals.includes(value)}
                onClick={() => toggleGoal(value)}
                className={`rounded-[10px] border px-4 py-3 text-left text-sm font-semibold ${
                  goals.includes(value)
                    ? "border-[var(--color-primary)] bg-[rgba(24,58,94,0.08)] text-[var(--color-primary)]"
                    : "border-[var(--color-line)] bg-white text-[var(--color-ink-soft)]"
                }`}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p role="alert" className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {formatValidationMessage(error, t)}
          </p>
        ) : null}

        {success ? (
          <p className="info-notice" aria-live="polite">
            {t(success)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSaving}
          className="button-solid justify-self-start px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isSaving ? t("accountProfile.saving") : t("accountProfile.save")}
        </button>
      </form>
    </section>
  );
}
