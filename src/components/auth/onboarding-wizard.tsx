"use client";

import { Check, GraduationCap, Presentation } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { OnboardingProgress } from "@/components/auth/onboarding-progress";
import {
  ONBOARDING_QUESTION_TITLE_ID,
  OnboardingQuestion,
} from "@/components/auth/onboarding-question";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
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

// A tela "You're all set" e uma so por pagina: ids fixos, como o do titulo da pergunta.
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
// `pathKnown`: o papel ja foi escolhido no cadastro (?path=) ou salvo antes —
// perguntar "como vai usar" de novo era a mesma pergunta duas vezes seguidas.
// Decidido uma vez ao carregar, nunca a partir da resposta dada aqui: senao a
// pergunta sumiria da lista no instante em que fosse respondida. "Voltar" ate
// ela a traz de volta (goBack).
function getVisibleQuestions(
  answers: OnboardingAnswers,
  pathKnown = false,
): QuestionDefinition[] {
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
        { id: "primaryGoal", required: true },
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

  // O perfil mora nas colunas do usuario (display_name, phone_number), nao
  // nas respostas; a marca `profileConfirmed` e o que diz "ja passou por aqui"
  // — inclusive quando a pessoa volta ao /welcome dias depois.
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
  // O curso de onde a pessoa veio, se veio de algum. Passa pelo mesmo filtro do
  // login: so caminho interno, nunca URL de outro dominio.
  const returnTo = useMemo(() => getSafeReturnTo(searchParams), [searchParams]);
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => ({
    ...(pathIntent ? { path: pathIntent } : {}),
  }));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pathKnown, setPathKnown] = useState(false);
  // O passo de perfil: nome vem pre-preenchido do cadastro; telefone e novo.
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Destino do fim da entrevista; preenchido = a tela "You're all set".
  const [doneHref, setDoneHref] = useState<string | null>(null);
  const isComplete = doneHref !== null;
  const leftRef = useRef(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");

  // Saiu da tela (ex.: Voltar do navegador durante a pausa): a pausa que ainda
  // corre nao puxa a pessoa para frente. O reset no setup cobre o StrictMode,
  // que desmonta e remonta o efeito uma vez em desenvolvimento.
  useEffect(() => {
    leftRef.current = false;
    return () => {
      leftRef.current = true;
    };
  }, []);

  // A tela "You're all set" chega com o foco no "Continue": Enter funciona e
  // o leitor de tela le o titulo e a frase pelo aria-describedby do botao.
  useEffect(() => {
    if (isComplete) {
      continueRef.current?.focus();
    }
  }, [isComplete]);

  const questions = useMemo(
    () => getVisibleQuestions(answers, pathKnown),
    [answers, pathKnown],
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
        const nextQuestions = getVisibleQuestions(savedAnswers, knownPath);

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
  }, [pathIntent, returnTo, router, status, user]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (isSaving || isComplete) {
        return;
      }

      // Sem Esc global: ele voltava uma pergunta de qualquer lugar da tela, e
      // "Back" ja e um botao.
      if (event.key === "Enter") {
        const target = event.target as HTMLElement | null;

        // Enter num botao ou link e do proprio botao (marcar a opcao, voltar,
        // pular). Antes o atalho engolia o clique e tentava seguir em frente.
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

  // A troca de pergunta remonta a tela e o botao focado some: o foco caia no
  // <body> e nada anunciava a pergunta nova. Leva o foco ao titulo dela, a
  // partir da segunda pergunta vista (na chegada a pagina o foco fica onde
  // o navegador o pos).
  const activeQuestionId = activeQuestion?.id ?? null;
  const shownQuestionId = useRef<QuestionId | null>(null);
  useEffect(() => {
    if (isBootstrapping || isComplete || !activeQuestionId) {
      return;
    }
    if (shownQuestionId.current && shownQuestionId.current !== activeQuestionId) {
      document.getElementById(ONBOARDING_QUESTION_TITLE_ID)?.focus();
    }
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
    // A pergunta em que a resposta foi dada. Dois toques rapidos na mesma
    // opcao (ou Enter duas vezes) avancavam duas vezes e pulavam a proxima
    // pergunta obrigatoria; so avanca quem ainda esta nesta pergunta.
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

  // Voltar ate onde o papel foi pulado traz o passo de volta, ja marcado: quem
  // chegou por um ?path= errado consegue trocar. A pergunta volta exatamente no
  // indice em que esta, entao o passo atual vira ela e a numeracao segue certa.
  function goBack() {
    const pathIndex = getVisibleQuestions(answers).findIndex(
      (question) => question.id === "path",
    );
    if (pathKnown && currentIndex === pathIndex) {
      setPathKnown(false);
      return;
    }
    setCurrentIndex((index) => Math.max(index - 1, 0));
  }

  function advance(nextAnswers = answers, from = currentIndex) {
    const nextQuestions = getVisibleQuestions(nextAnswers, pathKnown);
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

  // O caminho ja vem do cadastro (?path=) na maioria dos casos; sem ele,
  // trata como aluno (o menos exigente).
  const phoneRequired = answers.path === "teacher";

  // O passo de perfil grava nas colunas do usuario (nao nas respostas) e so
  // entao marca `profileConfirmed` e avanca. Validacao aqui, nao em
  // validateCurrentQuestion: nome e telefone vivem em estado proprio.
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
    // Telefone: obrigatorio para quem vai VENDER (suporte, pagamentos,
    // verificacao); opcional para o aluno — pedir e ok, exigir e friccao.
    // Quando preenchido, tem que ser um numero de verdade.
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
      // Fim da linha do deep link: quem chegou aqui vindo de um curso volta
      // para ELE, nao para o painel. O professor e a excecao — /onboarding e
      // um passo obrigatorio da conta, nao um destino que da para trocar. So o
      // plano escolhido em /pricing segue com ele, para abrir o cartao no fim.
      // Plano e de quem ensina: no caminho de aluno essa tela nao abre.
      const destination =
        answers.path === "teacher"
          ? getTeacherOnboardingRoute(returnTo)
          : (getPlanCheckoutReturnTo(returnTo) ? null : returnTo) ?? "/learn";
      setDoneHref(destination);
      // Eram 1800ms presos na tela, sem botao. O "Continue" da tela vai na
      // hora; a pausa automatica fica em 1500ms para quem le devagar (e para
      // um toque atrasado nao cair na tela seguinte).
      await wait(1500);
      leaveTo(destination);
    } catch {
      setError("authFlow.onboarding.finishError");
      setIsSaving(false);
    }
  }

  // O "Continue" e a pausa automatica chegam aqui; so a primeira navega, e
  // nenhuma depois que a tela foi desmontada.
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
    // Igual ao fallback de /welcome que vem logo antes: uma espera só.
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
          {/* Antes um giro sem texto e 1,8s sem nenhum controle. A pausa
              continua (dá para ler o resumo); o botão leva ao mesmo destino já. */}
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

      <div className="grid flex-1 place-items-center px-4 py-8 sm:px-5">
        {/* A key remonta a pergunta a cada troca: sem ela o React reaproveitava
            a mesma <section> e a entrada animada so rodava na primeira. */}
        {activeQuestion ? (
          <Fragment key={activeQuestion.id}>{renderQuestion(activeQuestion)}</Fragment>
        ) : null}
      </div>

      <footer className="onboarding-footer flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-8 sm:py-5">
        <button
          type="button"
          onClick={goBack}
          disabled={currentIndex === 0 || isSaving}
          className="min-h-11 rounded-md px-3 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)] disabled:pointer-events-none disabled:opacity-40 sm:px-5"
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
          {/* Mesma acao principal das telas de cadastro (azul, 48px). */}
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={isSaving}
            className="button-solid button-lg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t(isSaving ? "authFlow.onboarding.saving" : "authFlow.onboarding.continue")}
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
            <ErrorMessage error={error} />
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
            <ErrorMessage error={error} />
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
            <ErrorMessage error={error} />
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
            <ErrorMessage error={error} />
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
            <ErrorMessage error={error} />
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
            <ErrorMessage error={error} />
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
            <ErrorMessage error={error} />
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
            <ErrorMessage error={error} />
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
            <div className="flex overflow-hidden rounded-md border-[1.5px] border-[var(--color-line)] bg-white focus-within:border-[var(--color-primary-light)]">
              <span className="grid place-items-center border-r border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 text-sm font-semibold text-[var(--color-ink-soft)]">
                @
              </span>
              <input
                value={answers.instagramHandle ?? ""}
                onChange={(event) =>
                  setAnswers({ ...answers, instagramHandle: event.target.value })
                }
                onBlur={() => void persistAnswers(answers)}
                placeholder={t("authFlow.onboarding.instagramPlaceholder")}
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
      {/* Manrope como as outras respostas: o serifado fica so no titulo. */}
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

// Um so jeito de mostrar "marcado" nas respostas de escolha unica (cartoes e
// linhas): antes cada pergunta tinha o seu — azul cheio, borda dourada, tom
// rosado — e o circulo da receita nunca enchia. Borda e anel azuis, fundo
// claro e o circulo com check. O hover so mexe na que nao esta marcada.
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
    // Os 8 temas (multi) tem nomes longos: em duas colunas no celular quebravam
    // em 3 linhas. Uma coluna no celular, duas a partir do tablet.
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
              // O hover claro so vale para a opcao nao marcada: na marcada ele
              // trocava o fundo azul por um claro e o texto claro sumia.
              "rounded-md border-[1.5px] px-4 py-3 text-sm font-semibold transition",
              isSelected
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-base)]"
                : "border-[var(--color-line)] bg-white text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]",
              multi && selected.length >= 3 && !isSelected
                ? "cursor-not-allowed opacity-50"
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

function ErrorMessage({ error }: { error: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLParagraphElement>(null);
  // No celular a barra do "Continue" fica presa embaixo e o aviso nascia atras
  // dela (ou abaixo da dobra): o toque nao mudava nada visivel. Leva o aviso
  // ao meio da tela quando ele aparece; sem animacao para quem pediu menos
  // movimento.
  useEffect(() => {
    if (error) {
      ref.current?.scrollIntoView?.({ block: "center", behavior: scrollBehavior() });
    }
  }, [error]);

  if (!error) {
    return null;
  }

  return (
    <p ref={ref} role="alert" className="mt-5 rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-center text-sm font-semibold text-[var(--color-danger-fg)]">
      {t(error)}
    </p>
  );
}
