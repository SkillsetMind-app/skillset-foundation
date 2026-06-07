"use client";

import Link from "next/link";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { UserGoal } from "@/domain/user-profile";
import {
  normalizeUsername,
  validateBio,
  validateDisplayName,
  validateUsername,
} from "@/lib/auth/profile-validation";
import {
  refreshCurrentUserEmailVerification,
  sendSkillsetEmailVerification,
} from "@/lib/auth/firebase-auth";
import {
  completeUserOnboarding,
  getUserProfile,
} from "@/lib/data/user-profiles";
import { getFirebaseApp } from "@/lib/firebase/client";
import type { Role } from "@/lib/permissions";
import { getAuthPathIntentFromSearchParams } from "@/lib/auth/routing";

const paths = [
  {
    title: "Learn with structure",
    description:
      "Access courses, events, communities, progress, and future Skillset Verified credentials.",
    roles: ["student"],
    href: "/learn",
  },
  {
    title: "Teach and publish",
    description:
      "Build courses, upload materials, schedule live sessions, and submit courses for review.",
    roles: ["teacher"],
    href: "/teach",
  },
  {
    title: "Use both sides",
    description:
      "Study, teach, and move between the learner area and educator studio from one account.",
    roles: ["student", "teacher"],
    href: "/platform",
  },
] as const satisfies Array<{
  title: string;
  description: string;
  roles: ReadonlyArray<Extract<Role, "student" | "teacher">>;
  href: string;
}>;

