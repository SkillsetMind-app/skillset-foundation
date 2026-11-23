"use client";

import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  Download,
  FileText,
  Globe,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformPageHeader } from "@/components/platform/platform-page-header";
import { InlineHelp } from "@/components/shared/inline-help";
import { StatusChip } from "@/components/shared/status-chip";
import { TeacherConnectOnboarding } from "@/components/teacher/teacher-connect-onboarding";
import { MetricCard } from "@/components/teacher/metric-card";
import { StripeDashboardButton } from "@/components/teacher/stripe-dashboard-button";
import { loadTeacherInbox } from "@/components/teacher/use-teacher-inbox-count";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import {
  summarizeCreatorWallet,
  type CurrencyAmount,
} from "@/domain/creator-ops";
import { formatOrderRef } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { getSafeReturnTo } from "@/lib/auth/routing";
import { toDate } from "@/lib/format-date";
import { formatMoney, formatMoneyBreakdown } from "@/lib/format-money";
import {
  isConnectNotEnabledError,
  refreshTeacherStripeAccountStatus,
} from "@/lib/payments/connect";

// Mostrado (como aviso calmo, nunca com cara de erro) quando a PLATAFORMA ainda
// nao habilitou o Stripe Connect — estado de configuracao do lado da
// SkillsetMind, nao falha e nada que o professor possa resolver.
const PAYOUTS_UNAVAILABLE_KEY = "teach.earnings.payoutsUnavailable";

type LedgerReadState = "loading" | "ready" | "error";

// O construtor manda ?returnTo= para a volta cair na aba Publish do curso.
// So um caminho do proprio construtor passa (getSafeReturnTo ja barra outro
// site e "//host"); qualquer outra coisa nao vira botao.
function readBuilderReturnTo(): string | null {
  const target = getSafeReturnTo(new URLSearchParams(window.location.search));
  return target?.startsWith("/teach/builder?") ? target : null;
}
const noSubscribe = () => () => {};

type Translate = (key: string) => string;
type Reloadable = { reload?: () => Promise<void> };
type Notice = { text: string; tone: "info" | "success" };

// O osso dos esqueletos da casa (surface-strong), pulsando so ele.
const bone = "animate-pulse rounded-md bg-[var(--color-surface-strong)]";

