"use client";

import { useEffect, useRef, useState } from "react";

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
 */
export function TurnstileWidget({
  onToken,
  resetSignal = 0,
}: {
  onToken: (token: string) => void;
  resetSignal?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Keep the latest onToken without making it a mount-effect dep (which would
  // re-render the widget on every parent render).
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

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
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: SITE_KEY,
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(""),
        "error-callback": () => onTokenRef.current(""),
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

  useEffect(() => {
    if (resetSignal > 0 && window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenRef.current("");
    }
  }, [resetSignal]);

  if (!SITE_KEY) return null;
  if (loadFailed) {
    return (
      <p
        role="alert"
        aria-live="assertive"
        className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
      >
        The security check could not load, so sign-in is blocked. Turn off any ad
        blocker for this site or switch networks, then reload the page.
      </p>
    );
  }
  return <div ref={containerRef} className="flex justify-center" />;
}
