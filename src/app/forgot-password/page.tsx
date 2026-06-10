import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Password recovery"
      title="Reset your password."
      description="Enter the email on your account and Skillset will send you a link to set a new password."
      footer={
        <>
          Remembered your password?{" "}
          <Link href="/auth?mode=signin" className="font-semibold text-[var(--color-primary)]">
            Return to sign in
          </Link>
        </>
      }
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Recover account
        </p>
        <h2 className="display-title mt-3 text-4xl text-[var(--color-primary)]">
          Send reset link
        </h2>
        <ResetPasswordForm />
      </div>
    </AuthShell>
  );
}