const goalOptions = [
  {
    value: "career_growth",
    label: "Career growth",
    description: "Learn skills that support stronger work opportunities.",
  },
  {
    value: "skill_certification",
    label: "Verified learning",
    description: "Complete structured programs and earn Skillset credentials.",
  },
  {
    value: "teach_online",
    label: "Teach online",
    description: "Turn expertise into courses, lessons, and student outcomes.",
  },
  {
    value: "build_community",
    label: "Build a community",
    description: "Create course-linked spaces for students and members.",
  },
  {
    value: "live_mentorship",
    label: "Live mentorship",
    description: "Run sessions, office hours, and cohort-style support.",
  },
  {
    value: "business_training",
    label: "Team training",
    description: "Prepare for future group, academy, or organization use.",
  },
] as const satisfies Array<{
  value: UserGoal;
  label: string;
  description: string;
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
    const auth = getAuth(getFirebaseApp());

    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setUid(user.uid);
      setEmailVerified(user.emailVerified);
      setDisplayName(user.displayName ?? "");

      try {
        const profile = await getUserProfile(user.uid);
        setDisplayName(profile?.displayName ?? user.displayName ?? "");
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
        setError("Could not load your profile. You can still complete setup.");
      } finally {
        setIsBootstrapping(false);
      }
    });
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
      validateDisplayName(displayName) ||
      validateUsername(username) ||
      validateBio(bio) ||
      (!timezone ? "Choose your timezone." : "")
    );
  }

  async function handleSendVerification() {
    setError("");
    setVerificationMessage("");
    setIsSendingVerification(true);

    try {
      await sendSkillsetEmailVerification();
      setVerificationMessage("Verification email sent. Open it, confirm, then return here.");
    } catch {
      setError("Could not send the verification email. Try again in a moment.");
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
          ? "Email verified. You can continue creator setup."
          : "Email is not verified yet. Confirm it from your inbox first.",
      );
    } catch {
      setError("Could not refresh verification status. Try again.");
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
            ? "Accept the Teacher Terms before opening educator tools."
            : "Verify your email before opening creator tools."
          : "Choose how you want to use Skillset first.",
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
      setError("Your session is not ready. Sign in again to finish setup.");
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
        setError("Select at least one goal so Skillset can shape your workspace.");
        return;
      }
    }

    if (selectedPathIncludesTeacher && !emailVerified) {
      setStep(0);
      setError("Verify your email before opening creator tools.");
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
      setError("Could not finish onboarding. Please try again.");
      setIsSaving(false);
    }
  }

  if (isBootstrapping) {
    return (
      <div className="mt-6 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-5 text-sm font-semibold text-[var(--color-ink-soft)]">
        Preparing your account setup...
      </div>
    );
  }

  if (streamlinedTeacherActivation) {
    return (
      <div className="mt-6 grid gap-5">
        <div className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          <p className="font-semibold text-[var(--color-ink)]">
            One last step to open Teacher Studio
          </p>
          <p className="mt-1">
            Your profile is already set from onboarding. Verify your email and
            accept the Teacher Terms to activate creator tools.
          </p>
        </div>

        <div className="rounded-[12px] border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-[var(--color-ink)]">
                Email verification
              </p>
              <p className="mt-1">
                Creator tools require a verified email before Skillset can
                assign the teacher role.
              </p>
            </div>
            <span
              className={`shrink-0 rounded-[8px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                emailVerified
                  ? "bg-[rgba(26,54,93,0.08)] text-[var(--color-primary)]"
                  : "bg-[rgba(178,34,52,0.08)] text-[var(--color-accent-fg)]"
              }`}
            >
              {emailVerified ? "Verified" : "Required"}
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
                Send verification email
              </button>
              <button
                type="button"
                onClick={handleRefreshVerification}
                disabled={isSendingVerification}
                className="button-solid px-4 py-2 text-xs disabled:opacity-60"
              >
                I verified my email
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
            I accept the{" "}
            <Link
              href="/legal/teacher-terms"
              className="font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
              target="_blank"
            >
              Teacher Terms
            </Link>{" "}
            and understand Skillset reviews courses before marketplace
            publication.
          </span>
        </label>

        {error ? (
          <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => router.push("/learn")}
            disabled={isSaving}
            className="button-outline px-5 py-3 text-sm disabled:opacity-60"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleFinish}
            disabled={isSaving || !emailVerified || !teacherTermsAccepted}
            className="button-solid px-5 py-3 text-sm disabled:opacity-60"
          >
            {isSaving ? "Activating..." : "Activate teaching"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-5">
      <div className="grid grid-cols-3 gap-2">
        {["Path", "Profile", "Goals"].map((label, index) => (
          <div
            key={label}
            className={`rounded-[10px] border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
              step === index
                ? "border-[var(--color-primary)] bg-[rgba(24,58,94,0.08)] text-[var(--color-primary)]"
                : "border-[var(--color-line)] bg-white text-[var(--color-ink-soft)]"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {step === 0 ? (
        <div className="grid gap-4">
          {paths.map((path) => {
            const isSelected = selectedPath?.title === path.title;

            return (
              <button
                key={path.title}
                type="button"
                onClick={() => setSelectedPath(path)}
                className={`rounded-[12px] border p-5 text-left transition-transform hover:-translate-y-1 ${
                  isSelected
                    ? "border-[var(--color-primary)] bg-[rgba(24,58,94,0.08)]"
                    : "border-[var(--color-line)] bg-[var(--color-surface-soft)]"
                }`}
              >
                <h3 className="text-base font-semibold text-[var(--color-ink)]">
                  {path.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                  {path.description}
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
                      Email verification
                    </p>
                    <p className="mt-1">
                      Creator tools require a verified email before Skillset can
                      assign the teacher role.
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-[8px] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                      emailVerified
                        ? "bg-[rgba(26,54,93,0.08)] text-[var(--color-primary)]"
                        : "bg-[rgba(178,34,52,0.08)] text-[var(--color-accent-fg)]"
                    }`}
                  >
                    {emailVerified ? "Verified" : "Required"}
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
                      Send verification email
                    </button>
                    <button
                      type="button"
                      onClick={handleRefreshVerification}
                      disabled={isSendingVerification}
                      className="button-solid px-4 py-2 text-xs disabled:opacity-60"
                    >
                      I verified my email
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
                  I accept the{" "}
                  <Link
                    href="/legal/teacher-terms"
                    className="font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
                    target="_blank"
                  >
                    Teacher Terms
                  </Link>{" "}
                  and understand Skillset reviews courses before marketplace
                  publication.
                </span>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Public name
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
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
                type="text"
                value={username}
                onChange={(event) => setUsername(normalizeUsername(event.target.value))}
                placeholder="patrick-simon"
                maxLength={32}
                className="min-w-0 flex-1 px-4 py-3 text-sm font-normal outline-none"
              />
            </div>
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Short bio
            <textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="A short line about your work, learning goals, or teaching focus."
              rows={4}
              className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
            <span className="text-xs font-normal text-[var(--color-ink-soft)]">
              {bio.trim().length}/280 characters
            </span>
          </label>

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
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-3">
          {goalOptions.map((goal) => {
            const isSelected = goals.includes(goal.value);

            return (
              <button
                key={goal.value}
                type="button"
                onClick={() => toggleGoal(goal.value)}
                className={`rounded-[12px] border p-4 text-left ${
                  isSelected
                    ? "border-[var(--color-primary)] bg-[rgba(24,58,94,0.08)]"
                    : "border-[var(--color-line)] bg-white"
                }`}
              >
                <span className="block text-sm font-semibold text-[var(--color-ink)]">
                  {goal.label}
                </span>
                <span className="mt-1 block text-sm leading-6 text-[var(--color-ink-soft)]">
                  {goal.description}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((currentStep) => Math.max(currentStep - 1, 0))}
            disabled={isSaving}
            className="button-outline px-5 py-3 text-sm disabled:opacity-60"
          >
            Back
          </button>
        ) : null}
        {step < 2 ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={isSaving}
            className="button-solid px-5 py-3 text-sm disabled:opacity-60"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinish}
            disabled={isSaving}
            className="button-solid px-5 py-3 text-sm disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Finish setup"}
          </button>
        )}
      </div>
    </div>
  );
}
