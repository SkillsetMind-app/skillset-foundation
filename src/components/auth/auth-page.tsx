"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { AuthFrame } from "@/components/auth/auth-frame";
import { ConfirmGateContext } from "@/components/auth/confirm-email-gate";
import { LoginForm } from "@/components/auth/login-form";
import { SignupForm } from "@/components/auth/signup-form";
import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  getAuthPathIntentFromSearchParams,
  getEntryReturnTo,
  getLoadingRoute,
} from "@/lib/auth/routing";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type AuthMode = "signup" | "signin";

function getMode(value: string | null): AuthMode {
  return value === "signin" ? "signin" : "signup";
}

export function AuthPage() {
  const router = useRouter();
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const entrySessionHandled = useRef(false);
  const mode = getMode(searchParams.get("mode"));
  const isSignup = mode === "signup";
  // The entry intent chooses the destination without granting a role.
  const pathIntent = useMemo(
    () => getAuthPathIntentFromSearchParams(searchParams),
    [searchParams],
  );
  // O titulo diz o papel. Sem isso o papel so aparecia num eyebrow miudo e
  // quem entrava pela porta errada nao percebia.
  const modeKey = isSignup ? "Signup" : "Signin";
  const roleKey = pathIntent === "teacher" ? "Educator" : "Learner";
  // Com uma tela de estado no lugar do formulario ("confirme seu e-mail",
  // link vencido), o titulo diz o estado.
  const [stateTitleKey, setStateTitleKey] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading" || entrySessionHandled.current) {
      return;
    }

    // Only resume the session present on entry. A sign-in, signup or MFA
    // completed inside the form already owns its confirmation and navigation.
    entrySessionHandled.current = true;
    if (status === "authenticated" && user?.emailVerified && !searchParams.has("error")) {
      router.replace(getLoadingRoute("welcome", pathIntent, getEntryReturnTo(searchParams)));
    }
  }, [pathIntent, router, searchParams, status, user]);

  return (
    <AuthFrame homeLabel={t("auth.page.backToHome")}>
      <h1 className="auth-title display-title">
        {t(stateTitleKey ?? `auth.page.title${modeKey}${roleKey}`)}
      </h1>
      <ConfirmGateContext.Provider value={setStateTitleKey}>
        {isSignup ? <SignupForm /> : <LoginForm />}
      </ConfirmGateContext.Provider>
    </AuthFrame>
  );
}
