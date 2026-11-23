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
  const [step, setStep] = useState(0);
  const [uid, setUid] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<(typeof paths)[number] | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [onboardingAnswers, setOnboardingAnswers] = useState<OnboardingAnswers>({});
  const [answersLoaded, setAnswersLoaded] = useState(false);
  const [payoutCountry, setPayoutCountry] = useState("");
  const [teacherTermsAccepted, setTeacherTermsAccepted] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  // The verification resend is CAPTCHA-guarded like sign-up. Same widget as the
  // auth forms: with no site key it renders nothing and the token stays "".
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const captchaPending = isCaptchaEnabled && !captchaToken;
  const [error, setError] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // Quem ja terminou o cadastro nao repete perfil/objetivos na ativacao.
  const [streamlinedTeacherActivation, setStreamlinedTeacherActivation] =
    useState(false);
  // Na ativacao curta so aparece o que falta. Decidido uma vez, com o que veio
  // salvo: senao o campo do pais sumia no instante em que a pessoa escolhia, e
  // o cartao do e-mail some junto com o "verificado" que ela acabou de ver.
  // "Outro pais" continua aparecendo, por causa do aviso de que sem conta de
  // recebimento elegivel nao da para vender.
  const [askPayoutCountry, setAskPayoutCountry] = useState(true);
  const [askEmailVerification, setAskEmailVerification] = useState(true);
  // O "Try again" da leitura do perfil relê SÓ o perfil (getUserProfile, um
  // select), com a última pessoa que a sessão entregou. Reinscrever a sessão
  // (o contador nas dependências do efeito, como em outras telas) rodaria de
  // novo o resolveProfile do supabase-auth, que grava: claim_my_course_grants
  // e, faltando a linha, cria o perfil.
  const authedUserRef = useRef<SkillsetUser | null>(null);
  // Cada leitura ganha um número; só a mais nova escreve na tela. Uma resposta
  // atrasada (o "Try again" e uma leitura nova da sessão ao mesmo tempo) não
  // passa por cima da mais recente.
  const loadGeneration = useRef(0);
  // O aviso de leitura vive no mesmo lugar e pelo mesmo tempo que o erro de
  // hoje (sai no próximo clique que limpa o erro); só ele ganha "Try again".
  const [readError, setReadError] = useState("");
  const showReadError = error !== "" && error === readError;
  // O título da página (o h1 acima desta tela) fica à vista na espera e depois
  // dela: recebe o foco do "Try again", que some com a espera.
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

      // Quem terminou como aluno tambem ativa o ensino sem repetir o cadastro.
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
      if (afterRetry) pageHeadingRef.current?.focus();
    } catch {
      if (generation !== loadGeneration.current) return;
      const message = t("onboarding.errorProfileLoad");
      setError(message);
      setReadError(message);
    } finally {
      if (generation === loadGeneration.current) setIsBootstrapping(false);
    }
  }

  // Volta à espera da entrada (nada clicável) e relê o perfil uma vez. Só é
  // alcançável no passo 0: qualquer "Continue" limpa o aviso antes de avançar.
  function retryLoad() {
    const authedUser = authedUserRef.current;
    if (!authedUser) return;
    setError("");
    setReadError("");
    setIsBootstrapping(true);
    return loadProfile(authedUser, true);
  }

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
      authedUserRef.current = authedUser;
      setUid(authedUser.uid);
      setEmailVerified(authedUser.emailVerified);

      if (seeded) {
        return;
      }
      seeded = true;

      setDisplayName(authedUser.displayName ?? "");
      setAskEmailVerification(!authedUser.emailVerified);

      void loadProfile(authedUser);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable per locale and loadProfile only reads pathIntent and t; re-subscribing auth on locale change would drop state
  }, [pathIntent, router]);

  const safeTimezoneOptions = useMemo(() => {
    if (timezoneOptions.includes(timezone)) {
      return timezoneOptions;
    }

    return [timezone, ...timezoneOptions];
  }, [timezone]);

  const selectedPathIncludesTeacher =
    selectedPath?.roles.some((role) => role === "teacher") ?? false;
  // Aceitar os termos de professor publica o perfil: dito ao lado da caixa,
  // com o @ escolhido (ou o formato, antes de escolher).
  const publicProfileNotice = t("onboarding.publicProfileNotice").replace(
    "{handle}",
    () => normalizeUsername(username) || t("onboarding.usernamePlaceholder"),
  );
  // A ativacao curta nao tem campo de @: sem um, o texto mostrava o exemplo
  // "@your-name" como se fosse o endereco da pessoa. Diz so que e publico.
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

  // O mesmo cartao nas duas telas (ativacao curta e passo 1 do cadastro).
  const emailVerificationCard = (
    <div className="rounded-lg border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-[var(--color-ink)]">
            {t("onboarding.emailVerificationTitle")}
          </p>
          <p className="mt-1">{t("onboarding.emailVerificationDesc")}</p>
        </div>
        {/* "Required" e aviso, nao erro: as cores de aviso da plataforma (como
            na aba Seguranca), no lugar do rosa do vermelho antigo com dourado. */}
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
          {/* Os dois em contorno e 14px: o botao cheio da tela e o que ativa
              (ou continua). "I verified my email" cheio competia com ele. */}
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

  function handleNext() {
    setError("");

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

    if (!uid || !selectedPath) {
      setError(t("onboarding.errorSessionNotReady"));
      return;
    }

    // A ativacao simplificada preserva perfil/objetivos; so acrescenta o pais
    // declarado aos portoes existentes de e-mail e termos.
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

    // O botao "Activate teaching" nao fica mais apagado por falta do aceite:
    // o clique explica o que falta, em vez de nao fazer nada.
    if (selectedPathIncludesTeacher && !teacherTermsAccepted) {
      setStep(0);
      setError(t("onboarding.errorAcceptTerms"));
      return;
    }

    setIsSaving(true);

    try {
      // Sem a leitura do perfil, gravar so o pais apagaria as outras respostas.
      // O pais e so declarado: a carteira e o servidor decidem, entao a
      // ativacao segue sem ele.
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

  // A ativacao curta assume o titulo e a descricao da pagina: o padrao de
  // /onboarding ("Set up your SkillsetMind profile.") fala de montar um perfil
  // que ela nao monta. Decidido pelo perfil carregado, nao pelo endereco: o
  // cadastro de 3 passos tambem abre com ?path=teacher. Sem o cartao do e-mail
  // (ja verificado), "verifique seu e-mail" seria um pedido sem botao.
  const streamlinedDescriptionKey = askEmailVerification
    ? "onboarding.streamlinedDesc"
    : "onboarding.streamlinedDescVerified";
  const headingOnPage = usePageHeading(
    !isBootstrapping && streamlinedTeacherActivation
      ? { titleKey: "onboarding.streamlinedTitle", descriptionKey: streamlinedDescriptionKey }
      : null,
  );

  // Só a falha de LEITURA do perfil ganha "Try again"; os outros erros desta
  // tela (validar, verificar e-mail, ativar) seguem com o aviso de sempre.
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
    // O mesmo giro e a mesma frase do fallback de /onboarding, que vem logo
    // antes: antes eram duas esperas seguidas com cara e texto diferentes.
    return <SkillsetSpinner fullscreen={false} title={t("authFlow.loading.title")} />;
  }

  if (streamlinedTeacherActivation) {
    // Por que "Activate teaching" esta apagado. A trava continua a mesma; so
    // passa a ser dita, na mesma frase que o clique mostraria.
    const activateBlockedReason = !emailVerified
      ? t("onboarding.errorVerifyEmail")
      : !payoutCountryAnswered
        ? t("onboarding.payoutCountryRequired")
        : "";

    return (
      <div ref={rootRef} className="mt-6 grid gap-5">
        {/* O titulo e a descricao moram no topo da pagina (o cartao que os
            repetia saiu); solta, sem a pagina, a tela mostra a descricao. */}
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

        {/* Um botao forte so ("Activate teaching"); pular vira texto discreto,
            no mesmo lugar e com o mesmo destino. */}
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