export function TeacherWalletPanel() {
  const { user } = useAuth();
  const { locale, t } = useTranslation();
  // `t` fica fora das dependencias dos efeitos: com ele la, um provider que
  // devolva funcao nova por render reinscreve tudo em laco (a suite do CI
  // ficou muda 16 min). Os efeitos guardam estado, nunca frase traduzida.
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState("");
  // As duas leituras com "Try again": o reload le de novo sem mexer no canal.
  const profileRead = useRef<Reloadable | null>(null);
  const ledgerRead = useRef<Reloadable | null>(null);
  // Ficam na tela nos dois desfechos da releitura e recebem o foco do clique.
  const connectRef = useRef<HTMLElement>(null);
  const statementsRef = useRef<HTMLElement>(null);
  const [courseTitles, setCourseTitles] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [isRefreshingStripe, setIsRefreshingStripe] = useState(false);
  // Lido no cliente: no servidor (e na hidratacao) nao ha botao de volta.
  const returnTo = useSyncExternalStore(noSubscribe, readBuilderReturnTo, () => null);
  const [ledgerEntries, setLedgerEntries] = useState<PayoutLedgerEntry[]>([]);
  const [ledgerState, setLedgerState] = useState<LedgerReadState>("loading");
  // Platform-level truth reported by the onboarding component: when Stripe
  // Connect isn't enabled on SkillsetMind's Stripe account, NO stored account id is
  // verifiable or usable — so the panel must not present one as "Connected".
  const [platformPayoutsUnavailable, setPlatformPayoutsUnavailable] =
    useState(false);
  const autoRefreshedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    // A falha do perfil e dita UMA vez, no bloco da conta, com "Try again":
    // antes saia tambem na caixa do topo, a mesma frase duas vezes.
    const subscription = subscribeToUserProfile(
      user.uid,
      (nextProfile) => {
        setProfile(nextProfile);
        setIsLoading(false);
      },
      () => {
        setIsLoading(false);
      },
    );
    profileRead.current = subscription;
    return subscription;
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    // Idem para o extrato: o aviso com "Try again" mora no proprio extrato.
    const subscription = subscribeToTeacherPayoutLedger(
      user.uid,
      (entries) => {
        setLedgerEntries(entries);
        setLedgerState("ready");
      },
      () => {
        setLedgerState("error");
      },
    );
    ledgerRead.current = subscription;
    return subscription;
  }, [user]);

  // O nome do produto em cada linha do extrato. A barra do professor ja le os
  // produtos nesta pagina (o numero da Caixa de entrada); loadTeacherInbox junta
  // pedidos simultaneos, entao a linha ganha o nome sem leitura nova. Falhou, a
  // linha fica com o codigo curto do pedido, como em Vendas.
  useEffect(() => {
    if (!user) {
      return;
    }
    let alive = true;
    loadTeacherInbox(user.uid).then(
      ({ courses }) => {
        if (alive) setCourseTitles(new Map(courses.map((course) => [course.id, course.title])));
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [user]);

  function handleOnboardingComplete() {
    void refreshStripeStatus();
  }

  // Self-truing: re-verify the stored Connect state against Stripe once per
  // visit, silently. This is what clears a stale account id (or stale
  // ready flags) server-side without requiring the teacher to find a button —
  // the profile subscription then repaints the panel from the corrected doc.
  // Errors stay silent here; the manual button and the onboarding panel below
  // surface real problems with context.
  useEffect(() => {
    if (!user || autoRefreshedRef.current) {
      return;
    }
    autoRefreshedRef.current = true;
    refreshTeacherStripeAccountStatus()
      .then((status) => {
        if (status.payoutsUnavailable) {
          setPlatformPayoutsUnavailable(true);
        }
      })
      .catch(() => {
        // Silent by design (see comment above).
      });
  }, [user]);

  async function refreshStripeStatus() {
    setError("");
    setNotice(null);
    setIsRefreshingStripe(true);

    try {
      const status = await refreshTeacherStripeAccountStatus();
      if (status.payoutsUnavailable) {
        // Platform-side Connect configuration gap — calm info, not an error.
        setPlatformPayoutsUnavailable(true);
        setNotice({ text: t(PAYOUTS_UNAVAILABLE_KEY), tone: "info" });
        return;
      }
      setPlatformPayoutsUnavailable(false);
      setNotice(
        status.chargesEnabled && status.payoutsEnabled
          ? { text: t("teach.earnings.stripeReady"), tone: "success" }
          : { text: t("teach.earnings.stripeNeedsInfo"), tone: "info" },
      );
    } catch (cause) {
      // Same platform gap reported by an older deployed function as a thrown
      // precondition — keep it calm rather than error-styled.
      if (isConnectNotEnabledError(cause)) {
        setPlatformPayoutsUnavailable(true);
        setNotice({ text: t(PAYOUTS_UNAVAILABLE_KEY), tone: "info" });
        return;
      }
      // Surface the real reason (e.g. missing STRIPE_SECRET_KEY secret or a
      // permission error) rather than a mute status string, so a stuck Connect
      // account is diagnosable instead of silently failing.
      const detail = cause instanceof Error ? cause.message.trim() : "";
      setError(
        detail
          ? t("teach.earnings.refreshErrorDetail").replace("{detail}", detail)
          : t("teach.earnings.refreshError"),
      );
    } finally {
      setIsRefreshingStripe(false);
    }
  }

  // Money figures derive from the payout LEDGER — the authoritative record for
  // BOTH one-time orders AND subscription invoices. The ledger carries the
  // server-computed gross/commission/Stripe-fee/net per entry, so these are
  // exact as a record of what was CHARGED, not a payout figure: the Stripe fee
  // is our own computation, and settlement/payout happen on Stripe's side where
  // we never see the number. Reconcile against Stripe, never the reverse.
  const financialsReady = ledgerState === "ready";
  const financials = useMemo(
    () => summarizeCreatorWallet(ledgerEntries),
    [ledgerEntries],
  );
  // Um total vazio sai como zero na moeda das outras somas quando ha uma so.
  // Com nenhuma ou varias, "0" puro: "$0.00" ao lado de "R$100.00" de
  // reembolso diria que o neto e de outra moeda.
  const currencies = new Set(
    [
      financials.grossPaidByCurrency,
      financials.platformFeeByCurrency,
      financials.stripeFeeByCurrency,
      financials.teacherNetByCurrency,
      financials.refundedByCurrency,
    ]
      .flat()
      .map((value) => value.currency),
  );
  const zeroCurrency = currencies.size === 1 ? [...currencies][0] : null;
  const money = (values: CurrencyAmount[]) =>
    ledgerState === "ready"
      ? formatMoneyBreakdown(values, locale, zeroCurrency)
      : ledgerState === "error"
        ? t("teach.earnings.unavailable")
        : "—";
  const connected = Boolean(profile?.stripeConnectedAccountId);
  // A panel must never claim "Ready" while the platform itself can't run
  // Connect — stale profile flags don't outrank the live platform signal.
  const ready =
    !platformPayoutsUnavailable
    && Boolean(
      profile?.stripeConnectChargesEnabled
      && profile?.stripeConnectPayoutsEnabled,
    );
  const statusLabel = platformPayoutsUnavailable
    ? t("teach.earnings.statusNotAvailable")
    : ready
      ? t("teach.earnings.statusReady")
      : connected
        ? t("teach.earnings.statusOnboarding")
        : t("teach.earnings.statusNotConnected");

  return (
    <section className="payouts-shell">
      {/* O cabecalho das telas irmas do estudio (30px em qualquer largura, sem
          o rotulo "Earnings" que so repetia o nome da barra). h1: a casca de
          /account/payments esconde o dela, e e este que abre a pagina. O "?"
          fica ao lado do titulo, nao dentro dele: dentro, o leitor de tela
          lia "... Help about Payout schedule" como parte do nome da pagina. */}
      <PlatformPageHeader
        title={t("teach.earnings.title")}
        titleAside={
          <InlineHelp topic={t("teach.earnings.helpTopic")} href="/help#payouts">
            {t("teach.earnings.helpBody")}
          </InlineHelp>
        }
        description={t("teach.earnings.intro")}
        actions={
          <p className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
            <Download aria-hidden="true" size={14} strokeWidth={2} />
            {t("teach.earnings.taxForms")}
          </p>
        }
      >
        {/* Uma frase, e o resto recolhido. `details` nativo: sem estado, sem
            portal, e o texto longo so ocupa a tela de quem pediu por ele. */}
        <details className="mt-2 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
          <summary className="cursor-pointer font-semibold text-[var(--color-primary)]">
            {t("teach.earnings.learnMore")}
          </summary>
          <p className="mt-2">{t("teach.earnings.details")}</p>
        </details>
      </PlatformPageHeader>

      {/* Os avisos da casa (anunciados ao leitor de tela, com icone): eram
          duas caixas feitas a mao, mudas, e a vermelha some no tema escuro. */}
      {notice ? <InlineAlert tone={notice.tone}>{notice.text}</InlineAlert> : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {/* Veio do Publish do construtor: pagamentos prontos, o caminho de volta
          para publicar e um botao, nao a barra lateral. */}
      {ready && returnTo ? (
        <Link href={returnTo} className="button-solid button-lg w-full sm:w-fit">
          {t("teach.earnings.backToCourse")}
        </Link>
      ) : null}

      <div className="payouts-grid">
        <article className="payout-balance-card">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.66)]">
            {t("teach.earnings.netEstimate")}
          </p>
          <p className="num mt-3 break-words text-3xl font-bold leading-tight text-white sm:text-4xl">
            {money(financials.teacherNetByCurrency)}
          </p>
          {/* Uma linha ao lado do numero grande. O resto (cobranca na conta do
              professor, timing de repasse da Stripe) esta no "Learn more". */}
          <p className="mt-2 text-sm text-[rgba(255,255,255,0.72)]">
            {t("teach.earnings.netHint")}
          </p>

          <div className="mt-6 grid gap-3">
            <BalanceRow
              label={t("teach.earnings.refunded")}
              value={money(financials.refundedByCurrency)}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {/* Um botao de atualizar so, o do cartao da conta: com a conta
                pronta havia dois ("Refresh Stripe" aqui e "Refresh account"
                ao lado), fazendo a mesma coisa. */}
            {ready ? null : (
              <a href="#stripe-connect" className="button-solid-light px-4 py-2.5 text-sm">
                {t("teach.earnings.completeSetup")}
              </a>
            )}
            <Link href="/teach/sales" className="button-outline-light px-4 py-2.5 text-sm">
              {t("teach.earnings.viewSales")}
            </Link>
          </div>
        </article>

        <aside className="payout-bank-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {t("teach.earnings.destination")}
              </p>
              {/* "Stripe Connect" e o nome do produto da Stripe, nao do que a
                  pessoa tem: para quem nao e tecnico, e a conta dela.
                  h2, como os outros titulos de cartao da pagina: o h1 e o do
                  topo e a navegacao por titulos pulava do 1 para o 3. */}
              <h2 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">
                {t("teach.earnings.stripeAccount")}
              </h2>
            </div>
            <StatusChip
              status={
                platformPayoutsUnavailable
                  ? "draft"
                  : ready
                    ? "active"
                    : connected
                      ? "pending"
                      : "draft"
              }
              // Perfil que nao veio nao e "Not connected": nao se sabe.
              label={isLoading
                ? t("teach.earnings.loadingStatus")
                : profile
                  ? statusLabel
                  : t("teach.earnings.unavailable")}
            />
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("teach.earnings.bankNote")}
          </p>

          {/* As linhas de estado so quando a conta existe: sem conta eram tres
              linhas ("Not created", "Pending", "Pending") repetindo o selo
              "Not connected" logo acima. */}
          {connected ? (
          <div className="mt-5 grid gap-3">
            <PayoutStatusRow
              icon={Banknote}
              label={t("teach.earnings.connectedAccount")}
              value={
                platformPayoutsUnavailable
                  // A stored id can't be verified (or used) while the platform
                  // has Connect off — presenting it as "Connected" reads like
                  // a finished setup that never happened.
                  ? t("teach.earnings.notActiveYet")
                  : profile?.stripeConnectedAccountId
                    ? maskStripeId(profile.stripeConnectedAccountId)
                    : t("teach.earnings.notCreated")
              }
            />
            {/* Read-only: Stripe fixes an account's country at creation. */}
            {connected && profile?.stripeConnectCountry ? (
              <PayoutStatusRow
                icon={Globe}
                label={t("teach.earnings.payoutCountry")}
                value={
                  new Intl.DisplayNames([locale], { type: "region" }).of(profile.stripeConnectCountry)
                    ?? profile.stripeConnectCountry
                }
              />
            ) : null}
            <PayoutStatusRow
              icon={ShieldCheck}
              label={t("teach.earnings.charges")}
              value={
                platformPayoutsUnavailable
                  ? t("teach.earnings.unavailable")
                  : profile?.stripeConnectChargesEnabled
                    ? t("teach.earnings.enabled")
                    : t("teach.earnings.pending")
              }
            />
            <PayoutStatusRow
              icon={CheckCircle2}
              label={t("teach.earnings.payouts")}
              value={
                platformPayoutsUnavailable
                  ? t("teach.earnings.unavailable")
                  : profile?.stripeConnectPayoutsEnabled
                    ? t("teach.earnings.enabled")
                    : t("teach.earnings.pending")
              }
            />
          </div>
          ) : null}

          {/* Sem conta conectada o botao so devolvia o erro "conecte o
              Stripe", com o passo de conectar logo ao lado. */}
          {connected && !platformPayoutsUnavailable ? (
            <div className="mt-5">
              <StripeDashboardButton />
            </div>
          ) : null}
          <button
            type="button"
            onClick={refreshStripeStatus}
            disabled={isRefreshingStripe}
            className="button-outline mt-5 w-full justify-center px-4 py-2.5 text-sm"
          >
            <RefreshCw aria-hidden="true" size={14} strokeWidth={2} />
            {isRefreshingStripe
              ? t("teach.earnings.refreshing")
              : t("teach.earnings.refreshAccount")}
          </button>
        </aside>
      </div>

      {/* Sao QUATRO tiles: em `md:grid-cols-3` o quarto sobrava sozinho numa
          linha. 2x2 no tablet, 4 colunas no desktop — nenhum orfao. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          unavailable={!financialsReady}
          label={t("teach.earnings.paidSales")}
          value={financialsReady
            ? String(financials.salesCount)
            : ledgerState === "error"
              ? t("teach.earnings.unavailable")
              : "—"}
        />
        <MetricCard
          unavailable={!financialsReady}
          label={t("teach.earnings.grossSales")}
          value={money(financials.grossPaidByCurrency)}
        />
        <MetricCard
          unavailable={!financialsReady}
          label={t("teach.earnings.platformFee")}
          value={money(financials.platformFeeByCurrency)}
        />
        <MetricCard
          unavailable={!financialsReady}
          label={t("teach.earnings.stripeFee")}
          value={money(financials.stripeFeeByCurrency)}
        />
      </div>

      {ready ? null : (
        <section
          ref={connectRef}
          tabIndex={-1}
          id="stripe-connect"
          className="scroll-mt-24 rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {connected
                  ? t("teach.earnings.connectContinue")
                  : t("teach.earnings.connectStart")}
              </p>
              <h2 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">
                {t("teach.earnings.connectTitle")}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
                {t("teach.earnings.connectBody")}
              </p>
            </div>
          </div>
          <div className="mt-5">
            {/* Wait for the profile: until it loads we can't tell whether to
                ask for the payout country, and the Connect routes behind the
                onboarding are what create the account. A profile that failed
                to load is just as unknown: never offer the permanent country
                choice to someone who may already have an account. */}
            {isLoading ? (
              // A forma do primeiro passo (o pais da conta e o botao), no
              // lugar de um bloco vazio em que o formulario caia depois.
              <div role="status" className="grid gap-3">
                <span className="sr-only">{t("teach.earnings.connectLoading")}</span>
                <div aria-hidden="true" className={`h-4 w-48 ${bone}`} />
                <div aria-hidden="true" className={`h-11 w-full max-w-sm ${bone}`} />
                <div aria-hidden="true" className={`h-4 w-full max-w-md ${bone}`} />
                <div aria-hidden="true" className={`mt-1 h-11 w-56 max-w-full ${bone}`} />
              </div>
            ) : !profile ? (
              <LoadErrorAlert
                focusRef={connectRef}
                onRetry={() => profileRead.current?.reload?.()}
              >
                {t("teach.earnings.profileError")}
              </LoadErrorAlert>
            ) : (
              <TeacherConnectOnboarding
                initialPayoutCountry={profile?.onboardingAnswers?.payoutCountry}
                needsCountry={!connected}
                onComplete={handleOnboardingComplete}
                onAvailabilityChange={setPlatformPayoutsUnavailable}
              />
            )}
          </div>
        </section>
      )}

      <section ref={statementsRef} tabIndex={-1} className="payout-statements">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {t("teach.earnings.statements")}
            </p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">
              {t("teach.earnings.statementsTitle")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("teach.earnings.statementsBody")}
            </p>
          </div>
          {/* Aqui havia "Export after first payout", desligado para sempre:
              nem depois do primeiro repasse ele ligava. O extrato de vendas
              exporta em Vendas. */}
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-[var(--color-line)]">
          {ledgerState === "loading" ? (
            // Linhas no formato do extrato (data, produto, situacao, valor),
            // no lugar de uma frase numa caixa que depois virava a lista.
            <div role="status" className="divide-y divide-[var(--color-line)]">
              <span className="sr-only">{t("teach.earnings.ledgerLoading")}</span>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  aria-hidden="true"
                  className="grid gap-3 bg-white p-4 md:grid-cols-[140px_1fr_150px_120px_auto] md:items-center"
                >
                  <div className={`h-3 w-20 ${bone}`} />
                  <div className="grid gap-2">
                    <div className={`h-4 w-2/3 ${bone}`} />
                    <div className={`h-3 w-1/3 ${bone}`} />
                  </div>
                  <div className={`h-6 w-24 ${bone}`} />
                  <div className={`h-4 w-16 ${bone}`} />
                </div>
              ))}
            </div>
          ) : ledgerState === "error" ? (
            <div className="bg-[var(--color-surface-soft)] p-4">
              <LoadErrorAlert
                focusRef={statementsRef}
                onRetry={() => ledgerRead.current?.reload?.()}
              >
                {t("teach.earnings.ledgerReadError")}
              </LoadErrorAlert>
            </div>
          ) : ledgerEntries.length === 0 ? (
            <div className="bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("teach.earnings.ledgerEmpty")}
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {/* O ledger é carregado em ordem CRESCENTE (o cálculo de saldo
                  depende disso), então .slice(0, 6) mostrava as seis vendas
                  MAIS ANTIGAS sob o título "recentes" — para um criador com
                  histórico, a venda de hoje nunca aparecia. Ordena por data
                  decrescente só para exibir, sem mexer na fonte. */}
              {[...ledgerEntries]
                .sort((a, b) => {
                  const left = Date.parse(String(a.createdAt ?? ""));
                  const right = Date.parse(String(b.createdAt ?? ""));
                  if (Number.isNaN(left) && Number.isNaN(right)) return 0;
                  if (Number.isNaN(left)) return 1;
                  if (Number.isNaN(right)) return -1;
                  return right - left;
                })
                .slice(0, 6)
                .map((entry) => (
                  <LedgerRow
                    key={entry.id}
                    entry={entry}
                    courseTitle={courseTitles.get(entry.courseId)}
                    t={t}
                    locale={locale}
                  />
                ))}
            </div>
          )}
        </div>
      </section>

      <section className="payout-tax-card">
        <span className="grid size-12 place-items-center rounded-md bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
          <FileText aria-hidden="true" size={22} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-[var(--color-ink)]">
            {t("teach.earnings.taxCenter")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("teach.earnings.taxCenterBody")}
          </p>
        </div>
      </section>
    </section>
  );
}

function BalanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-white/10 px-4 py-3 text-sm text-white">
      <span className="text-[rgba(255,255,255,0.72)]">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PayoutStatusRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3">
      <span className="grid size-9 place-items-center rounded-md bg-white text-[var(--color-primary)]">
        <Icon aria-hidden="true" size={16} strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
          {label}
        </span>
        <span className="mt-1 block truncate text-sm font-bold text-[var(--color-ink)]">
          {value}
        </span>
      </span>
    </div>
  );
}

// A linha diz o produto e o codigo curto do pedido ("Order #1A2B3C4D", o mesmo
// de Vendas): era "Order {uuid}" e "Payment pi_..." crus. O id do pagamento
// fica na venda, um clique adiante, com o botao de copiar.
function LedgerRow({
  entry,
  courseTitle,
  t,
  locale,
}: {
  entry: PayoutLedgerEntry;
  courseTitle?: string;
  t: Translate;
  locale: string;
}) {
  // `?? ""`: linha antiga sem pedido nao derruba a pagina do dinheiro.
  const orderRef = t("teach.earnings.orderLabel").replace("{id}", () => formatOrderRef(entry.orderId ?? ""));
  return (
    <Link
      href={`/teach/sales/${entry.orderId}`}
      className="grid gap-3 bg-white p-4 transition hover:bg-[var(--color-surface-soft)] md:grid-cols-[140px_1fr_150px_120px_auto]"
    >
      <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
        {formatDate(entry.createdAt ?? entry.releaseAt, t("teach.earnings.datePending"), locale)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-[var(--color-ink)]">
          {courseTitle || orderRef}
        </span>
        {courseTitle ? (
          <span className="num mt-1 block truncate text-xs text-[var(--color-ink-soft)]">
            {orderRef}
          </span>
        ) : null}
      </span>
      <StatusChip
        status={mapLedgerStatus(entry.status)}
        label={t(ledgerStatusKey(entry.status))}
      />
      <span className="text-right text-sm font-black text-[var(--color-primary)] md:text-left">
        {formatMoney(entry.netAmountMinor, entry.currency, locale)}
      </span>
      <ArrowRight aria-hidden="true" size={15} strokeWidth={2} className="hidden text-[var(--color-ink-muted)] md:block" />
    </Link>
  );
}

// Dinheiro e data na lingua da tela, como em Vendas. O maior numero de Ganhos
// saia "0" sem moeda para professor novo, e "USD 49.00 + EUR 10.00" depois;
// as datas saiam sempre em ingles, inclusive na tela em espanhol. O dinheiro
// (com o recuo para moeda que o Intl recusa) mora em @/lib/format-money.
function formatDate(value: unknown, pendingLabel: string, locale: string) {
  const date = toDate(value);
  if (!date) {
    return pendingLabel;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(date);
}

// Every non-refunded, non-disputed row is money the buyer already paid into the
// teacher's own Stripe balance, so none of them is "pending" on anything of
// ours. The four release-model values only ever appear on historical rows.
const LEDGER_STATUS_KEYS: Record<PayoutLedgerEntry["status"], string> = {
  settled: "teach.earnings.statusRecorded",
  in_release: "teach.earnings.statusRecorded",
  releasing: "teach.earnings.statusRecorded",
  released: "teach.earnings.statusRecorded",
  released_advance: "teach.earnings.statusRecorded",
  disputed: "teach.earnings.statusDisputed",
  refunded: "teach.earnings.statusRefunded",
  partially_refunded: "teach.earnings.statusPartiallyRefunded",
};

function ledgerStatusKey(status: PayoutLedgerEntry["status"]) {
  return LEDGER_STATUS_KEYS[status] ?? "teach.earnings.statusRecorded";
}

function mapLedgerStatus(status: PayoutLedgerEntry["status"]) {
  if (status === "refunded" || status === "partially_refunded" || status === "disputed") {
    return "refunded";
  }

  return "paid";
}

function maskStripeId(value: string) {
  if (value.length <= 8) {
    return value;
  }

  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}
