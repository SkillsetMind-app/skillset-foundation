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

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      return;
    }

    return subscribeToUserProfile(
      userId,
      (profile) => {
        setPayoutsReady(
          Boolean(
            profile?.stripeConnectChargesEnabled && profile?.stripeConnectPayoutsEnabled,
          ),
        );
      },
      () => setPayoutsReady(null),
    );
  }, [status, userId]);

  // `null` = ainda não sabemos. Não afirmamos que falta configurar antes de ler
  // o perfil: um aviso que pisca e some é pior que nenhum.
  if (dismissed || payoutsReady !== false) {
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
          className="font-bold text-[var(--color-primary)] underline underline-offset-4"
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
