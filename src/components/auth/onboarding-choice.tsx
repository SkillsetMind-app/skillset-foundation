"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { UserGoal } from "@/domain/user-profile";
import {
  formatValidationMessage,
  normalizeUsername,
  validateBio,
  validateDisplayName,
  validateUsername,
} from "@/lib/auth/profile-validation";
import {
  listenToAuthState,
  refreshCurrentUserEmailVerification,
  sendSkillsetEmailVerification,
} from "@/lib/auth/supabase-auth";
import {
  completeUserOnboarding,
  getUserProfile,
} from "@/lib/data/user-profiles";
import type { Role } from "@/lib/permissions";
import { getAuthPathIntentFromSearchParams } from "@/lib/auth/routing";

const paths = [
  {
    titleKey: "onboarding.pathLearnTitle",
    descriptionKey: "onboarding.pathLearnDesc",
    roles: ["student"],
    href: "/learn",
  },
  {
    titleKey: "onboarding.pathTeachTitle",
    descriptionKey: "onboarding.pathTeachDesc",
    roles: ["teacher"],
    href: "/teach",
  },
  {
    titleKey: "onboarding.pathBothTitle",
    descriptionKey: "onboarding.pathBothDesc",
    roles: ["student", "teacher"],
    href: "/platform",
  },
] as const satisfies Array<{
  titleKey: string;
  descriptionKey: string;
  roles: ReadonlyArray<Extract<Role, "student" | "teacher">>;
  href: string;
}>;

const goalOptions = [
  {
    value: "career_growth",
    labelKey: "onboarding.goalCareerLabel",
    descriptionKey: "onboarding.goalCareerDesc",
  },
  {
    value: "skill_certification",
    labelKey: "onboarding.goalCertificationLabel",
    descriptionKey: "onboarding.goalCertificationDesc",
  },
  {
    value: "teach_online",
    labelKey: "onboarding.goalTeachLabel",
    descriptionKey: "onboarding.goalTeachDesc",
  },
  {
    value: "build_community",
    labelKey: "onboarding.goalCommunityLabel",
    descriptionKey: "onboarding.goalCommunityDesc",
  },
  {
    value: "live_mentorship",
    labelKey: "onboarding.goalMentorshipLabel",
    descriptionKey: "onboarding.goalMentorshipDesc",
  },
  {
    value: "business_training",
    labelKey: "onboarding.goalTrainingLabel",
    descriptionKey: "onboarding.goalTrainingDesc",
  },
] as const satisfies Array<{
  value: UserGoal;
  labelKey: string;
  descriptionKey: string;
}>;

const timezoneOptions = [
  "America/New_York",
  "America/Sao_Paulo",
  "America/Los_Angeles",
  "Europe/London",
  "Africa/Lagos",
  "Africa/Johannesburg",
];

