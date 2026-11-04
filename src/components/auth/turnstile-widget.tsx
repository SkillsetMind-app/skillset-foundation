"use client";

import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";

// Cloudflare Turnstile — env-gated bot check for the auth forms (login, signup,
// password reset). When NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset the component
// renders nothing and never reports a token, so the forms behave exactly as
// before (zero regression). When set, it renders the widget and reports the
// token to pass to Supabase auth as options.captchaToken.
//
// Unlocks Supabase's built-in CAPTCHA attack protection, which can only be
// enabled once the client sends a token. Enable order to avoid a breakage
// window: set this env in Vercel FIRST (tokens start flowing, Supabase still
// ignores them), THEN turn on CAPTCHA in the Supabase dashboard with the
// matching secret. Vanilla script (not a React wrapper dep) — a few lines beat a
// dependency.

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export const isCaptchaEnabled = Boolean(SITE_KEY);

// A blocked or hung script must not stall the promise forever.
const SCRIPT_TIMEOUT_MS = 10_000;

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Turnstile's own sizes. "normal" is 300px wide, "compact" 150px. */
export type TurnstileSize = "normal" | "compact" | "flexible";

let scriptPromise: Promise<boolean> | null = null;

// Resolves false when the script cannot load (ad blocker, network policy,
// Cloudflare outage) instead of never settling. A hung promise left the widget
// unrendered, so the token stayed "" and BOTH auth submit buttons sat disabled
// with nothing on screen saying why.
function loadTurnstile(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.turnstile) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<boolean>((resolve) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    const timer = setTimeout(() => resolve(false), SCRIPT_TIMEOUT_MS);
    const settle = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    s.onload = () => settle(true);
    s.onerror = () => settle(false);
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Renders the Turnstile challenge and reports its single-use token via onToken
 * ("" while pending/expired/errored). Bump `resetSignal` after a failed submit
 * to fetch a fresh token — Turnstile tokens are consumed once.
 *
 * `size` is optional and leaves Turnstile's default when absent (the sign-in
 * forms). It can be a function of the container's width, read once when the
 * widget renders, for cards narrower than the 300px normal widget.
 *
 * `loadErrorCopy` is the dictionary entry shown when the script cannot load;
 * the default speaks of sign-in, so other forms pass their own.
 */
export function TurnstileWidget({
  onToken,
  resetSignal = 0,
  size,
  loadErrorCopy = "authCaptcha.loadError",
}: {
  onToken: (token: string) => void;
  resetSignal?: number;
  size?: TurnstileSize | ((containerWidth: number) => TurnstileSize);
  loadErrorCopy?: string;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [challengeFailed, setChallengeFailed] = useState(false);
  // Keep the latest onToken without making it a mount-effect dep (which would
  // re-render the widget on every parent render).
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);
  // Read once, at render, like the widget itself.
  const sizeRef = useRef(size);

  useEffect(() => {
    if (!SITE_KEY) return;
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    void loadTurnstile().then((ok) => {
      if (cancelled) return;
      if (!ok || !window.turnstile) {
        setLoadFailed(true);
        return;
      }
      const chosen = typeof sizeRef.current === "function" ? sizeRef.current(el.clientWidth) : sizeRef.current;
      const failChallenge = () => {
        if (!cancelled) {
          onTokenRef.current("");
          setChallengeFailed(true);
        }
        return true;
      };
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: SITE_KEY,
        ...(chosen ? { size: chosen } : {}),
        callback: (token: string) => {
          if (cancelled) return;
          setChallengeFailed(false);
          onTokenRef.current(token);
        },
        "expired-callback": () => onTokenRef.current(""),
        "error-callback": failChallenge,
        "timeout-callback": failChallenge,
      });
    });

    return () => {
      cancelled = true;
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  const retryChallenge = useCallback(() => {
    if (window.turnstile && widgetIdRef.current) {
      setChallengeFailed(false);
      onTokenRef.current("");
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        setChallengeFailed(true);
      }
    }
  }, []);

  useEffect(() => {
    if (resetSignal > 0 && window.turnstile && widgetIdRef.current) {
      onTokenRef.current("");
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetSignal]);

  if (!SITE_KEY) return null;
  if (loadFailed) {
    return (
      <p
        role="alert"
        aria-live="assertive"
        className="rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
      >
        {t(loadErrorCopy)}
      </p>
    );
  }
  return (
    <div className="grid min-w-0 gap-3">
      {/* Manter o widget montado permite recuperacao sem apagar o formulario. */}
      <div ref={containerRef} className="flex justify-center" />
      {challengeFailed ? (
        <div className="rounded-md border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] p-3">
          <p role="alert" className="text-sm leading-5 text-[var(--color-danger-fg)]">
            {t("authCaptcha.challengeError")}
          </p>
          <button type="button" onClick={retryChallenge} className="button-outline mt-3 min-h-11 gap-2 px-3 py-2 text-sm">
            <RotateCw size={16} aria-hidden="true" />
            {t("authCaptcha.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
