"use client";

import { UploadCloud } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { isValidE164Phone, PhoneInput } from "@/components/shared/phone-input";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { UserGoal } from "@/domain/user-profile";
import {
  maxCredentialEntries,
  maxCredentialLength,
} from "@/domain/user-profile";
import {
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
  avatarRequirementLabel,
  isAllowedAvatarFile,
  signatureRequirementLabel,
  uploadTeacherSignature,
  uploadUserAvatar,
  type UploadAvatarProgress,
} from "@/lib/data/profile-media";

const goalOptions = [
  ["career_growth", "Career growth"],
  ["skill_certification", "Verified learning"],
  ["teach_online", "Teach online"],
  ["build_community", "Build a community"],
  ["live_mentorship", "Live mentorship"],
  ["business_training", "Team training"],
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
          setError("We could not load your profile settings.");
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
      setError("Sign in again to update your profile.");
      return;
    }

    const validationError =
      validateDisplayName(displayName) ||
      validateUsername(username) ||
      validateBio(bio) ||
      validateCredentials(credentials) ||
      (!isValidE164Phone(phoneNumber) ? "Use a valid phone number." : "") ||
      (!timezone ? "Choose your timezone." : "");

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
      setSuccess("Profile updated.");
    } catch {
      setError("We could not save your profile. Try again, and contact support if it keeps failing.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAvatarChange(file: File | null) {
    if (!user || !file) {
      return;
    }

    if (!isAllowedAvatarFile(file)) {
      setError(`Use a ${avatarRequirementLabel} profile image.`);
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
      setSuccess("Profile photo updated.");
    } catch (error) {
      console.error(
        "Profile avatar upload failed",
        { uid: user.uid },
        error,
      );
      const message =
        error instanceof Error && error.message
          ? error.message
          : "We could not upload your profile photo. Please try again.";
      setError(message);
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
      setError(`Use a ${signatureRequirementLabel} image.`);
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
      setSuccess("Certificate signature updated.");
    } catch (error) {
      console.error(
        "Teacher signature upload failed",
        { uid: user.uid },
        error,
      );
      const message =
        error instanceof Error && error.message
          ? error.message
          : "We could not upload your signature. Please try again.";
      setError(message);
    } finally {
      setIsUploadingSignature(false);
      setSignatureProgress(null);
    }
  }

  if (isLoading) {
    return (
      <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">Loading profile settings...</p>
      </section>
    );
  }

  return (
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
        Account identity
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        Profile settings
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Keep your Skillset identity clear for learning, teaching, communities, and future public profiles.
      </p>

      <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4 rounded-[4px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 sm:flex-row sm:items-center">
          <UserAvatar
            name={displayName || user?.email}
            photoURL={photoURL}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              Profile photo
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
              Use a clear square image ({avatarRequirementLabel}). If you skip
              it, Skillset shows a neutral person icon instead of a letter badge.
            </p>
            <label
              className={`mt-3 inline-flex w-fit cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] ${
                isUploadingAvatar ? "pointer-events-none opacity-60" : ""
              }`}
            >
              <UploadCloud size={16} aria-hidden />
              {isUploadingAvatar
                ? "Uploading..."
                : photoURL
                  ? "Replace photo"
                  : "Upload photo"}
              <input
                type="file"
                accept={allowedAvatarTypes.join(",")}
                disabled={isUploadingAvatar}
                aria-label="Upload profile photo"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  void handleAvatarChange(file);
                }}
                className="hidden"
              />
            </label>
            {avatarProgress ? (
              <p className="mt-2 text-xs font-semibold text-[var(--color-primary)]">
                Uploading {avatarProgress.percent}%
              </p>
            ) : null}
          </div>
        </div>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Public name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Username
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
          Bio
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={4}
            className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
          />
          <span className="text-xs font-normal text-[var(--color-ink-soft)]">
            {bio.trim().length}/280 characters
          </span>
        </label>

        {isTeacher ? (
          <>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                Credentials
              </p>
              <span className="text-xs font-normal text-[var(--color-ink-soft)]">
                Shown on your public instructor profile
              </span>
            </div>
            <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
              Short credibility lines &mdash; for example &ldquo;Professor at
              University of S&atilde;o Paulo&rdquo; or &ldquo;15 years coaching
              sales teams&rdquo;.
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
                      placeholder="e.g. Professor at University of São Paulo"
                      className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                    />
                    <button
                      type="button"
                      onClick={() => removeCredential(index)}
                      className="shrink-0 rounded-[10px] border border-[var(--color-line)] px-3 py-3 text-xs font-semibold text-[var(--color-ink-soft)] hover:border-[var(--color-accent-fg)] hover:text-[var(--color-accent-fg)]"
                      aria-label={`Remove credential ${index + 1}`}
                    >
                      Remove
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
                Add credential
              </button>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 rounded-[4px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 sm:flex-row sm:items-center">
            <div className="relative grid h-16 w-32 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-[var(--color-line)] bg-white">
              {signatureUrl ? (
                <Image
                  src={signatureUrl}
                  alt="Your certificate signature"
                  fill
                  sizes="128px"
                  className="object-contain p-1"
                  unoptimized
                />
              ) : (
                <span className="px-2 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                  No signature
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                Certificate signature
              </p>
              <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
                Optional. Upload your handwritten signature ({signatureRequirementLabel}).
                It prints on every certificate your students earn. Skip it and
                your name is printed instead.
              </p>
              <label
                className={`mt-3 inline-flex w-fit cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:border-[var(--color-primary-light)] ${
                  isUploadingSignature ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <UploadCloud size={16} aria-hidden />
                {isUploadingSignature
                  ? "Uploading..."
                  : signatureUrl
                    ? "Replace signature"
                    : "Upload signature"}
                <input
                  type="file"
                  accept={allowedAvatarTypes.join(",")}
                  disabled={isUploadingSignature}
                  aria-label="Upload certificate signature"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    void handleSignatureChange(file);
                  }}
                  className="hidden"
                />
              </label>
              {signatureProgress ? (
                <p className="mt-2 text-xs font-semibold text-[var(--color-primary)]">
                  Uploading {signatureProgress.percent}%
                </p>
              ) : null}
            </div>
          </div>
          </>
        ) : null}

        <PhoneInput
          value={phoneNumber}
          onChange={setPhoneNumber}
          label="Phone number"
        />

        <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
          Timezone
          <select
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
          >
            {safeTimezoneOptions.map((option) => (
              <option key={option} value={option}>
                {option.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-2">
          <p className="text-sm font-semibold text-[var(--color-ink)]">Goals</p>
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
                {label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="rounded-[10px] border border-[rgba(26,54,93,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]">
            {success}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSaving}
          className="button-solid justify-self-start px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save profile"}
        </button>
      </form>
    </section>
  );
}