export function OnboardingChoice() {
  const router = useRouter();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  const [step, setStep] = useState(0);
  const [uid, setUid] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<(typeof paths)[number] | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [teacherTermsAccepted, setTeacherTermsAccepted] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [error, setError] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Streamlined teacher activation: user already completed the new
  // onboarding wizard. Do not re-ask path/profile/goals. Only gate the
  // teacher role behind email verification + Teacher Terms.
  const [streamlinedTeacherActivation, setStreamlinedTeacherActivation] =
    useState(false);

  useEffect(() => {
    // Supabase re-fires onAuthStateChange on TOKEN_REFRESHED / USER_UPDATED —
    // the hourly refresh, a tab regaining focus, the email-verification round
    // trip this very screen triggers. uid and emailVerified are server truth
    // and have to stay fresh, but re-seeding the form on those events throws
    // away everything typed since. Seed once per subscription; a pathIntent
    // change re-runs the effect and seeds again.
    let seeded = false;

    return listenToAuthState((session) => {
      if (session.status === "loading") {
        return;
      }

      if (session.status === "unauthenticated" || !session.user) {
        router.push("/login");
        return;
      }

      const authedUser = session.user;
      setUid(authedUser.uid);
      setEmailVerified(authedUser.emailVerified);

      if (seeded) {
        return;
      }
      seeded = true;

      setDisplayName(authedUser.displayName ?? "");

      void (async () => {
        try {
          const profile = await getUserProfile(authedUser.uid);
          setDisplayName(profile?.displayName ?? authedUser.displayName ?? "");
          setUsername(profile?.username ?? "");
          setBio(profile?.bio ?? "");
          setTimezone(
            profile?.timezone ??
              Intl.DateTimeFormat().resolvedOptions().timeZone ??
              "America/New_York",
          );
          setGoals(profile?.goals ?? []);
          setTeacherTermsAccepted(Boolean(profile?.teacherTermsAcceptedAt));

          const intendedRole = pathIntent ?? "student";
          const intendedPath = paths.find((path) =>
            path.roles.some((role) => role === intendedRole),
          );
          const existingPath = profile?.onboardingCompleted
            ? paths.find((path) =>
                path.roles.every((role) => profile?.roles.includes(role)),
              )
            : null;

          // Wizard already gathered the survey. If this is a teacher who
          // finished the wizard but does not yet hold the teacher role,
          // collapse to a single activation step instead of re-asking
          // path/profile/goals.
          const finishedWizardAsTeacher =
            pathIntent === "teacher" &&
            Boolean(profile?.onboardingCompleted) &&
            profile?.onboardingPath === "teacher" &&
            !(profile?.roles ?? []).includes("teacher");

          if (finishedWizardAsTeacher) {
            const teacherPath = paths.find((path) => {
              const roles = path.roles as readonly Role[];
              return roles.includes("teacher") && !roles.includes("student");
            });
            setStreamlinedTeacherActivation(true);
            setSelectedPath(teacherPath ?? null);
            // Seed a default goal so the existing finish guard
            // (goals.length === 0) does not block activation. The wizard's
            // category answers use a different taxonomy.
            if (!profile?.goals || profile.goals.length === 0) {
              setGoals(["teach_online"]);
            }
          } else if (intendedPath || existingPath) {
            setSelectedPath(intendedPath ?? existingPath ?? null);
          }
        } catch {
          setError(t("onboarding.errorProfileLoad"));
        } finally {
          setIsBootstrapping(false);
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable per locale; re-subscribing auth on locale change would drop state
  }, [pathIntent, router]);

  const safeTimezoneOptions = useMemo(() => {
    if (timezoneOptions.includes(timezone)) {
      return timezoneOptions;
    }

    return [timezone, ...timezoneOptions];
  }, [timezone]);

  const selectedPathIncludesTeacher =
    selectedPath?.roles.some((role) => role === "teacher") ?? false;
  const canContinue = selectedPath !== null
    && (!selectedPathIncludesTeacher || (teacherTermsAccepted && emailVerified));

  function toggleGoal(goal: UserGoal) {
    setGoals((currentGoals) =>
      currentGoals.includes(goal)
        ? currentGoals.filter((currentGoal) => currentGoal !== goal)
        : [...currentGoals, goal],
    );
  }

  function validateProfileStep() {
    return (
      formatValidationMessage(validateDisplayName(displayName), t) ||
      formatValidationMessage(validateUsername(username), t) ||
      formatValidationMessage(validateBio(bio), t) ||
      (!timezone ? t("onboarding.errorChooseTimezone") : "")
    );
  }

  async function handleSendVerification() {
    setError("");
    setVerificationMessage("");
    setIsSendingVerification(true);

    try {
      await sendSkillsetEmailVerification();
      setVerificationMessage(t("onboarding.verificationSent"));
    } catch {
      setError(t("onboarding.verificationSendError"));
    } finally {
      setIsSendingVerification(false);
    }
  }

  async function handleRefreshVerification() {
    setError("");
    setVerificationMessage("");
    setIsSendingVerification(true);

    try {
      const verified = await refreshCurrentUserEmailVerification();
      setEmailVerified(verified);
      setVerificationMessage(
        verified
          ? t("onboarding.verificationOk")
          : t("onboarding.verificationPending"),
      );
    } catch {
      setError(t("onboarding.verificationRefreshError"));
    } finally {
      setIsSendingVerification(false);
    }
  }

  function handleNext() {
    setError("");

    if (step === 0 && !canContinue) {
      setError(
        selectedPathIncludesTeacher
          ? emailVerified
            ? t("onboarding.errorAcceptTerms")
            : t("onboarding.errorVerifyEmail")
          : t("onboarding.errorChoosePath"),
      );
      return;
    }

    if (step === 1) {
      const validationError = validateProfileStep();

      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setStep((currentStep) => Math.min(currentStep + 1, 2));
  }

  async function handleFinish() {
    setError("");

    if (!uid || !selectedPath) {
      setError(t("onboarding.errorSessionNotReady"));
      return;
    }

    // Streamlined teacher activation skips profile/goals re-validation:
    // the wizard already captured identity and survey answers. Only the
    // security gate (verified email + Teacher Terms) matters here.
    if (!streamlinedTeacherActivation) {
      const validationError = validateProfileStep();

      if (validationError) {
        setStep(1);
        setError(validationError);
        return;
      }

      if (goals.length === 0) {
        setError(t("onboarding.errorSelectGoal"));
        return;
      }
    }

    if (selectedPathIncludesTeacher && !emailVerified) {
      setStep(0);
      setError(t("onboarding.errorVerifyEmail"));
      return;
    }

    setIsSaving(true);

    try {
      await completeUserOnboarding({
        uid,
        roles: selectedPath.roles,
        acceptTeacherTerms: selectedPathIncludesTeacher && teacherTermsAccepted,
        identity: {
          displayName,
          username: normalizeUsername(username),
          bio,
          timezone,
          goals,
        },
      });

      router.push(selectedPath.href);
    } catch {
      setError(t("onboarding.errorFinish"));
      setIsSaving(false);
    }
  }

  if (isBootstrapping) {
    return (
      <div className="mt-6 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-5 text-sm font-semibold text-[var(--color-ink-soft)]">
        {t("onboarding.preparing")}
      </div>
    );
  }

  if (streamlinedTeacherActivation) {
    return (
      <div className="mt-6 grid gap-5">
        <div className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          <p className="font-semibold text-[var(--color-ink)]">
            {t("onboarding.streamlinedTitle")}
          </p>
          <p className="mt-1">{t("onboarding.streamlinedDesc")}</p>
        </div>

        <div className="rounded-[12px] border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-[var(--color-ink)]">
                {t("onboarding.emailVerificationTitle")}
              </p>
              <p className="mt-1">{t("onboarding.emailVerificationDesc")}</p>
            </div>
            <span
              className={`shrink-0 rounded-[8px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                emailVerified
                  ? "bg-[rgba(26,54,93,0.08)] text-[var(--color-primary)]"
                  : "bg-[rgba(178,34,52,0.08)] text-[var(--color-accent-fg)]"
              }`}
            >
              {emailVerified ? t("onboarding.verified") : t("onboarding.required")}
            </span>
          </div>
          {!emailVerified ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSendVerification}
                disabled={isSendingVerification}
                className="button-outline px-4 py-2 text-xs disabled:opacity-60"
              >
                {t("onboarding.sendVerification")}
              </button>
              <button
                type="button"
                onClick={handleRefreshVerification}
                disabled={isSendingVerification}
                className="button-solid px-4 py-2 text-xs disabled:opacity-60"
              >
                {t("onboarding.iVerified")}
              </button>
            </div>
          ) : null}
          {verificationMessage ? (
            <p className="mt-3 text-xs font-semibold text-[var(--color-primary)]">
              {verificationMessage}
            </p>
          ) : null}
        </div>

        <label className="flex gap-3 rounded-[12px] border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={teacherTermsAccepted}
            onChange={(event) => setTeacherTermsAccepted(event.target.checked)}
            className="mt-1 size-4 accent-[var(--color-primary)]"
          />
          <span>
            {t("onboarding.teacherTermsPrefix")}{" "}
            <Link
              href="/legal/teacher-terms"
              className="font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
              target="_blank"
            >
              {t("onboarding.teacherTermsLink")}
            </Link>{" "}
            {t("onboarding.teacherTermsSuffix")}
          </span>
        </label>

        {error ? (
          <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => router.push("/learn")}
            disabled={isSaving}
            className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {t("onboarding.skipForNow")}
          </button>
          <button
            type="button"
            onClick={handleFinish}
            disabled={isSaving || !emailVerified || !teacherTermsAccepted}
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {isSaving ? t("onboarding.activating") : t("onboarding.activateTeaching")}
          </button>
        </div>
      </div>
    );
  }

  const stepLabels = [
    t("onboarding.stepPath"),
    t("onboarding.stepProfile"),
    t("onboarding.stepGoals"),
  ];
  const stepCounter = t("onboarding.stepOf")
    .replace("{current}", String(step + 1))
    .replace("{total}", String(stepLabels.length));

  return (
    <div className="mt-5 grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="uppercase tracking-[0.16em] text-[var(--color-primary)]">
            {stepLabels[step]}
          </span>
          <span className="text-[var(--color-ink-soft)]">{stepCounter}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--color-surface-soft)]">
          <div
            className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-300"
            style={{ width: `${((step + 1) / stepLabels.length) * 100}%` }}
          />
        </div>
      </div>

      {step === 0 ? (
        <div className="grid gap-2.5">
          {paths.map((path) => {
            const isSelected = selectedPath?.titleKey === path.titleKey;

            return (
              <button
                key={path.titleKey}
                type="button"
                onClick={() => setSelectedPath(path)}
                className={`rounded-[12px] border p-4 text-left transition-colors ${
                  isSelected
                    ? "border-[var(--color-primary)] bg-[rgba(24,58,94,0.08)]"
                    : "border-[var(--color-line)] bg-[var(--color-surface-soft)] hover:border-[var(--color-primary-light)]"
                }`}
              >
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                  {t(path.titleKey)}
                </h3>
                <p className="mt-1 text-[13px] leading-5 text-[var(--color-ink-soft)]">
                  {t(path.descriptionKey)}
                </p>
              </button>
            );
          })}

          {selectedPathIncludesTeacher ? (
            <div className="grid gap-3">
              <div className="rounded-[12px] border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">
                      {t("onboarding.emailVerificationTitle")}
                    </p>
                    <p className="mt-1">{t("onboarding.emailVerificationDesc")}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-[8px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                      emailVerified
                        ? "bg-[rgba(26,54,93,0.08)] text-[var(--color-primary)]"
                        : "bg-[rgba(178,34,52,0.08)] text-[var(--color-accent-fg)]"
                    }`}
                  >
                    {emailVerified ? t("onboarding.verified") : t("onboarding.required")}
                  </span>
                </div>
                {!emailVerified ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSendVerification}
                      disabled={isSendingVerification}
                      className="button-outline px-4 py-2 text-xs disabled:opacity-60"
                    >
                      {t("onboarding.sendVerification")}
                    </button>
                    <button
                      type="button"
                      onClick={handleRefreshVerification}
                      disabled={isSendingVerification}
                      className="button-solid px-4 py-2 text-xs disabled:opacity-60"
                    >
                      {t("onboarding.iVerified")}
                    </button>
                  </div>
                ) : null}
                {verificationMessage ? (
                  <p className="mt-3 text-xs font-semibold text-[var(--color-primary)]">
                    {verificationMessage}
                  </p>
                ) : null}
              </div>

              <label className="flex gap-3 rounded-[12px] border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
                <input
                  type="checkbox"
                  checked={teacherTermsAccepted}
                  onChange={(event) => setTeacherTermsAccepted(event.target.checked)}
                  className="mt-1 size-4 accent-[var(--color-primary)]"
                />
                <span>
                  {t("onboarding.teacherTermsPrefix")}{" "}
                  <Link
                    href="/legal/teacher-terms"
                    className="font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
                    target="_blank"
                  >
                    {t("onboarding.teacherTermsLink")}
                  </Link>{" "}
                  {t("onboarding.teacherTermsSuffix")}
                </span>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
              {t("onboarding.publicName")}
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t("onboarding.publicNamePlaceholder")}
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
              {t("onboarding.username")}
              <div className="flex overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white focus-within:border-[var(--color-primary-light)]">
                <span className="grid place-items-center border-r border-[var(--color-line)] px-3 text-sm font-semibold text-[var(--color-ink-soft)]">
                  @
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(normalizeUsername(event.target.value))}
                  placeholder={t("onboarding.usernamePlaceholder")}
                  maxLength={32}
                  className="min-w-0 flex-1 px-3.5 py-2.5 text-sm font-normal outline-none"
                />
              </div>
            </label>
          </div>

          <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
            {t("onboarding.shortBio")}
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder={t("onboarding.bioPlaceholder")}
              rows={3}
              className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
            <span className="text-xs font-normal text-[var(--color-ink-soft)]">
              {t("onboarding.bioCount").replace("{count}", String(bio.trim().length))}
            </span>
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
            {t("onboarding.timezone")}
            <select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            >
              {safeTimezoneOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {goalOptions.map((goal) => {
            const isSelected = goals.includes(goal.value);

            return (
              <button
                key={goal.value}
                type="button"
                onClick={() => toggleGoal(goal.value)}
                className={`rounded-[12px] border p-3 text-left transition-colors ${
                  isSelected
                    ? "border-[var(--color-primary)] bg-[rgba(24,58,94,0.08)]"
                    : "border-[var(--color-line)] bg-white hover:border-[var(--color-primary-light)]"
                }`}
              >
                <span className="block text-sm font-semibold text-[var(--color-ink)]">
                  {t(goal.labelKey)}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--color-ink-soft)]">
                  {t(goal.descriptionKey)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((currentStep) => Math.max(currentStep - 1, 0))}
            disabled={isSaving}
            className="button-outline px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {t("onboarding.back")}
          </button>
        ) : null}
        {step < 2 ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={isSaving}
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {t("onboarding.continue")}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinish}
            disabled={isSaving}
            className="button-solid px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {isSaving ? t("onboarding.saving") : t("onboarding.finishSetup")}
          </button>
        )}
      </div>
    </div>
  );
}
