import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery-cookie";

export const metadata: Metadata = {
  title: "Set a new password | SkillsetMind",
  robots: {
    index: false,
    follow: false,
  },
};

// Landing page for the password reset email link (after /auth/callback
// exchanges the recovery code for a session). The recovery cookie set by the
// callback is what distinguishes that flow from a regular signed-in session —
// without it the form refuses to offer a no-current-password reset.
export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const recoveryVerified = cookieStore.has(PASSWORD_RECOVERY_COOKIE);

  return (
    <AuthShell
      eyebrow="Password recovery"
      title="Set a new password"
      description="Choose a new password for your account. You won't need your old one."
      footer={
        <>
          Remembered it after all?{" "}
          <Link
            href="/auth?mode=signin"
            className="font-semibold text-[var(--color-primary)]"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Almost done
        </p>
        <h2 className="display-title mt-3 text-4xl text-[var(--color-primary)]">
          Choose a new password
        </h2>
        <UpdatePasswordForm recoveryVerified={recoveryVerified} />
      </div>
    </AuthShell>
  );
}
