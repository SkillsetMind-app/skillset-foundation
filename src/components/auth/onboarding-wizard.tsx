"use client";

import { Check, GraduationCap, Presentation } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { OnboardingProgress } from "@/components/auth/onboarding-progress";
import {
  ONBOARDING_QUESTION_TITLE_ID,
  OnboardingQuestion,
} from "@/components/auth/onboarding-question";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { BusyLabel } from "@/components/ui/busy-label";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { skillsetCourseCategories } from "@/domain/teacher-course";
import type { OnboardingAnswers } from "@/domain/user-profile";
import {
  getAuthPathIntentFromSearchParams,
  getAuthRoute,
  getPlanCheckoutReturnTo,
  getSafeReturnTo,
  getTeacherOnboardingRoute,
} from "@/lib/auth/routing";
import { isValidPhoneNumber } from "@/domain/user-profile";
import { validateDisplayName } from "@/lib/auth/profile-validation";
import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";
import { CONNECT_PAYOUT_COUNTRIES, isConnectPayoutCountry } from "@/lib/payments/connect-countries";
import { scrollBehavior } from "@/lib/ui/scroll-behavior";
import {
  getUserProfile,
  updateOnboardingAnswers,
  updateUserIdentity,
} from "@/lib/data/user-profiles";

type QuestionId =
  | "profile"
  | "path"
  | "profession"
  | "sourceOfDiscovery"
  | "alreadySold"
  | "payoutCountry"
  | "monthlyRevenue"
  | "primaryGoal"
  | "instagramHandle"
  | "audienceSize";

type QuestionDefinition = {
  id: QuestionId;
  number: number;
  required: boolean;
};

// SkillsetMind's launch audience is coaches and personal-development
// professionals, so the teacher branch leads with practice identity. Regulated
// clinical titles are deliberately absent — see src/domain/teacher-course.ts.
const professionOptions = [
  "Coach",
  "Facilitator",
  "Trainer or educator",
  "Mentor or consultant",
  "Other",
];

const sourceOptions = [
  "Instagram",
  "YouTube",
  "LinkedIn",
  "A friend or colleague",
  "Search engine",
  "Podcast",
  "Other",
];

const revenueOptions = [
  "$0 - $1,000",
  "$1,000 - $5,000",
  "$5,000 - $20,000",
  "$20,000 - $100,000",
  "$100,000+",
  "I'd rather not say",
];

const categoryOptions = [...skillsetCourseCategories];

const audienceOptions = [
  "Less than 1,000 followers",
  "1,000 - 10,000 followers",
  "10,000 - 100,000 followers",
  "100,000+ followers",
  "I'm building it now",
];

// Persisted values stay unchanged; only their labels follow the current locale.
const optionKeys: Record<string, string> = {
  Coach: "coach",
  Facilitator: "facilitator",
  "Trainer or educator": "educator",
  "Mentor or consultant": "mentor",
  Other: "other",
  "A friend or colleague": "friend",
  "Search engine": "search",
  Podcast: "podcast",
  "I'd rather not say": "privateRevenue",
  "Less than 1,000 followers": "audienceSmall",
  "1,000 - 10,000 followers": "audienceMedium",
  "10,000 - 100,000 followers": "audienceLarge",
  "100,000+ followers": "audienceLargest",
  "I'm building it now": "audienceNew",
};

// Steps and completion recap use the same keys, never translated answer values.
const pathLabels: Record<"student" | "teacher", string> = {
  student: "authFlow.onboarding.studentPath",
  teacher: "authFlow.onboarding.teacherPath",
};

const alreadySoldLabels: Record<"yes" | "no", string> = {
  yes: "authFlow.onboarding.alreadySelling",
  no: "authFlow.onboarding.notSellingYet",
};

