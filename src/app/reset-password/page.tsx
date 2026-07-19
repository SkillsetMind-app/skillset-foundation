import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";

export const metadata: Metadata = {
  title: "Set a new password | SkillsetMind",
  robots: {
    index: false,
    follow: false,
  },
};

// Landing page for the password reset email link (after /auth/callback
// exchanges the recovery code for a session).
export default function ResetPasswordPage() {
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
        <UpdatePasswordForm />
      </div>
    </AuthShell>
  );
}
