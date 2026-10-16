"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, InlineAlert } from "@/components/ui";
import { PaymentRequestError } from "@/lib/payments/client-fetch";
import { openTeacherStripeDashboard } from "@/lib/payments/connect";

export function StripeDashboardButton() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"setup" | "signIn" | "rateLimit" | "error" | null>(null);
  const errorId = useId();

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await openTeacherStripeDashboard();
    } catch (cause) {
      if (cause instanceof PaymentRequestError && cause.code === "connect_required") {
        setError("setup");
      } else if (cause instanceof PaymentRequestError && cause.status === 401) {
        setError("signIn");
      } else if (cause instanceof PaymentRequestError && cause.status === 429) {
        setError("rateLimit");
      } else {
        setError("error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-2">
      <Button
        variant="outline"
        onClick={open}
        aria-busy={busy}
        aria-disabled={busy}
        aria-describedby={error ? errorId : undefined}
        icon={<ExternalLink aria-hidden="true" size={16} />}
        className="w-52 max-w-full justify-self-start whitespace-normal aria-disabled:cursor-wait aria-disabled:opacity-60"
      >
        {t(busy ? "stripeDashboard.opening" : "stripeDashboard.open")}
      </Button>
      {error ? (
        <div id={errorId}>
          <InlineAlert tone="error">
            {t(`stripeDashboard.${error}`)}{" "}
            <Link
              href={error === "setup" ? "/account/payments#stripe-connect" : error === "signIn" ? "/login" : "/support"}
              className="underline underline-offset-4"
            >
              {t(error === "setup" ? "stripeDashboard.setupAction" : error === "signIn" ? "stripeDashboard.signInAction" : "stripeDashboard.support")}
            </Link>
          </InlineAlert>
        </div>
      ) : null}
    </div>
  );
}
