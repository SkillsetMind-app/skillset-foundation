"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { usePageHeading } from "@/components/auth/page-heading";
import {
  TurnstileWidget,
  isCaptchaEnabled,
} from "@/components/auth/turnstile-widget";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { BusyLabel } from "@/components/ui/busy-label";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { SkillsetUser } from "@/domain/auth";
import type { OnboardingAnswers, UserGoal } from "@/domain/user-profile";
import { CONNECT_PAYOUT_COUNTRIES, isConnectPayoutCountry } from "@/lib/payments/connect-countries";
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
  updateOnboardingAnswers,
} from "@/lib/data/user-profiles";
import type { Role } from "@/lib/permissions";
import {
  getAuthPathIntentFromSearchParams,
  getPlanCheckoutReturnTo,
} from "@/lib/auth/routing";

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

// What the screen keeps of the account, as it starts on a clean mount. It goes back to this
// when the session becomes another account's (showCleanEntry): nothing that came
// from the previous one, read or typed, stays for the new one.
const cleanEntry = {
  step: 0,
  selectedPath: null as (typeof paths)[number] | null,
  displayName: "",
  username: "",
  bio: "",
  timezone: "America/New_York",
  goals: [] as UserGoal[],
  onboardingAnswers: {} as OnboardingAnswers,
  answersLoaded: false,
  payoutCountry: "",
  teacherTermsAccepted: false,
  verificationMessage: "",
  error: "",
  readError: "",
  streamlinedTeacherActivation: false,
  askPayoutCountry: true,
  askEmailVerification: true,
};

