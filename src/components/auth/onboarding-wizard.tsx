"use client";

import { Check, GraduationCap, Loader2, Presentation } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { OnboardingProgress } from "@/components/auth/onboarding-progress";
import { OnboardingQuestion } from "@/components/auth/onboarding-question";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { skillsetCourseCategories } from "@/domain/teacher-course";
import type { OnboardingAnswers } from "@/domain/user-profile";
import {
  getAuthPathIntentFromSearchParams,
  getSafeReturnTo,
} from "@/lib/auth/routing";
import { isValidPhoneNumber } from "@/domain/user-profile";
import { validateDisplayName } from "@/lib/auth/profile-validation";
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

// Single source for the two branch answers whose labels are rendered inline in
// the step JSX (path cards, alreadySold radios). Referenced by both the step
// renderers and the completion recap so the summary can never drift from what
// the user actually saw and picked. primaryGoal needs no map: its stored values
// are the category labels themselves.
const pathLabels: Record<"student" | "teacher", string> = {
  student: "I want to learn",
  teacher: "I want to teach",
};

const alreadySoldLabels: Record<"yes" | "no", string> = {
  yes: "Yes, I sell on another platform",
  no: "Not yet, this will be my first",
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Predis-style split flow (product decision 2026-07-02): teachers get the
// full qualification interview (profession → category → monetization →
// audience → Instagram) because that data drives review, personalization,
// and outreach; students answer the minimum (interest + discovery source).
// Follow-ups past the required core are skippable, so friction stays low.
function getVisibleQuestions(answers: OnboardingAnswers): QuestionDefinition[] {
  const isTeacher = answers.path === "teacher";

  // "profile" (nome + telefone) vem ANTES de tudo, para os dois caminhos: e o
  // primeiro passo depois de confirmar o e-mail — antes de ter acesso a conta,
  // a pessoa se apresenta. O telefone nunca era pedido em lugar nenhum.
  const ids: { id: QuestionId; required: boolean }[] = isTeacher
    ? [
        { id: "profile", required: true },
        { id: "path", required: true },
        { id: "profession", required: true },
        { id: "primaryGoal", required: true },
        { id: "alreadySold", required: true },
        ...(answers.alreadySold === "yes"
          ? [{ id: "monthlyRevenue" as const, required: false }]
          : []),
        { id: "audienceSize", required: false },
        { id: "instagramHandle", required: false },
      ]
    : [
        { id: "profile", required: true },
        { id: "path", required: true },
        { id: "primaryGoal", required: true },
        { id: "sourceOfDiscovery", required: false },
      ];

  return ids.map((question, index) => ({ ...question, number: index + 1 }));
}

function isAnswered(question: QuestionDefinition, answers: OnboardingAnswers) {
  if (!question.required) {
    return true;
  }

  // O perfil mora nas colunas do usuario (display_name, phone_number), nao
  // nas respostas; a marca `profileConfirmed` e o que diz "ja passou por aqui"
  // — inclusive quando a pessoa volta ao /welcome dias depois.
  if (question.id === "profile") {
    return Boolean(answers.profileConfirmed);
  }

  const value = answers[question.id];

  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function getFirstIncompleteIndex(questions: QuestionDefinition[], answers: OnboardingAnswers) {
  const incompleteIndex = questions.findIndex((question) => !isAnswered(question, answers));
  return incompleteIndex === -1 ? Math.max(questions.length - 1, 0) : incompleteIndex;
}

function firstName(displayName: string | null | undefined, email: string | null | undefined) {
  const source = displayName?.trim() || email?.split("@")[0] || "there";
  return source.split(/\s+/)[0] || "there";
}

function compactAnswers(input: OnboardingAnswers): OnboardingAnswers {
  const output: OnboardingAnswers = {};

  if (input.path) {
    output.path = input.path;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, user } = useAuth();
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  // O curso de onde a pessoa veio, se veio de algum. Passa pelo mesmo filtro do
  // login: so caminho interno, nunca URL de outro dominio.
  const returnTo = useMemo(() => getSafeReturnTo(searchParams), [searchParams]);
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => ({
    ...(pathIntent ? { path: pathIntent } : {}),
  }));
  const [currentIndex, setCurrentIndex] = useState(0);
  // O passo de perfil: nome vem pre-preenchido do cadastro; telefone e novo.
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState("");

  const questions = useMemo(() => getVisibleQuestions(answers), [answers]);
  const activeQuestion = questions[Math.min(currentIndex, questions.length - 1)];

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth?mode=signin");
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
        const nextQuestions = getVisibleQuestions(savedAnswers);

        setAnswers(savedAnswers);
        setProfileName(profile?.displayName ?? user.displayName ?? "");
        setProfilePhone(profile?.phoneNumber ?? "");
        setCurrentIndex(getFirstIncompleteIndex(nextQuestions, savedAnswers));
      })
      .catch(() => {
        if (mounted) {
          setError("Could not load saved onboarding answers. You can continue from here.");
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
  }, [pathIntent, router, status, user]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (isSaving || isComplete) {
        return;
      }

      if (event.key === "Escape") {
        setCurrentIndex((index) => Math.max(index - 1, 0));
      }

      if (event.key === "Enter") {
        const target = event.target as HTMLElement | null;

        if (target?.tagName === "TEXTAREA") {
          return;
        }

        event.preventDefault();
        void handleContinue();
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

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

    setError("");
    setAnswers(cleanedAnswers);

    try {
      await persistAnswers(cleanedAnswers);

      if (autoAdvance) {
        await wait(240);
        advance(cleanedAnswers);
      }
    } catch {
      setError("Could not save this answer. Check your connection and try again.");
    }
  }

  function advance(nextAnswers = answers) {
    const nextQuestions = getVisibleQuestions(nextAnswers);
    setCurrentIndex((index) => Math.min(index + 1, nextQuestions.length - 1));
  }

  function validateCurrentQuestion() {
    if (!activeQuestion) {
      return "";
    }

    if (!isAnswered(activeQuestion, answers)) {
      return "Answer this question before continuing.";
    }

    if (activeQuestion.id === "instagramHandle" && answers.instagramHandle) {
      const validHandle = /^[a-zA-Z0-9_.]{1,30}$/.test(answers.instagramHandle);

      if (!validHandle) {
        return "Use only letters, numbers, underscores, or periods.";
      }
    }

    return "";
  }

  // O caminho ja vem do cadastro (?path=) na maioria dos casos; sem ele,
  // trata como aluno (o menos exigente).
  const phoneRequired = answers.path === "teacher";

  // O passo de perfil grava nas colunas do usuario (nao nas respostas) e so
  // entao marca `profileConfirmed` e avanca. Validacao aqui, nao em
  // validateCurrentQuestion: nome e telefone vivem em estado proprio.
  async function saveProfileAndContinue() {
    if (!user) {
      router.replace("/auth?mode=signin");
      return;
    }

    const nameError = validateDisplayName(profileName);
    if (nameError) {
      setError("Tell us your name — at least 2 letters, so we know what to call you.");
      return;
    }
    // Telefone: obrigatorio para quem vai VENDER (suporte, pagamentos,
    // verificacao); opcional para o aluno — pedir e ok, exigir e friccao.
    // Quando preenchido, tem que ser um numero de verdade.
    const phone = profilePhone.trim();
    if (phone ? !isValidPhoneNumber(phone) : phoneRequired) {
      setError("Enter a phone number with area code, like +1 555 123 4567.");
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
      setError("Could not save your profile. Check your connection and try again.");
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
      router.replace("/auth?mode=signin");
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
      setIsComplete(true);
      await wait(1800);
      // Fim da linha do deep link: quem chegou aqui vindo de um curso volta
      // para ELE, nao para o painel. O professor e a excecao — /onboarding e
      // um passo obrigatorio da conta, nao um destino que da para trocar.
      router.replace(
        answers.path === "teacher"
          ? "/onboarding?path=teacher"
          : returnTo ?? "/learn",
      );
    } catch {
      setError("Could not finish onboarding. Please try again.");
      setIsSaving(false);
    }
  }

  function toggleGoal(goal: string) {
    const currentGoals = answers.primaryGoal ?? [];
    const nextGoals = currentGoals.includes(goal)
      ? currentGoals.filter((item) => item !== goal)
      : [...currentGoals, goal].slice(0, 3);

    void updateAnswer({ ...answers, primaryGoal: nextGoals });
  }

  if (isBootstrapping || status === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--color-base)] px-5">
        <div className="text-center">
          <div className="mx-auto mb-5 size-14 rounded-full border-[3px] border-[rgba(26,54,93,0.12)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin" />
          <p className="text-sm font-semibold text-[var(--color-primary)]">
            Preparing onboarding
          </p>
        </div>
      </main>
    );
  }

  if (isComplete) {
    // Recap echoes back what the user picked, sourced from the same `answers`
    // state and the same labels the steps rendered (pathLabels /
    // alreadySoldLabels; primaryGoal values are their own labels). The
    // alreadySold row only shows when the teacher branch was taken.
    const recap: { label: string; value: string }[] = [];

    if (answers.path && answers.path in pathLabels) {
      recap.push({
        label: "You want to",
        value: pathLabels[answers.path as "student" | "teacher"],
      });
    }

    if (answers.path === "teacher" && answers.profession) {
      recap.push({ label: "Your work", value: answers.profession });
    }

    if (answers.primaryGoal && answers.primaryGoal.length > 0) {
      recap.push({ label: "Interests", value: answers.primaryGoal.join(", ") });
    }

    if (answers.path === "teacher" && answers.alreadySold) {
      recap.push({
        label: "Selling online",
        value: alreadySoldLabels[answers.alreadySold],
      });
    }

    return (
      <main className="grid min-h-screen place-items-center bg-[var(--color-base)] px-5">
        <section className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Welcome aboard
          </p>
          <h1 className="display-title mt-4 text-[38px] font-semibold leading-[1.1] text-[var(--color-primary)]">
            You&apos;re all set, {firstName(user?.displayName, user?.email)}.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
            SkillsetMind is preparing your workspace. Taking you there now.
          </p>
          {recap.length > 0 ? (
            <dl className="mx-auto mt-8 max-w-md space-y-3 rounded-[16px] border-[1.5px] border-[var(--color-line)] bg-white p-6 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-soft)]">
                Your answers
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
          <Loader2
            aria-hidden="true"
            className="mx-auto mt-8 size-14 animate-spin text-[var(--color-accent-fg)]"
            strokeWidth={1.6}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="onboarding-page flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-5 px-6 py-5 sm:px-8">
        <LogoWordmark nav />
        <OnboardingProgress
          activeQuestion={activeQuestion?.number ?? 1}
          totalQuestions={questions.length}
        />
      </header>

      <div className="grid flex-1 place-items-center px-5 py-8">
        {activeQuestion ? renderQuestion(activeQuestion) : null}
      </div>

      <footer className="flex items-center justify-between gap-4 px-6 py-5 sm:px-8">
        <button
          type="button"
          onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
          disabled={currentIndex === 0 || isSaving}
          className="rounded-[10px] px-5 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)] disabled:pointer-events-none disabled:opacity-40"
        >
          Back
        </button>

        <div className="flex items-center gap-3">
          {activeQuestion && !activeQuestion.required ? (
            <button
              type="button"
              onClick={() => void handleSkip()}
              disabled={isSaving}
              className="px-2 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition hover:text-[var(--color-primary)] disabled:opacity-60"
            >
              Skip for now
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={isSaving}
            className="btn-cta-hero px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Continue"}
          </button>
        </div>
      </footer>
    </main>
  );

  function renderQuestion(question: QuestionDefinition) {
    switch (question.id) {
      case "profile":
        return (
          <OnboardingQuestion
            number={question.number}
            title="First, tell us who you are."
            lead={
              phoneRequired
                ? "Your name shows on your profile and certificates. Your phone stays private — we use it for payouts, verification and support."
                : "Your name shows on your profile and certificates. Your phone is optional and stays private — only for account security and support."
            }
          >
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
                Full name
                <input
                  type="text"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  autoComplete="name"
                  placeholder="Your name"
                  className="field-input"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
                {phoneRequired ? "Phone" : "Phone (optional)"}
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
            <ErrorMessage error={error} />
          </OnboardingQuestion>
        );
      case "path":
        return (
          <OnboardingQuestion
            number={question.number}
            title="How will you use SkillsetMind first?"
            lead="You can do both later. This shapes your first dashboard."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <PathCard
                icon="learn"
                selected={answers.path === "student"}
                title={pathLabels.student}
                description="Browse programs, enroll, join communities, earn credentials."
                onClick={() => void updateAnswer({ ...answers, path: "student" }, true)}
              />
              <PathCard
                icon="teach"
                selected={answers.path === "teacher"}
                title={pathLabels.teacher}
                description="Build courses, publish to the marketplace, and sell worldwide."
                onClick={() => void updateAnswer({ ...answers, path: "teacher" }, true)}
              />
            </div>
            <ErrorMessage error={error} />
          </OnboardingQuestion>
        );
      case "profession":
        return (
          <OnboardingQuestion
            number={question.number}
            title="What best describes your work?"
            lead="This helps SkillsetMind review your courses and tailor your studio."
          >
            <OptionGrid
              options={professionOptions}
              selected={answers.profession ? [answers.profession] : []}
              onSelect={(option) =>
                void updateAnswer({ ...answers, profession: option }, true)
              }
            />
            <ErrorMessage error={error} />
          </OnboardingQuestion>
        );
      case "sourceOfDiscovery":
        return (
          <OnboardingQuestion
            number={question.number}
            title="Where did you hear about SkillsetMind?"
          >
            <OptionGrid
              options={sourceOptions}
              selected={answers.sourceOfDiscovery ? [answers.sourceOfDiscovery] : []}
              onSelect={(option) =>
                void updateAnswer({ ...answers, sourceOfDiscovery: option }, true)
              }
            />
            <ErrorMessage error={error} />
          </OnboardingQuestion>
        );
      case "alreadySold":
        return (
          <OnboardingQuestion
            number={question.number}
            title="Are you already selling online?"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <LargeRadio
                selected={answers.alreadySold === "yes"}
                title={alreadySoldLabels.yes}
                description="Hotmart, Kajabi, Teachable, Eduzz, anything."
                onClick={() => void updateAnswer({ ...answers, alreadySold: "yes" }, true)}
              />
              <LargeRadio
                selected={answers.alreadySold === "no"}
                title={alreadySoldLabels.no}
                description="SkillsetMind is built for newcomers too."
                onClick={() =>
                  void updateAnswer(
                    { ...answers, alreadySold: "no", monthlyRevenue: undefined },
                    true,
                  )
                }
              />
            </div>
            <ErrorMessage error={error} />
          </OnboardingQuestion>
        );
      case "monthlyRevenue":
        return (
          <OnboardingQuestion
            number={question.number}
            title="What's your monthly revenue from online sales today?"
            lead="Honest answers help SkillsetMind calibrate features for your scale."
          >
            <div className="grid gap-2">
              {revenueOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    void updateAnswer({ ...answers, monthlyRevenue: option }, true)
                  }
                  className={[
                    "flex items-center justify-between rounded-[12px] border-[1.5px] bg-white px-5 py-4 text-left text-sm font-semibold transition hover:bg-[var(--color-surface-soft)]",
                    answers.monthlyRevenue === option
                      ? "border-[var(--color-accent-fg)] text-[var(--color-primary)]"
                      : "border-[var(--color-line)] text-[var(--color-ink)]",
                  ].join(" ")}
                >
                  {option}
                  <span className="size-5 rounded-full border border-[var(--color-line)]" />
                </button>
              ))}
            </div>
            <ErrorMessage error={error} />
          </OnboardingQuestion>
        );
      case "primaryGoal":
        return (
          <OnboardingQuestion
            number={question.number}
            title={
              answers.path === "teacher"
                ? "What kind of program will you publish?"
                : "What do you want to learn first?"
            }
          >
            <OptionGrid
              multi
              options={categoryOptions}
              selected={answers.primaryGoal ?? []}
              onSelect={toggleGoal}
            />
            <p className="mt-3 text-center text-xs font-semibold text-[var(--color-ink-soft)]">
              Choose up to three.
            </p>
            <ErrorMessage error={error} />
          </OnboardingQuestion>
        );
      case "instagramHandle":
        return (
          <OnboardingQuestion
            number={question.number}
            title={
              answers.path === "teacher"
                ? "What's your Instagram handle? SkillsetMind uses it for review and discovery."
                : "What's your Instagram handle? (optional)"
            }
            lead="Just the @ - no full URL needed."
          >
            <div className="flex overflow-hidden rounded-[10px] border-[1.5px] border-[var(--color-line)] bg-white focus-within:border-[var(--color-primary-light)]">
              <span className="grid place-items-center border-r border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 text-sm font-semibold text-[var(--color-ink-soft)]">
                @
              </span>
              <input
                value={answers.instagramHandle ?? ""}
                onChange={(event) =>
                  setAnswers({ ...answers, instagramHandle: event.target.value })
                }
                onBlur={() => void persistAnswers(answers)}
                placeholder="yourhandle"
                className="min-w-0 flex-1 px-4 py-3 text-sm outline-none"
              />
            </div>
            <ErrorMessage error={error} />
          </OnboardingQuestion>
        );
      case "audienceSize":
        return (
          <OnboardingQuestion
            number={question.number}
            title="Do you already have an audience?"
          >
            <div className="grid gap-2">
              {audienceOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    void updateAnswer({ ...answers, audienceSize: option }, true)
                  }
                  className={[
                    "rounded-[12px] border-[1.5px] bg-white px-5 py-4 text-left text-sm font-semibold transition hover:bg-[var(--color-surface-soft)]",
                    answers.audienceSize === option
                      ? "border-[var(--color-accent-fg)] text-[var(--color-primary)]"
                      : "border-[var(--color-line)] text-[var(--color-ink)]",
                  ].join(" ")}
                >
                  {option}
                </button>
              ))}
            </div>
            <ErrorMessage error={error} />
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
      onClick={onClick}
      className={[
        "group rounded-[16px] border-[1.5px] bg-white px-6 py-6 text-left transition duration-[200ms] hover:-translate-y-0.5 hover:border-[var(--color-accent-fg)] hover:shadow-[var(--shadow-strong)]",
        selected
          ? "border-[var(--color-accent-fg)] bg-[rgba(178,34,52,0.04)]"
          : "border-[var(--color-line)]",
      ].join(" ")}
    >
      <span
        className={[
          "mb-5 grid size-12 place-items-center rounded-[12px] bg-[var(--color-surface-strong)] transition",
          selected
            ? "text-[var(--color-accent-fg)]"
            : "text-[var(--color-primary)] group-hover:text-[var(--color-accent-fg)]",
        ].join(" ")}
      >
        <Icon aria-hidden="true" size={32} strokeWidth={1.6} />
      </span>
      <span className="display-title block text-[22px] font-semibold leading-none text-[var(--color-primary)]">
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
      onClick={onClick}
      className={[
        "rounded-[16px] border-[1.5px] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-accent-fg)] hover:shadow-[var(--shadow-soft)]",
        selected
          ? "border-[var(--color-accent-fg)] bg-[rgba(178,34,52,0.04)]"
          : "border-[var(--color-line)]",
      ].join(" ")}
    >
      <span className="block text-base font-bold text-[var(--color-primary)]">
        {title}
      </span>
      <span className="mt-2 block text-[13px] leading-6 text-[var(--color-ink-soft)]">
        {description}
      </span>
    </button>
  );
}

function OptionGrid({
  multi = false,
  onSelect,
  options,
  selected,
}: {
  multi?: boolean;
  onSelect: (option: string) => void;
  options: string[];
  selected: string[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((option) => {
        const isSelected = selected.includes(option);

        return (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className={[
              "rounded-[10px] border-[1.5px] px-4 py-3 text-sm font-semibold transition hover:bg-[var(--color-surface-soft)]",
              isSelected
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-base)]"
                : "border-[var(--color-line)] bg-white text-[var(--color-ink)]",
              multi && selected.length >= 3 && !isSelected
                ? "cursor-not-allowed opacity-50"
                : "",
            ].join(" ")}
            disabled={multi && selected.length >= 3 && !isSelected}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function ErrorMessage({ error }: { error: string }) {
  if (!error) {
    return null;
  }

  return (
    <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-center text-sm font-semibold text-[var(--color-danger-fg)]">
      {error}
    </p>
  );
}
