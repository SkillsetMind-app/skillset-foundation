"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

// A conta do Stripe ainda não conectada, dita nas telas de venda.
//
// Era uma faixa amarela fixa no topo de TODO o /teach (status-banner.tsx), que
// só sumia quando a conta conectasse — dias ou semanas de alerta permanente, o
// que é o mesmo que nenhum alerta. Aqui é uma linha, só onde fala de dinheiro,
// que a pessoa dispensa e não vê de novo nesta sessão. Some sozinha assim que
// cobranças e repasses estiverem ligados.

const DISMISS_KEY = "skillset:stripe-connect-notice-dismissed";

const EMPTY_SUBSCRIBE = () => () => {};

// O aviso esperava o perfil (~0,3 s depois da lista de vendas) e, ao entrar,
// empurrava a lista 117px para baixo no celular. O ultimo estado lido para esta
// pessoa fica neste aparelho: quem ainda nao conectou ve o aviso desde o
// primeiro quadro; se a conta conectou desde a ultima visita, ele sai quando o
// perfil chega (uma vez so).
const LAST_KNOWN_KEY = "skillset:stripe-connect-notice-last";

function readLastKnown(userId: string | null): boolean | null {
  if (!userId) return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(LAST_KNOWN_KEY) ?? "null");
    return saved?.uid === userId && typeof saved.ready === "boolean" ? saved.ready : null;
  } catch {
    return null;
  }
}

function saveLastKnown(userId: string, ready: boolean) {
  try {
    window.localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify({ uid: userId, ready }));
  } catch {
    // ponytail: armazenamento bloqueado: o aviso so espera o perfil, como antes.
  }
}

// Le a marca de "ja dispensei" sem set-state-in-effect (a casa proibe) e sem
// divergencia de hidratacao: o instantaneo do servidor e `true`, entao nada e
// desenhado no SSR e o valor real entra na hidratacao. Sem inscricao — a marca
// so muda por dismiss(), que ja tem estado proprio. sessionStorage lanca em
// navegador com dados de site bloqueados; um aviso dispensavel nao e motivo
// para derrubar a tela de vendas.
function useDismissedThisSession() {
  return useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    () => {
      try {
        return window.sessionStorage.getItem(DISMISS_KEY) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
}

export function StripeConnectNotice() {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const userId = user?.uid ?? null;
  const [payoutsReady, setPayoutsReady] = useState<boolean | null>(null);
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = useDismissedThisSession() || dismissedNow;
  const lastKnown = useSyncExternalStore(EMPTY_SUBSCRIBE, () => readLastKnown(userId), () => null);

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      return;
    }

    return subscribeToUserProfile(
      userId,
      (profile) => {
        const ready = Boolean(
          profile?.stripeConnectChargesEnabled && profile?.stripeConnectPayoutsEnabled,
        );
        saveLastKnown(userId, ready);
        setPayoutsReady(ready);
      },
      () => setPayoutsReady(null),
    );
  }, [status, userId]);

  // `null` = ainda não sabemos. Não afirmamos que falta configurar antes de ler
  // o perfil (nem nesta visita nem numa anterior): um aviso que pisca e some é
  // pior que nenhum.
  if (dismissed || (payoutsReady ?? lastKnown) !== false) {
    return null;
  }

  function dismiss() {
    setDismissedNow(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Sem sessionStorage o aviso volta no próximo carregamento. Aceitável.
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] pb-3 text-sm text-[var(--color-ink-soft)]"
    >
      <p className="min-w-0 flex-1">
        {t("platform.banner.connectPayouts")}{" "}
        <Link
          href="/account/payments#stripe-connect"
          className="font-bold text-[var(--color-primary)]! underline underline-offset-4"
        >
          {t("platform.banner.connectPayoutsCta")}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("platform.banner.dismissNotice")}
        className="grid size-11 shrink-0 place-items-center rounded-full text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]"
      >
        <X aria-hidden="true" size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
