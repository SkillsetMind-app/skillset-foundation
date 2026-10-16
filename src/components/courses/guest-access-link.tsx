"use client";

import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";

const errorClass =
  "rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]";

type LinkState = "sending" | "sent" | "failed" | "limited";

async function requestAccessLink(): Promise<LinkState> {
  try {
    const response = await fetch("/api/payments/guest-checkout/access-link", { method: "POST" });
    return response.ok ? "sent" : response.status === 429 ? "limited" : "failed";
  } catch {
    return "failed";
  }
}

// Thank-you page: sends the sign-in link once on arrival, then offers a resend.
// The address and course come from the server-side cookie, not from here.
export function GuestAccessLink({ maskedEmail }: { maskedEmail: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LinkState>("sending");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void requestAccessLink().then(setState);
  }, []);

  const message = t(`guestCheckout.thanks.${state}`).replace("{email}", () => maskedEmail);
  return (
    <div className="mt-6 grid gap-4">
      <p
        role={state === "failed" || state === "limited" ? "alert" : "status"}
        className={state === "failed" || state === "limited" ? errorClass : "info-notice"}
      >
        {message}
      </p>
      {state === "sent" ? (
        <p className="text-sm leading-6 text-[var(--color-ink-soft)]">{t("guestCheckout.thanks.checkSpam")}</p>
      ) : null}
      <button
        type="button"
        disabled={state === "sending"}
        onClick={() => {
          setState("sending");
          void requestAccessLink().then(setState);
        }}
        className="button-outline w-full justify-center px-5 py-2.5 text-sm disabled:opacity-60"
      >
        {t("guestCheckout.thanks.resend")}
      </button>
    </div>
  );
}
