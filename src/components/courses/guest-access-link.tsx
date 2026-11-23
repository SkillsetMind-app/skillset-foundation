"use client";

import { useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";

type LinkState = "waiting" | "sending" | "sent" | "pending" | "failed" | "limited";

async function requestAccessLink(): Promise<LinkState> {
  try {
    const response = await fetch("/api/payments/guest-checkout/access-link", { method: "POST" });
    if (response.ok) return "sent";
    // The paid sale has not unlocked the course yet.
    if (response.status === 409) return "pending";
    return response.status === 429 ? "limited" : "failed";
  } catch {
    return "failed";
  }
}

// Thank-you page. The sign-in link goes out from the paid sale itself (Stripe
// webhook), so this page only says where it goes and offers a resend. The
// address and course come from the server-side cookie, not from here.
export function GuestAccessLink({ maskedEmail }: { maskedEmail: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LinkState>("waiting");

  const message = t(`guestCheckout.thanks.${state}`).replace("{email}", () => maskedEmail);
  return (
    <div className="grid gap-4">
      {/* Falha: o aviso de erro da casa (ícone, fundo que segue o tema). */}
      {state === "failed" || state === "limited" ? (
        <InlineAlert tone="error">{message}</InlineAlert>
      ) : (
        <p role="status" className="info-notice">
          {message}
        </p>
      )}
      {state === "waiting" || state === "sent" ? (
        <p className="text-sm leading-6 text-[var(--color-ink-soft)]">{t("guestCheckout.thanks.checkSpam")}</p>
      ) : null}
      <button
        type="button"
        disabled={state === "sending"}
        onClick={() => {
          setState("sending");
          void requestAccessLink().then(setState);
        }}
        className="button-outline w-full justify-center px-5 py-2.5 text-sm"
      >
        {t("guestCheckout.thanks.resend")}
      </button>
    </div>
  );
}
