import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { AuthFrame } from "@/components/auth/auth-frame";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { getServerTranslation } from "@/lib/i18n/server";
import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery-cookie";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return { title: `${t("authFlow.recovery.pageTitle")} | SkillsetMind`, robots: { index: false, follow: false } };
}

// Landing page for the password reset email link (after /auth/callback
// exchanges the recovery code for a session). The recovery cookie set by the
// callback is what distinguishes that flow from a regular signed-in session —
// without it the form refuses to offer a no-current-password reset.
export default async function ResetPasswordPage() {
  const { t } = await getServerTranslation();
  const cookieStore = await cookies();
  const recoveryVerified = cookieStore.has(PASSWORD_RECOVERY_COOKIE);

  // The AuthShell frame, but the title comes from the form: only the form knows
  // whether the link expired, whether the password is being chosen or whether it
  // has already been changed.
  return (
    <AuthFrame homeLabel={t("auth.page.backToHome")}>
      <UpdatePasswordForm recoveryVerified={recoveryVerified} />
      <div className="auth-footer">
        {t("auth.forgot.footerPrompt")}{" "}
        <Link
          href="/auth?mode=signin"
          className="font-semibold text-[var(--color-primary)]!"
        >
          {t("auth.forgot.footerLink")}
        </Link>
      </div>
    </AuthFrame>
  );
}