// The "You're all set" screen is one per page: fixed ids, like the question title's.
const DONE_TITLE_ID = "onboarding-done-title";
const DONE_DESCRIPTION_ID = "onboarding-done-description";

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Predis-style split flow (product decision 2026-07-02): teachers get the
// full qualification interview (profession → category → monetization →
// audience → Instagram) because that data drives review, personalization,
// and outreach; students answer the minimum (interest + discovery source).
// Follow-ups past the required core are skippable, so friction stays low.
//
// `pathKnown`: the role was already chosen at signup (?path=) or saved before —
// asking "how will you use it" again was the same question twice in a row.
// Decided once on load, never from the answer given here: otherwise the
// question would vanish from the list the moment it was answered. "Back" until
// it brings it back (goBack).
//
// `hasReturnTo`: the learner has somewhere to go back to (e.g. the checkout of the course they were about to
// buy). Then the interest becomes optional, to go on and pay without answering.
// Only the learner branch reads this; the teacher one does not change.
export function getVisibleQuestions(
  answers: OnboardingAnswers,
  pathKnown = false,
  hasReturnTo = false,
): QuestionDefinition[] {
  const isTeacher = answers.path === "teacher";

  // "profile" (name + phone) comes BEFORE everything, for both paths: it is the
  // first step after confirming the email — before getting access to the account,
  // the person introduces themselves. The phone was never asked for anywhere.
  const ids: { id: QuestionId; required: boolean }[] = isTeacher
    ? [
        { id: "profile", required: true },
        { id: "path", required: true },
        { id: "profession", required: true },
        { id: "primaryGoal", required: true },
        { id: "alreadySold", required: true },
        { id: "payoutCountry", required: true },
        ...(answers.alreadySold === "yes"
          ? [{ id: "monthlyRevenue" as const, required: false }]
          : []),
        { id: "audienceSize", required: false },
        { id: "sourceOfDiscovery", required: false },
        { id: "instagramHandle", required: false },
      ]
    : [
        { id: "profile", required: true },
        { id: "path", required: true },
        { id: "primaryGoal", required: !hasReturnTo },
        { id: "sourceOfDiscovery", required: false },
      ];

  return ids
    .filter((question) => !(pathKnown && question.id === "path"))
    .map((question, index) => ({ ...question, number: index + 1 }));
}

