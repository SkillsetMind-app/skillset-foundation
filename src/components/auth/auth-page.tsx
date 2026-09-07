"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { AuthFrame } from "@/components/auth/auth-frame";
import { LoginForm } from "@/components/auth/login-form";
import { SignupForm } from "@/components/auth/signup-form";
import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  getAuthPathIntentFromSearchParams,
  getLoadingRoute,
  getSafeReturnTo,
} from "@/lib/auth/routing";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

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

  useEffect(() => {
    if (status === "loading" || entrySessionHandled.current) {
      return;
    }

    // Only resume the session present on entry. A sign-in, signup or MFA
    // completed inside the form already owns its confirmation and navigation.
    entrySessionHandled.current = true;
    if (status === "authenticated" && user?.emailVerified && !searchParams.has("error")) {
      router.replace(getLoadingRoute("welcome", pathIntent, getSafeReturnTo(searchParams)));
    }
  }, [pathIntent, router, searchParams, status, user]);

  return (
    <AuthFrame homeLabel={t("auth.page.backToHome")}>
      <h1 className="auth-title display-title">
        {isSignup ? t("auth.page.titleSignup") : t("auth.page.titleSignin")}
      </h1>
      {isSignup ? <SignupForm /> : <LoginForm />}
    </AuthFrame>
  );
}