export function OnboardingChoice() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const { locale, t } = useTranslation();
  const searchParams = useSearchParams();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  // The plan picked on /pricing, when the visitor came from one of its
  // buttons. Only that card screen counts: any other returnTo is ignored here.
  const planCheckout = useMemo(
    () => getPlanCheckoutReturnTo(searchParams.get("returnTo")),
    [searchParams],
  );
  const [step, setStep] = useState(cleanEntry.step);
  const [uid, setUid] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<(typeof paths)[number] | null>(cleanEntry.selectedPath);
  const [displayName, setDisplayName] = useState(cleanEntry.displayName);
  const [username, setUsername] = useState(cleanEntry.username);
  const [bio, setBio] = useState(cleanEntry.bio);
  const [timezone, setTimezone] = useState(cleanEntry.timezone);
  const [goals, setGoals] = useState<UserGoal[]>(cleanEntry.goals);
  const [onboardingAnswers, setOnboardingAnswers] = useState<OnboardingAnswers>(cleanEntry.onboardingAnswers);
  // Stays false until a profile read responds. Goes back to false only on an account
  // switch (showCleanEntry), together with the entry wait.
  const [answersLoaded, setAnswersLoaded] = useState(cleanEntry.answersLoaded);
  const [payoutCountry, setPayoutCountry] = useState(cleanEntry.payoutCountry);
  const [teacherTermsAccepted, setTeacherTermsAccepted] = useState(cleanEntry.teacherTermsAccepted);
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState(cleanEntry.verificationMessage);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  // The verification resend is CAPTCHA-guarded like sign-up. Same widget as the
  // auth forms: with no site key it renders nothing and the token stays "".
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const captchaPending = isCaptchaEnabled && !captchaToken;
  const [error, setError] = useState(cleanEntry.error);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Whoever already finished the signup does not repeat profile/goals in the activation.
  const [streamlinedTeacherActivation, setStreamlinedTeacherActivation] =
    useState(cleanEntry.streamlinedTeacherActivation);
  // In the short activation only what is missing shows. Decided once, with what came
  // saved: otherwise the country field would vanish the moment the person chose, and
  // the email card would vanish along with the "verified" they just saw.
  // "Other country" keeps showing, because of the notice that without an eligible
  // payout account selling is not possible.
  const [askPayoutCountry, setAskPayoutCountry] = useState(cleanEntry.askPayoutCountry);
  const [askEmailVerification, setAskEmailVerification] = useState(cleanEntry.askEmailVerification);
  // "Try again" for the profile read re-reads ONLY the profile (getUserProfile, a
  // select), with the last person the session delivered. Resubscribing the session
  // (the counter in the effect dependencies, as on other screens) would run
  // supabase-auth resolveProfile again, which writes: claim_my_course_grants
  // and, if the row is missing, creates the profile.
  const authedUserRef = useRef<SkillsetUser | null>(null);
  // Each read gets a number; only the newest one writes to the screen. A late
  // response ("Try again" and a new session read at the same time) does not
  // overwrite the most recent one.
  const loadGeneration = useRef(0);
  // The read notice lives in the same place and for the same time as the error of
  // today (it goes away on the next click that clears the error); only it gets "Try again".
  const [readError, setReadError] = useState(cleanEntry.readError);
  const showReadError = error !== "" && error === readError;
  // The page title (the h1 above this screen) stays visible during the wait and after
  // it: it receives the focus from "Try again", which vanishes with the wait.
  const rootRef = useRef<HTMLDivElement>(null);
  const pageHeadingRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!showReadError) return;
    const heading = rootRef.current?.parentElement?.querySelector<HTMLElement>("h1") ?? null;
    if (heading) heading.tabIndex = -1;
    pageHeadingRef.current = heading;
  }, [showReadError]);

  async function loadProfile(authedUser: SkillsetUser, afterRetry = false) {
    const generation = ++loadGeneration.current;
    try {
      const profile = await getUserProfile(authedUser.uid);
      if (generation !== loadGeneration.current) return;
      setDisplayName(profile?.displayName ?? authedUser.displayName ?? "");
      setUsername(profile?.username ?? "");
      setBio(profile?.bio ?? "");
      setTimezone(
        profile?.timezone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone ??
          "America/New_York",
      );
      setGoals(profile?.goals ?? []);
      setOnboardingAnswers(profile?.onboardingAnswers ?? {});
      setAnswersLoaded(true);
      setPayoutCountry(profile?.onboardingAnswers?.payoutCountry ?? "");
      setAskPayoutCountry(!isConnectPayoutCountry(profile?.onboardingAnswers?.payoutCountry));
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

      // Whoever finished as a learner also activates teaching without repeating the signup.
      const finishedWizardAsTeacher =
        pathIntent === "teacher" &&
        Boolean(profile?.onboardingCompleted) &&
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
      // A read that worked clears the notice from an earlier read that
      // failed (another path in the address re-reads); other errors stay.
      const readMessage = t("onboarding.errorProfileLoadRetry");
      setError((current) => (current === readMessage ? "" : current));
      setReadError("");
      if (afterRetry) pageHeadingRef.current?.focus();
    } catch {
      if (generation !== loadGeneration.current) return;
      const message = t("onboarding.errorProfileLoadRetry");
      setError(message);
      setReadError(message);
    } finally {
      if (generation === loadGeneration.current) setIsBootstrapping(false);
    }
  }

  // Goes back to the entry wait (nothing clickable) and re-reads the profile once. The step
  // does not change, as with every read on this screen. The notice is usually on step
  // 0 (without a profile read, neither "Continue" nor "Finish" leaves it), but a
  // re-read that fails after the address path changed, with the profile
  // already read before, shows it on the step where the person is.
  function retryLoad() {
    const authedUser = authedUserRef.current;
    if (!authedUser) return;
    setError("");
    setReadError("");
    setIsBootstrapping(true);
    return loadProfile(authedUser, true);
  }

  // The session became another account's: the screen goes back to a clean mount's,
  // on the entry wait (nothing clickable), until the new account's profile read
  // responds. Writes nothing.
  function showCleanEntry() {
    setIsBootstrapping(true);
    setStep(cleanEntry.step);
    setSelectedPath(cleanEntry.selectedPath);
    setDisplayName(cleanEntry.displayName);
    setUsername(cleanEntry.username);
    setBio(cleanEntry.bio);
    setTimezone(cleanEntry.timezone);
    setGoals(cleanEntry.goals);
    setOnboardingAnswers(cleanEntry.onboardingAnswers);
    setAnswersLoaded(cleanEntry.answersLoaded);
    setPayoutCountry(cleanEntry.payoutCountry);
    setTeacherTermsAccepted(cleanEntry.teacherTermsAccepted);
    setVerificationMessage(cleanEntry.verificationMessage);
    setError(cleanEntry.error);
    setReadError(cleanEntry.readError);
    setStreamlinedTeacherActivation(cleanEntry.streamlinedTeacherActivation);
    setAskPayoutCountry(cleanEntry.askPayoutCountry);
    setAskEmailVerification(cleanEntry.askEmailVerification);
  }

  useEffect(() => {
    // Supabase re-fires onAuthStateChange on TOKEN_REFRESHED / USER_UPDATED —
    // the hourly refresh, a tab regaining focus, the email-verification round
    // trip this very screen triggers. uid and emailVerified are server truth
    // and have to stay fresh, but re-seeding the form on those events throws
    // away everything typed since. Seed once per account per subscription; a
    // pathIntent change re-runs the effect and seeds again.
    // Keeps WHOSE profile was seeded, not a boolean: the same account again
    // (renewal, focus, INITIAL_SESSION and then SIGNED_IN, a "loading" in the
    // middle) does not re-read or erase anything. Another account (signed out and in with another in
    // another tab) re-reads: otherwise Finish would write to the new account what the screen
    // carried over from the previous one.
    let seededUid: string | null = null;

    return listenToAuthState((session) => {
      // Outside "authenticated" (account switch, sign-out, second factor) there is no
      // person to re-read: a "Try again" at that moment would read the previous id.
      if (session.status !== "authenticated" || !session.user) {
        authedUserRef.current = null;
      }

      if (session.status === "loading") {
        return;
      }

      if (session.status === "unauthenticated" || !session.user) {
        router.push("/login");
        return;
      }

      const authedUser = session.user;
      authedUserRef.current = authedUser;
      setUid(authedUser.uid);
      setEmailVerified(authedUser.emailVerified);

      if (seededUid === authedUser.uid) {
        return;
      }
      if (seededUid !== null) showCleanEntry();
      seededUid = authedUser.uid;

      setDisplayName(authedUser.displayName ?? "");
      setAskEmailVerification(!authedUser.emailVerified);

      void loadProfile(authedUser);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable per locale, loadProfile only reads pathIntent and t, showCleanEntry only calls setters; re-subscribing auth on locale change would drop state
  }, [pathIntent, router]);

  const safeTimezoneOptions = useMemo(() => {
    if (timezoneOptions.includes(timezone)) {
      return timezoneOptions;
    }

    return [timezone, ...timezoneOptions];
  }, [timezone]);

  const selectedPathIncludesTeacher =
    selectedPath?.roles.some((role) => role === "teacher") ?? false;
  // Accepting the teacher terms publishes the profile: said next to the checkbox,
  // with the chosen @ (or the format, before choosing).
  const publicProfileNotice = t("onboarding.publicProfileNotice").replace(
    "{handle}",
    () => normalizeUsername(username) || t("onboarding.usernamePlaceholder"),
  );
  // The short activation has no @ field: without one, the text showed the example
  // "@your-name" as if it were the person's address. It only says it is public.
  const streamlinedProfileNotice = normalizeUsername(username)
    ? publicProfileNotice
    : t("onboarding.publicProfileNoticeNoHandle");
  const canContinue = selectedPath !== null
    && (!selectedPathIncludesTeacher || (teacherTermsAccepted && emailVerified));
  const payoutCountryAnswered = payoutCountry === "other" || isConnectPayoutCountry(payoutCountry);
  const regionNames = new Intl.DisplayNames(locale, { type: "region" });
  const payoutCountryField = (
    <div className="grid gap-2">
      <label htmlFor="activation-payout-country" className="text-sm font-semibold text-[var(--color-ink)]">
        {t("connectOnboarding.countryLabel")}
      </label>
      <select
        id="activation-payout-country"
        value={payoutCountry}
        disabled={isSaving}
        onChange={(event) => setPayoutCountry(event.target.value)}
        aria-describedby="activation-payout-hint activation-payout-warning"
        className="field-input w-full"
      >
        <option value="">{t("onboarding.payoutCountryPlaceholder")}</option>
        {CONNECT_PAYOUT_COUNTRIES.map((code) => ({ code, label: regionNames.of(code) ?? code }))
          .sort((a, b) => a.label.localeCompare(b.label, locale))
          .map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
        <option value="other">{t("onboarding.payoutCountryOther")}</option>
      </select>
      <p id="activation-payout-hint" className="text-sm leading-6 text-[var(--color-ink-soft)]">{t("onboarding.payoutCountryHint")}</p>
      <p id="activation-payout-warning" role="status" className="text-sm leading-6 text-[var(--color-ink-soft)]">
        {payoutCountry === "other" ? t("onboarding.payoutCountryUnavailable") : null}
      </p>
    </div>
  );

  // The same card on both screens (short activation and step 1 of the signup).
  const emailVerificationCard = (
    <div className="rounded-lg border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-[var(--color-ink)]">
            {t("onboarding.emailVerificationTitle")}
          </p>
          <p className="mt-1">{t("onboarding.emailVerificationDesc")}</p>
        </div>
        {/* "Required" is a warning, not an error: the platform warning colors (as
            on the Security tab), instead of the old red pink with gold. */}
        <span
          className={`shrink-0 rounded-chip px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
            emailVerified
              ? "bg-[rgba(26,54,93,0.08)] text-[var(--color-primary)]"
              : "bg-[var(--color-warning-soft)] text-[var(--color-warning-fg)]"
          }`}
        >
          {emailVerified ? t("onboarding.verified") : t("onboarding.required")}
        </span>
      </div>
      {!emailVerified ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {isCaptchaEnabled ? (
            <div className="basis-full">
              <TurnstileWidget
                onToken={setCaptchaToken}
                resetSignal={captchaResetSignal}
              />
            </div>
          ) : null}
          {/* Both outlined and 14px: the full button on the screen is the one that activates
              (or continues). A full "I verified my email" competed with it. */}
          <button
            type="button"
            onClick={handleSendVerification}
            disabled={isSendingVerification || captchaPending}
            className="button-outline px-4 py-2 text-sm"
          >
            {t("onboarding.sendVerification")}
          </button>
          <button
            type="button"
            onClick={handleRefreshVerification}
            disabled={isSendingVerification}
            className="button-outline px-4 py-2 text-sm"
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
  );

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
      await sendSkillsetEmailVerification(captchaToken || undefined);
      setVerificationMessage(t("onboarding.verificationSent"));
    } catch {
      setError(t("onboarding.verificationSendError"));
    } finally {
      // Turnstile tokens are single-use — refresh for the next attempt.
      if (isCaptchaEnabled) setCaptchaResetSignal((n) => n + 1);
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

  // Without the profile read, the person stays on step 0 with the read notice and
  // "Try again".
  function holdUntilProfileRead() {
    const message = t("onboarding.errorProfileLoadRetry");
    setStep(0);
    setError(message);
    setReadError(message);
  }

  function handleNext() {
    setError("");

    // Profile never read successfully: nobody fills in steps 1 and 2 before
    // a read that works (a successful "Try again" would rewrite them
    // with the saved profile, and finishing would write over it). With the profile
    // read, "Continue" stays the same.
    if (step === 0 && !answersLoaded) {
      holdUntilProfileRead();
      return;
    }

    if (step === 0 && selectedPathIncludesTeacher && !payoutCountryAnswered) {
      setError(t("onboarding.payoutCountryRequired"));
      return;
    }

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

    // Profile never read successfully: finishing would write over the saved
    // profile (roles, name, @, bio, timezone and goals) with what is on screen.
    // Goes back to step 0 with the read notice and "Try again". A new person does not
    // get here: any read that responds, even empty (no row or with the
    // row just created), sets answersLoaded before the screen appears. Together with the
    // "Continue" lock above, this is the second lock.
    if (!answersLoaded) {
      holdUntilProfileRead();
      return;
    }

    if (!uid || !selectedPath) {
      setError(t("onboarding.errorSessionNotReady"));
      return;
    }

    // The simplified activation preserves profile/goals; it only adds the declared
    // country to the existing email and terms gates.
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

    if (selectedPathIncludesTeacher && !payoutCountryAnswered) {
      setStep(0);
      setError(t("onboarding.payoutCountryRequired"));
      return;
    }

    // The "Activate teaching" button is no longer grayed out for lack of acceptance:
    // the click explains what is missing, instead of doing nothing.
    if (selectedPathIncludesTeacher && !teacherTermsAccepted) {
      setStep(0);
      setError(t("onboarding.errorAcceptTerms"));
      return;
    }

    setIsSaving(true);

    try {
      // Without the profile read, writing only the country would erase the other answers.
      // The lock at the top already stops this case; this one is the second lock.
      if (selectedPathIncludesTeacher && answersLoaded) {
        await updateOnboardingAnswers({
          uid,
          answers: { ...onboardingAnswers, payoutCountry },
        });
      }
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

      await refreshUser();
      // A new teacher who chose a plan on /pricing goes straight to its card
      // screen; without that choice, the workspace as before.
      router.push(
        (selectedPathIncludesTeacher && planCheckout) || selectedPath.href,
      );
    } catch {
      setError(t("onboarding.errorFinish"));
      setIsSaving(false);
    }
  }

  // The short activation takes over the page title and description: the default of
  // /onboarding ("Set up your SkillsetMind profile.") talks about building a profile
  // that it does not build. Decided by the loaded profile, not by the address: the
  // 3-step signup also opens with ?path=teacher. Without the email card
  // (already verified), "verify your email" would be a request with no button.
  const streamlinedDescriptionKey = askEmailVerification
    ? "onboarding.streamlinedDesc"
    : "onboarding.streamlinedDescVerified";
  const headingOnPage = usePageHeading(
    !isBootstrapping && streamlinedTeacherActivation
      ? { titleKey: "onboarding.streamlinedTitle", descriptionKey: streamlinedDescriptionKey }
      : null,
  );

  // Only a profile READ failure gets "Try again"; the other errors on this
  // screen (validate, verify email, activate) keep the usual notice.
  const errorAlert = showReadError ? (
    <LoadErrorAlert onRetry={retryLoad} focusRef={pageHeadingRef}>
      {error}
    </LoadErrorAlert>
  ) : error ? (
    <InlineAlert tone="error">
      {error}
    </InlineAlert>
  ) : null;

  if (isBootstrapping) {
    // The same spinner and the same sentence as the /onboarding fallback right
    // before it: before, there were two waits in a row with different looks and text.
    return <SkillsetSpinner fullscreen={false} title={t("authFlow.loading.title")} />;
  }

  if (streamlinedTeacherActivation) {
    // Why "Activate teaching" is grayed out. The lock stays the same; it only
    // gets stated, in the same sentence the click would show.
    const activateBlockedReason = !emailVerified
      ? t("onboarding.errorVerifyEmail")
      : !payoutCountryAnswered
        ? t("onboarding.payoutCountryRequired")
        : "";

    return (
      <div ref={rootRef} className="mt-6 grid gap-5">
        {/* The title and description live at the top of the page (the card that
            repeated them is gone); standalone, without the page, the screen shows the description. */}
        {headingOnPage ? null : (
          <p className="text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(streamlinedDescriptionKey)}
          </p>
        )}
        {askPayoutCountry ? payoutCountryField : null}

        {askEmailVerification ? emailVerificationCard : null}

        <label className="flex gap-3 rounded-lg border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
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
              className="font-semibold text-[var(--color-primary)]! underline-offset-4 hover:underline"
              target="_blank"
            >
              {t("onboarding.teacherTermsLink")}
            </Link>{" "}
            {t("onboarding.teacherTermsSuffix")}
          </span>
        </label>
        <p className="text-xs leading-5 text-[var(--color-ink-soft)]">{streamlinedProfileNotice}</p>

        {errorAlert}

        {/* Only one strong button ("Activate teaching"); skipping becomes discreet text,
            in the same place and with the same destination. */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/learn")}
            disabled={isSaving}
            className="min-h-11 rounded-md px-2 text-sm font-semibold text-[var(--color-ink-soft)] underline-offset-4 hover:text-[var(--color-primary)] hover:underline disabled:opacity-60"
          >
            {t("onboarding.skipForNow")}
          </button>
          <button
            type="button"
            onClick={handleFinish}
            disabled={isSaving || !emailVerified || !payoutCountryAnswered}
            aria-describedby={activateBlockedReason ? "activation-blocked-reason" : undefined}
            className="button-solid button-lg"
          >
            <BusyLabel busy={isSaving} idle={t("onboarding.activateTeaching")} busyText={t("onboarding.activating")} />
          </button>
        </div>
        {activateBlockedReason ? (
          <p
            id="activation-blocked-reason"
            className="-mt-2 text-sm leading-6 text-[var(--color-ink-soft)]"
          >
            {activateBlockedReason}
          </p>
        ) : null}
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
    <div ref={rootRef} className="mt-5 grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="uppercase tracking-[0.16em] text-[var(--color-primary)]">
            {stepLabels[step]}
          </span>
          <span className="text-[var(--color-ink-soft)]">{stepCounter}</span>
        </div>
        <ProgressBar value={Math.round(((step + 1) / stepLabels.length) * 100)} label={stepCounter} />
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
                className={`rounded-lg border p-4 text-left transition-colors ${
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
              {payoutCountryField}
              {emailVerificationCard}

              <label className="flex gap-3 rounded-lg border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
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
                    className="font-semibold text-[var(--color-primary)]! underline-offset-4 hover:underline"
                    target="_blank"
                  >
                    {t("onboarding.teacherTermsLink")}
                  </Link>{" "}
                  {t("onboarding.teacherTermsSuffix")}
                </span>
              </label>
              <p className="text-xs leading-5 text-[var(--color-ink-soft)]">{publicProfileNotice}</p>
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
                className="field-input"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
              {t("onboarding.username")}
              <div className="flex overflow-hidden rounded-md border-[1.5px] border-[var(--color-field-border)] bg-[var(--color-surface-soft)] focus-within:border-[var(--color-primary)] focus-within:bg-[var(--color-surface)]">
                <span className="grid place-items-center border-r border-[var(--color-line)] px-3 text-sm font-semibold text-[var(--color-ink-soft)]">
                  @
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(normalizeUsername(event.target.value))}
                  placeholder={t("onboarding.usernamePlaceholder")}
                  maxLength={32}
                  className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm font-normal outline-none"
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
              className="field-input resize-none"
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
              className="field-input"
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
                className={`rounded-lg border p-3 text-left transition-colors ${
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

      {errorAlert}

      <div className="flex flex-wrap gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((currentStep) => Math.max(currentStep - 1, 0))}
            disabled={isSaving}
            className="button-outline px-4 py-2.5 text-sm"
          >
            {t("onboarding.back")}
          </button>
        ) : null}
        {step < 2 ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={isSaving}
            className="button-solid px-4 py-2.5 text-sm"
          >
            {t("onboarding.continue")}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinish}
            disabled={isSaving}
            className="button-solid px-4 py-2.5 text-sm"
          >
            <BusyLabel busy={isSaving} idle={t("onboarding.finishSetup")} busyText={t("onboarding.saving")} />
          </button>
        )}
      </div>
    </div>
  );
}