function isAnswered(question: QuestionDefinition, answers: OnboardingAnswers) {
  if (!question.required) {
    return true;
  }

  // The profile lives in the user columns (display_name, phone_number), not
  // in the answers; the `profileConfirmed` mark is what says "already been through here"
  // — including when the person returns to /welcome days later.
  if (question.id === "profile") {
    return Boolean(answers.profileConfirmed);
  }

  if (question.id === "payoutCountry") {
    return answers.payoutCountry === "other" || isConnectPayoutCountry(answers.payoutCountry);
  }

  const value = answers[question.id];

  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function getFirstIncompleteIndex(questions: QuestionDefinition[], answers: OnboardingAnswers) {
  const incompleteIndex = questions.findIndex((question) => !isAnswered(question, answers));
  return incompleteIndex === -1 ? Math.max(questions.length - 1, 0) : incompleteIndex;
}

function firstName(displayName: string | null | undefined, email: string | null | undefined) {
  const source = displayName?.trim() || email?.split("@")[0] || "";
  return source.split(/\s+/)[0] || "";
}

function compactAnswers(input: OnboardingAnswers): OnboardingAnswers {
  const output: OnboardingAnswers = {};

  if (input.path) {
    output.path = input.path;
  }

  if (input.payoutCountry === "other" || isConnectPayoutCountry(input.payoutCountry)) {
    output.payoutCountry = input.payoutCountry;
  }

  if (input.profession) {
    output.profession = input.profession;
  }

  if (input.sourceOfDiscovery) {
    output.sourceOfDiscovery = input.sourceOfDiscovery;
  }

  if (input.alreadySold) {
    output.alreadySold = input.alreadySold;
  }

  if (input.monthlyRevenue) {
    output.monthlyRevenue = input.monthlyRevenue;
  }

  if (input.primaryGoal) {
    output.primaryGoal = input.primaryGoal;
  }

  if (input.instagramHandle) {
    output.instagramHandle = input.instagramHandle;
  }

  if (input.audienceSize) {
    output.audienceSize = input.audienceSize;
  }

  if (input.profileConfirmed) {
    output.profileConfirmed = true;
  }

  return output;
}

export function OnboardingWizard() {
  const { locale, t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, user } = useAuth();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  // The course the person came from, if any. It goes through the same filter as the
  // login: only an internal path, never a URL on another domain.
  const returnTo = useMemo(() => getSafeReturnTo(searchParams), [searchParams]);
  // The /pricing plan does not count: the learner who arrives with it ends on /learn,
  // so has nowhere to go back to and the interest stays required.
  const hasReturnTo = Boolean(returnTo) && !getPlanCheckoutReturnTo(returnTo);
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => ({
    ...(pathIntent ? { path: pathIntent } : {}),
  }));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pathKnown, setPathKnown] = useState(false);
  // The profile step: the name comes prefilled from signup; the phone is new.
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  // Each "Try again" of the entry read adds 1 and runs the same read again.
  const [loadAttempt, setLoadAttempt] = useState(0);
  // "Try again" vanishes together with the screen (it becomes the wait) and focus fell on
  // <body>; when the interview comes back, focus goes to the question title.
  const refocusAfterLoad = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  // Destination at the end of the interview; filled in = the "You're all set" screen.
  const [doneHref, setDoneHref] = useState<string | null>(null);
  const isComplete = doneHref !== null;
  const leftRef = useRef(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");

  // Left the screen (e.g. browser Back during the pause): the pause still
  // running does not pull the person forward. The reset in setup covers StrictMode,
  // which unmounts and remounts the effect once in development.
  useEffect(() => {
    leftRef.current = false;
    return () => {
      leftRef.current = true;
    };
  }, []);

  // The "You're all set" screen arrives with focus on "Continue": Enter works and
  // the screen reader reads the title and the sentence through the button's aria-describedby.
  useEffect(() => {
    if (isComplete) {
      continueRef.current?.focus();
    }
  }, [isComplete]);

  const questions = useMemo(
    () => getVisibleQuestions(answers, pathKnown, hasReturnTo),
    [answers, pathKnown, hasReturnTo],
  );
  const activeQuestion = questions[Math.min(currentIndex, questions.length - 1)];

  function optionLabel(value: string) {
    return Object.hasOwn(optionKeys, value)
      ? t(`authFlow.onboarding.options.${optionKeys[value]}`)
      : getCourseCategoryLabel(value, t);
  }

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(getAuthRoute("signin", pathIntent, returnTo));
      return;
    }

    if (status !== "authenticated" || !user) {
      return;
    }

    let mounted = true;

    getUserProfile(user.uid)
      .then((profile) => {
        if (!mounted) {
          return;
        }

        const savedAnswers: OnboardingAnswers = {
          ...(profile?.onboardingAnswers ?? {}),
          ...(pathIntent && !profile?.onboardingAnswers?.path
            ? { path: pathIntent }
            : {}),
        };
        const knownPath = Boolean(savedAnswers.path);
        const nextQuestions = getVisibleQuestions(savedAnswers, knownPath, hasReturnTo);

        setPathKnown(knownPath);
        setAnswers(savedAnswers);
        setProfileName(profile?.displayName ?? user.displayName ?? "");
        setProfilePhone(profile?.phoneNumber ?? "");
        setCurrentIndex(getFirstIncompleteIndex(nextQuestions, savedAnswers));
      })
      .catch(() => {
        if (mounted) {
          setError("authFlow.onboarding.loadError");
        }
      })
      .finally(() => {
        if (mounted) {
          setIsBootstrapping(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [hasReturnTo, pathIntent, returnTo, router, status, user, loadAttempt]);

  // The read of the saved answers failed on arrival. "Try again" goes back to the
  // arrival wait and repeats the SAME read, once: read only, nothing is
  // written. The wait also prevents answering while the read is running.
  function retryLoad() {
    refocusAfterLoad.current = true;
    setError("");
    setIsBootstrapping(true);
    setLoadAttempt((attempt) => attempt + 1);
  }

  // Layout effect: the new listener enters together with the screen it serves. With
  // useEffect it entered after the paint; the field already showed and the first
  // Enter fell on the previous listener, which still saw the "loading" screen.
  useLayoutEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      // During the arrival wait (and the "Try again" one) the screen does not yet have the
      // saved answers: an Enter there would write the old state over them.
      if (isSaving || isComplete || isBootstrapping) {
        return;
      }

      // No global Esc: it used to go back a question from anywhere on the screen, and
      // "Back" is already a button.
      if (event.key === "Enter") {
        const target = event.target as HTMLElement | null;

        // Enter on a button or link belongs to the button itself (check the option, go back,
        // skip). Before, the shortcut swallowed the click and tried to move forward.
        if (["TEXTAREA", "SELECT", "BUTTON", "A"].includes(target?.tagName ?? "")) {
          return;
        }

        event.preventDefault();
        void handleContinue();
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  // Changing the question remounts the screen and the focused button vanishes: focus fell on
  // <body> and nothing announced the new question. Takes focus to its title, from
  // the second question seen on (on arrival at the page focus stays where
  // the browser put it).
  const activeQuestionId = activeQuestion?.id ?? null;
  const shownQuestionId = useRef<QuestionId | null>(null);
  useEffect(() => {
    if (isBootstrapping || isComplete || !activeQuestionId) {
      return;
    }
    if (refocusAfterLoad.current || (shownQuestionId.current && shownQuestionId.current !== activeQuestionId)) {
      document.getElementById(ONBOARDING_QUESTION_TITLE_ID)?.focus();
    }
    refocusAfterLoad.current = false;
    shownQuestionId.current = activeQuestionId;
  }, [activeQuestionId, isBootstrapping, isComplete]);

  async function persistAnswers(nextAnswers: OnboardingAnswers, completed = false) {
    if (!user) {
      throw new Error("No authenticated user.");
    }

    await updateOnboardingAnswers({
      uid: user.uid,
      answers: compactAnswers(nextAnswers),
      path: nextAnswers.path,
      completed,
    });
  }

  async function updateAnswer(nextAnswers: OnboardingAnswers, autoAdvance = false) {
    const cleanedAnswers = compactAnswers(nextAnswers);
    // The question where the answer was given. Two quick taps on the same
    // option (or Enter twice) used to advance twice and skip the next
    // required question; only whoever is still on this question advances.
    const from = currentIndex;

    setError("");
    setAnswers(cleanedAnswers);

    try {
      await persistAnswers(cleanedAnswers);

      if (autoAdvance) {
        await wait(240);
        advance(cleanedAnswers, from);
      }
    } catch {
      setError("authFlow.onboarding.answerSaveError");
    }
  }

  // Going back to where the role was skipped brings the step back, already checked: whoever
  // arrived through a wrong ?path= can switch. The question comes back exactly at the
  // index where it is, so the current step becomes it and the numbering stays right.
  function goBack() {
    const pathIndex = getVisibleQuestions(answers, false, hasReturnTo).findIndex(
      (question) => question.id === "path",
    );
    if (pathKnown && currentIndex === pathIndex) {
      setPathKnown(false);
      return;
    }
    setCurrentIndex((index) => Math.max(index - 1, 0));
  }

  function advance(nextAnswers = answers, from = currentIndex) {
    const nextQuestions = getVisibleQuestions(nextAnswers, pathKnown, hasReturnTo);
    setCurrentIndex((index) =>
      index === from ? Math.min(index + 1, nextQuestions.length - 1) : index,
    );
  }

  function validateCurrentQuestion() {
    if (!activeQuestion) {
      return "";
    }

    if (!isAnswered(activeQuestion, answers)) {
      return "authFlow.onboarding.answerRequired";
    }

    if (activeQuestion.id === "instagramHandle" && answers.instagramHandle) {
      const validHandle = /^[a-zA-Z0-9_.]{1,30}$/.test(answers.instagramHandle);

      if (!validHandle) {
        return "authFlow.onboarding.invalidHandle";
      }
    }

    return "";
  }

  // The path usually already comes from signup (?path=); without it,
  // treat as a learner (the least demanding).
  const phoneRequired = answers.path === "teacher";

  // The profile step writes to the user columns (not the answers) and only
  // then marks `profileConfirmed` and advances. Validation here, not in
  // validateCurrentQuestion: name and phone live in their own state.
  async function saveProfileAndContinue() {
    if (!user) {
      router.replace(getAuthRoute("signin", pathIntent, returnTo));
      return;
    }

    const nameError = validateDisplayName(profileName);
    if (nameError) {
      setError("authFlow.onboarding.invalidName");
      return;
    }
    // Phone: required for whoever is going to SELL (support, payments,
    // verification); optional for the learner — asking is fine, demanding is friction.
    // When filled in, it has to be a real number.
    const phone = profilePhone.trim();
    if (phone ? !isValidPhoneNumber(phone) : phoneRequired) {
      setError("authFlow.onboarding.invalidPhone");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await updateUserIdentity(user.uid, {
        displayName: profileName.trim(),
        phoneNumber: phone || null,
      });
      await updateAnswer({ ...answers, profileConfirmed: true }, true);
    } catch {
      setError("authFlow.onboarding.profileSaveError");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleContinue() {
    if (activeQuestion?.id === "profile") {
      await saveProfileAndContinue();
      return;
    }

    const validationError = validateCurrentQuestion();

    if (validationError) {
      setError(validationError);
      return;
    }

    if (activeQuestion?.id === "payoutCountry") {
      setIsSaving(true);
      try {
        await persistAnswers(answers);
        setError("");
        advance();
      } catch {
        setError("authFlow.onboarding.answerSaveError");
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (currentIndex >= questions.length - 1) {
      await finishOnboarding();
      return;
    }

    advance();
  }

  async function handleSkip() {
    if (!activeQuestion || activeQuestion.required) {
      return;
    }

    await updateAnswer({ ...answers, [activeQuestion.id]: undefined }, true);
  }

  async function finishOnboarding() {
    if (!user) {
      router.replace(getAuthRoute("signin", pathIntent, returnTo));
      return;
    }

    const validationError = validateCurrentQuestion();

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await persistAnswers(answers, true);
      // End of the deep link line: whoever got here coming from a course goes back
      // to IT, not to the dashboard. The teacher is the exception — /onboarding is
      // a required account step, not a destination that can be swapped. Only the
      // plan chosen on /pricing goes with them, to open the card screen at the end.
      // A plan belongs to those who teach: on the learner path that screen does not open.
      const destination =
        answers.path === "teacher"
          ? getTeacherOnboardingRoute(returnTo)
          : (getPlanCheckoutReturnTo(returnTo) ? null : returnTo) ?? "/learn";
      setDoneHref(destination);
      // It used to be 1800ms stuck on the screen, with no button. The screen's "Continue" goes
      // right away; the automatic pause stays at 1500ms for whoever reads slowly (and so
      // a late tap does not land on the next screen).
      await wait(1500);
      leaveTo(destination);
    } catch {
      setError("authFlow.onboarding.finishError");
      setIsSaving(false);
    }
  }

  // "Continue" and the automatic pause both arrive here; only the first one navigates, and
  // none after the screen was unmounted.
  function leaveTo(href: string | null) {
    if (!href || leftRef.current) {
      return;
    }
    leftRef.current = true;
    router.replace(href);
  }

  function toggleGoal(goal: string) {
    const currentGoals = answers.primaryGoal ?? [];
    const nextGoals = currentGoals.includes(goal)
      ? currentGoals.filter((item) => item !== goal)
      : [...currentGoals, goal].slice(0, 3);

    void updateAnswer({ ...answers, primaryGoal: nextGoals });
  }

  if (isBootstrapping || status === "loading") {
    // Same as the /welcome fallback right before it: a single wait.
    return <SkillsetSpinner title={t("authFlow.loading.title")} />;
  }

  if (isComplete) {
    // Recap localizes the same answer values shown by the steps. The
    // alreadySold row only shows when the teacher branch was taken.
    const recap: { label: string; value: string }[] = [];
    const name = firstName(user?.displayName, user?.email);

    if (answers.path && answers.path in pathLabels) {
      recap.push({
        label: t("authFlow.onboarding.recapPath"),
        value: t(pathLabels[answers.path as "student" | "teacher"]),
      });
    }

    if (answers.path === "teacher" && answers.profession) {
      recap.push({ label: t("authFlow.onboarding.recapWork"), value: optionLabel(answers.profession) });
    }

    if (answers.primaryGoal && answers.primaryGoal.length > 0) {
      recap.push({ label: t("authFlow.onboarding.recapInterests"), value: answers.primaryGoal.map(optionLabel).join(", ") });
    }

    if (answers.path === "teacher" && answers.alreadySold) {
      recap.push({
        label: t("authFlow.onboarding.recapSelling"),
        value: t(alreadySoldLabels[answers.alreadySold]),
      });
    }

    return (
      <main className="grid min-h-screen place-items-center bg-[var(--color-base)] px-5">
        <section className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("authFlow.onboarding.welcome")}
          </p>
          <h1 id={DONE_TITLE_ID} className="display-title mt-4 text-[38px] font-semibold leading-[1.1] text-[var(--color-primary)]">
            {name ? t("authFlow.onboarding.allSet").replace("{name}", () => name) : t("authFlow.onboarding.allSetAnonymous")}
          </h1>
          <p id={DONE_DESCRIPTION_ID} className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("authFlow.onboarding.completeDescription")}
          </p>
          {recap.length > 0 ? (
            <dl className="mx-auto mt-8 max-w-md space-y-3 rounded-lg border-[1.5px] border-[var(--color-line)] bg-white p-6 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-soft)]">
                {t("authFlow.onboarding.yourAnswers")}
              </p>
              {recap.map((row) => (
                <div
                  key={row.label}
                  className="flex items-start justify-between gap-4"
                >
                  <dt className="text-[13px] font-semibold text-[var(--color-ink-soft)]">
                    {row.label}
                  </dt>
                  <dd className="flex items-center gap-2 text-right text-sm font-semibold text-[var(--color-primary)]">
                    {row.value}
                    <Check
                      aria-hidden="true"
                      className="shrink-0 text-[var(--color-accent-fg)]"
                      size={16}
                      strokeWidth={2.4}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {/* Before, a spinner with no text and 1.8s with no control. The pause
              continues (the summary can be read); the button goes to the same destination right away. */}
          <button
            ref={continueRef}
            type="button"
            aria-describedby={`${DONE_TITLE_ID} ${DONE_DESCRIPTION_ID}`}
            onClick={() => leaveTo(doneHref)}
            className="button-solid mt-8 px-4 py-2.5 text-sm"
          >
            {t("authFlow.onboarding.continue")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="onboarding-page flex min-h-svh flex-col">
      <header className="flex items-center justify-between gap-5 px-4 py-5 sm:px-8">
        <LogoWordmark nav />
        <OnboardingProgress
          activeQuestion={activeQuestion?.number ?? 1}
          totalQuestions={questions.length}
        />
      </header>

      {/* From tablet up, question and buttons form a single block, vertically centered
          (auto margins): before, Back and Continue stayed in the corners of the screen,
          far from the question. On the phone the bar stays pinned to the
          bottom (globals.css, .onboarding-footer). */}
      <div className="grid flex-1 place-items-center px-4 py-8 sm:mt-auto sm:flex-none sm:px-5">
        {/* The key remounts the question on every change: without it React reused
            the same <section> and the animated entrance only ran the first time. */}
        {activeQuestion ? (
          <Fragment key={activeQuestion.id}>{renderQuestion(activeQuestion)}</Fragment>
        ) : null}
      </div>

      <footer className="onboarding-footer flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:mx-auto sm:mb-auto sm:w-full sm:max-w-[560px] sm:px-0 sm:pb-5 sm:pt-0">
        <button
          type="button"
          onClick={goBack}
          disabled={currentIndex === 0 || isSaving}
          className="min-h-11 rounded-md px-3 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)] disabled:pointer-events-none disabled:opacity-60 sm:px-5"
        >
          {t("authFlow.onboarding.back")}
        </button>

        <div className="ml-auto flex items-center gap-3">
          {activeQuestion && !activeQuestion.required ? (
            <button
              type="button"
              onClick={() => void handleSkip()}
              disabled={isSaving}
              className="min-h-11 px-2 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition hover:text-[var(--color-primary)] disabled:opacity-60"
            >
              {t("authFlow.onboarding.skip")}
            </button>
          ) : null}
          {/* Same primary action as the signup screens (blue, 48px). */}
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={isSaving}
            className="button-solid button-lg disabled:cursor-not-allowed"
          >
            <BusyLabel
              busy={isSaving}
              idle={t("authFlow.onboarding.continue")}
              busyText={t("authFlow.onboarding.saving")}
            />
          </button>
        </div>
      </footer>
    </main>
  );

  function renderQuestion(question: QuestionDefinition) {
    switch (question.id) {
      case "payoutCountry": {
        const regionNames = new Intl.DisplayNames(locale, { type: "region" });
        return (
          <OnboardingQuestion number={question.number} total={questions.length} title={t("onboarding.payoutCountryTitle")} lead={t("onboarding.payoutCountryHint")}>
            <label htmlFor="onboarding-payout-country" className="block text-sm font-semibold text-[var(--color-ink)]">
              {t("connectOnboarding.countryLabel")}
            </label>
            <select
              id="onboarding-payout-country"
              value={answers.payoutCountry ?? ""}
              disabled={isSaving}
              onChange={(event) => setAnswers({ ...answers, payoutCountry: event.target.value })}
              aria-describedby={answers.payoutCountry === "other" ? "onboarding-payout-warning" : undefined}
              className="field-input mt-2 w-full"
            >
              <option value="">{t("onboarding.payoutCountryPlaceholder")}</option>
              {CONNECT_PAYOUT_COUNTRIES.map((code) => ({ code, label: regionNames.of(code) ?? code }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))
                .map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
              <option value="other">{t("onboarding.payoutCountryOther")}</option>
            </select>
            {answers.payoutCountry === "other" ? (
              <p id="onboarding-payout-warning" role="status" className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                {t("onboarding.payoutCountryUnavailable")}
              </p>
            ) : null}
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
      }
      case "profile":
        return (
          <OnboardingQuestion
            number={question.number}
            total={questions.length}
            title={t("authFlow.onboarding.profileTitle")}
            lead={
              phoneRequired
                ? t("authFlow.onboarding.teacherProfileLead")
                : t("authFlow.onboarding.studentProfileLead")
            }
          >
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
                {t("authFlow.onboarding.fullName")}
                <input
                  type="text"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  autoComplete="name"
                  placeholder={t("authFlow.onboarding.namePlaceholder")}
                  className="field-input"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
                {t(phoneRequired ? "authFlow.onboarding.phone" : "authFlow.onboarding.optionalPhone")}
                <input
                  type="tel"
                  value={profilePhone}
                  onChange={(event) => setProfilePhone(event.target.value)}
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="+1 555 123 4567"
                  className="field-input"
                />
              </label>
            </div>
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
      case "path":
        return (
          <OnboardingQuestion
            number={question.number}
            total={questions.length}
            title={t("authFlow.onboarding.pathTitle")}
            lead={t("authFlow.onboarding.pathLead")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <PathCard
                icon="learn"
                selected={answers.path === "student"}
                title={t(pathLabels.student)}
                description={t("authFlow.onboarding.studentPathDescription")}
                onClick={() => void updateAnswer({ ...answers, path: "student" }, true)}
              />
              <PathCard
                icon="teach"
                selected={answers.path === "teacher"}
                title={t(pathLabels.teacher)}
                description={t("authFlow.onboarding.teacherPathDescription")}
                onClick={() => void updateAnswer({ ...answers, path: "teacher" }, true)}
              />
            </div>
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
      case "profession":
        return (
          <OnboardingQuestion
            number={question.number}
            total={questions.length}
            title={t("authFlow.onboarding.professionTitle")}
            lead={t("authFlow.onboarding.professionLead")}
          >
            <OptionGrid
              options={professionOptions}
              getLabel={optionLabel}
              selected={answers.profession ? [answers.profession] : []}
              onSelect={(option) =>
                void updateAnswer({ ...answers, profession: option }, true)
              }
            />
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
      case "sourceOfDiscovery":
        return (
          <OnboardingQuestion
            number={question.number}
            total={questions.length}
            title={t("authFlow.onboarding.discoveryTitle")}
          >
            <OptionGrid
              options={sourceOptions}
              getLabel={optionLabel}
              selected={answers.sourceOfDiscovery ? [answers.sourceOfDiscovery] : []}
              onSelect={(option) =>
                void updateAnswer({ ...answers, sourceOfDiscovery: option }, true)
              }
            />
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
      case "alreadySold":
        return (
          <OnboardingQuestion
            number={question.number}
            total={questions.length}
            title={t("authFlow.onboarding.sellingTitle")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <LargeRadio
                selected={answers.alreadySold === "yes"}
                title={t(alreadySoldLabels.yes)}
                description={t("authFlow.onboarding.alreadySellingDescription")}
                onClick={() => void updateAnswer({ ...answers, alreadySold: "yes" }, true)}
              />
              <LargeRadio
                selected={answers.alreadySold === "no"}
                title={t(alreadySoldLabels.no)}
                description={t("authFlow.onboarding.notSellingYetDescription")}
                onClick={() =>
                  void updateAnswer(
                    { ...answers, alreadySold: "no", monthlyRevenue: undefined },
                    true,
                  )
                }
              />
            </div>
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
      case "monthlyRevenue":
        return (
          <OnboardingQuestion
            number={question.number}
            total={questions.length}
            title={t("authFlow.onboarding.revenueTitle")}
            lead={t("authFlow.onboarding.revenueLead")}
          >
            <div className="grid gap-2">
              {revenueOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={answers.monthlyRevenue === option}
                  onClick={() =>
                    void updateAnswer({ ...answers, monthlyRevenue: option }, true)
                  }
                  className={[
                    "flex items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-[var(--color-primary)]",
                    choiceTone(answers.monthlyRevenue === option),
                  ].join(" ")}
                >
                  {optionLabel(option)}
                  <SelectionDot selected={answers.monthlyRevenue === option} />
                </button>
              ))}
            </div>
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
      case "primaryGoal":
        return (
          <OnboardingQuestion
            number={question.number}
            total={questions.length}
            title={
              answers.path === "teacher"
                ? t("authFlow.onboarding.teacherGoalTitle")
                : t("authFlow.onboarding.studentGoalTitle")
            }
          >
            <OptionGrid
              multi
              options={categoryOptions}
              getLabel={optionLabel}
              selected={answers.primaryGoal ?? []}
              onSelect={toggleGoal}
            />
            <p className="mt-3 text-center text-xs font-semibold text-[var(--color-ink-soft)]">
              {t("authFlow.onboarding.chooseThree")}
            </p>
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
      case "instagramHandle":
        return (
          <OnboardingQuestion
            number={question.number}
            total={questions.length}
            title={
              answers.path === "teacher"
                ? t("authFlow.onboarding.teacherInstagramTitle")
                : t("authFlow.onboarding.studentInstagramTitle")
            }
            lead={t("authFlow.onboarding.instagramLead")}
          >
            {/* The skin of .field-input on the wrapper (the "@" stays inside it),
                with the same tokens as the phone field. */}
            <div className="flex overflow-hidden rounded-md border-[1.5px] border-[var(--color-field-border)] bg-[var(--color-surface-soft)] focus-within:border-[var(--color-primary)] focus-within:bg-[var(--color-surface)]">
              <span className="grid place-items-center border-r border-[var(--color-line)] px-4 text-sm font-semibold text-[var(--color-ink-soft)]">
                @
              </span>
              <input
                value={answers.instagramHandle ?? ""}
                onChange={(event) =>
                  setAnswers({ ...answers, instagramHandle: event.target.value })
                }
                onBlur={() => void persistAnswers(answers)}
                placeholder={t("authFlow.onboarding.instagramPlaceholder")}
                className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none"
              />
            </div>
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
      case "audienceSize":
        return (
          <OnboardingQuestion
            number={question.number}
            total={questions.length}
            title={t("authFlow.onboarding.audienceTitle")}
          >
            <div className="grid gap-2">
              {audienceOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={answers.audienceSize === option}
                  onClick={() =>
                    void updateAnswer({ ...answers, audienceSize: option }, true)
                  }
                  className={[
                    "flex items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-[var(--color-primary)]",
                    choiceTone(answers.audienceSize === option),
                  ].join(" ")}
                >
                  {optionLabel(option)}
                  <SelectionDot selected={answers.audienceSize === option} />
                </button>
              ))}
            </div>
            <ErrorMessage error={error} onRetry={retryLoad} />
          </OnboardingQuestion>
        );
    }
  }
}

function PathCard({
  description,
  icon,
  onClick,
  selected,
  title,
}: {
  description: string;
  icon: "learn" | "teach";
  onClick: () => void;
  selected: boolean;
  title: string;
}) {
  const Icon = icon === "learn" ? GraduationCap : Presentation;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={["px-6 py-6", choiceTone(selected)].join(" ")}
    >
      <span className="mb-5 flex w-full items-start justify-between gap-4">
        <span
          className={[
            "grid size-12 place-items-center rounded-md text-[var(--color-primary)]",
            selected ? "bg-white" : "bg-[var(--color-surface-strong)]",
          ].join(" ")}
        >
          <Icon aria-hidden="true" size={32} strokeWidth={1.6} />
        </span>
        <SelectionDot selected={selected} />
      </span>
      {/* Manrope like the other answers: the serif stays only on the title. */}
      <span className="block text-base font-bold leading-tight text-[var(--color-primary)]">
        {title}
      </span>
      <span className="mt-3 block text-[13px] leading-6 text-[var(--color-ink-soft)]">
        {description}
      </span>
    </button>
  );
}

function LargeRadio({
  description,
  onClick,
  selected,
  title,
}: {
  description: string;
  onClick: () => void;
  selected: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={["flex items-start justify-between gap-4 p-5", choiceTone(selected)].join(" ")}
    >
      <span>
        <span className="block text-base font-bold text-[var(--color-primary)]">
          {title}
        </span>
        <span className="mt-2 block text-[13px] leading-6 text-[var(--color-ink-soft)]">
          {description}
        </span>
      </span>
      <SelectionDot selected={selected} />
    </button>
  );
}

// A single way to show "selected" on single-choice answers (cards and
// rows): before, each question had its own — solid blue, gold border, pinkish
// tone — and the recipe circle never filled. Blue border and ring, light background
// and the circle with a check. Hover only affects the one that is not selected.
function choiceTone(selected: boolean) {
  return [
    "rounded-lg border text-left transition duration-[var(--duration-base)]",
    selected
      ? "border-[var(--color-primary)] bg-[var(--color-surface-soft)] shadow-[inset_0_0_0_1px_var(--color-primary)]"
      : "border-[var(--color-line)] bg-white hover:-translate-y-0.5 hover:border-[var(--color-line-strong)] hover:shadow-[var(--shadow-soft)]",
  ].join(" ");
}

function SelectionDot({ selected }: { selected: boolean }) {
  return selected ? (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-primary)] text-white"
    >
      <Check size={12} strokeWidth={3} />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="size-5 shrink-0 rounded-full border-[1.5px] border-[var(--color-field-border)]"
    />
  );
}

function OptionGrid({
  getLabel,
  multi = false,
  onSelect,
  options,
  selected,
}: {
  getLabel: (option: string) => string;
  multi?: boolean;
  onSelect: (option: string) => void;
  options: string[];
  selected: string[];
}) {
  return (
    // The 8 topics (multi) have long names: in two columns on the phone they broke
    // into 3 lines. One column on the phone, two from tablet up.
    <div className={multi ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : "grid grid-cols-2 gap-2 sm:grid-cols-3"}>
      {options.map((option) => {
        const isSelected = selected.includes(option);

        return (
          <button
            key={option}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(option)}
            className={[
              // The light hover only applies to the unselected option: on the selected one it
              // swapped the blue background for a light one and the light text vanished.
              "rounded-md border-[1.5px] px-4 py-3 text-sm font-semibold transition",
              isSelected
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-base)]"
                : "border-[var(--color-line)] bg-white text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]",
              multi && selected.length >= 3 && !isSelected
                ? "cursor-not-allowed opacity-60"
                : "",
            ].join(" ")}
            disabled={multi && selected.length >= 3 && !isSelected}
          >
            {getLabel(option)}
          </button>
        );
      })}
    </div>
  );
}

function ErrorMessage({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // On the phone the "Continue" bar stays pinned at the bottom and the notice was born behind
  // it (or below the fold): the tap changed nothing visible. Takes the notice
  // to the middle of the screen when it appears; no animation for whoever asked for less
  // motion.
  useEffect(() => {
    if (error) {
      ref.current?.scrollIntoView?.({ block: "center", behavior: scrollBehavior() });
    }
  }, [error]);

  if (!error) {
    return null;
  }

  return (
    // InlineAlert does not forward a ref: the outer box (only with the notice inside)
    // is what scrolls into view.
    <div ref={ref} className="mt-5">
      {/* Only the read error gets "Try again". The save ones stay without it:
          repeating there is "Continue" itself, and a second button would write twice.
          Focus: this box vanishes together with the screen (it becomes the arrival wait), so
          the focusRef here holds nothing; what carries the focus is the title effect. */}
      {error === "authFlow.onboarding.loadError" ? (
        <LoadErrorAlert onRetry={onRetry} focusRef={ref} alertClassName="justify-center text-center">
          {t(error)}
        </LoadErrorAlert>
      ) : (
        <InlineAlert tone="error" className="justify-center text-center">
          {t(error)}
        </InlineAlert>
      )}
    </div>
  );
}
