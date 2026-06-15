"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { completeUserOnboarding } from "@/lib/data/user-profiles";
import { ArrowRight, GraduationCap, Presentation } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function WelcomeChoice() {
  const { status, user } = useAuth();
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth?mode=signin");
    }
  }, [router, status]);

  async function chooseLearner() {
    if (!user || isSaving) {
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await completeUserOnboarding({
        uid: user.uid,
        roles: ["student"],
        identity: {
          displayName: user.displayName ?? undefined,
        },
      });
      router.replace("/learn");
    } catch {
      setError("Could not finish onboarding. Please try again.");
      setIsSaving(false);
    }
  }

  function chooseTeacher() {
    router.push("/onboarding?path=teacher");
  }

  return (
    <main className="min-h-screen bg-[var(--color-base)]">
      <section className="grid min-h-screen place-items-center px-5 py-12">
        <div className="w-full max-w-[580px] text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[var(--color-ink-muted)]">
            Welcome to Skillset
          </p>
          <h1 className="display-title mt-4 text-[38px] font-semibold leading-[1.1] text-[var(--color-primary)]">
            How will you use Skillset?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
            You can change this later in your account settings.
          </p>

          <div className="mt-8 grid gap-3 text-left">
            <button
              type="button"
              disabled={isSaving || status !== "authenticated"}
              onClick={chooseLearner}
              className="group flex cursor-pointer items-center gap-4 rounded-[16px] border-[1.5px] border-[rgba(26,54,93,0.10)] bg-white px-5 py-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent-fg)] hover:shadow-[0_16px_32px_rgba(15,39,68,0.08)] disabled:cursor-not-allowed disabled:opacity-60 sm:gap-5 sm:px-6"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-[var(--color-surface-strong)] text-[var(--color-primary)] transition group-hover:bg-[var(--color-accent)] group-hover:text-white">
                <GraduationCap aria-hidden="true" size={24} strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="display-title block text-[22px] font-semibold leading-none text-[var(--color-primary)]">
                  I&apos;m here to learn
                </span>
                <span className="mt-2 block text-[13px] leading-6 text-[var(--color-ink-soft)]">
                  Browse programs, enroll in courses, join course communities,
                  and earn Skillset Verified certificates.
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                size={18}
                strokeWidth={1.8}
                className="shrink-0 -translate-x-1 text-[var(--color-ink-muted)] opacity-0 transition group-hover:translate-x-0 group-hover:text-[var(--color-accent-fg)] group-hover:opacity-100"
              />
            </button>

            <button
              type="button"
              disabled={status !== "authenticated"}
              onClick={chooseTeacher}
              className="group flex cursor-pointer items-center gap-4 rounded-[16px] border-[1.5px] border-[rgba(26,54,93,0.10)] bg-white px-5 py-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent-fg)] hover:shadow-[0_16px_32px_rgba(15,39,68,0.08)] disabled:cursor-not-allowed disabled:opacity-60 sm:gap-5 sm:px-6"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-[var(--color-surface-strong)] text-[var(--color-primary)] transition group-hover:bg-[var(--color-accent)] group-hover:text-white">
                <Presentation aria-hidden="true" size={24} strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="display-title block text-[22px] font-semibold leading-none text-[var(--color-primary)]">
                  I&apos;m here to teach
                </span>
                <span className="mt-2 block text-[13px] leading-6 text-[var(--color-ink-soft)]">
                  Build courses, publish to the marketplace as soon as you submit,
                  and get paid through Stripe.
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                size={18}
                strokeWidth={1.8}
                className="shrink-0 -translate-x-1 text-[var(--color-ink-muted)] opacity-0 transition group-hover:translate-x-0 group-hover:text-[var(--color-accent-fg)] group-hover:opacity-100"
              />
            </button>
          </div>

          {error ? (
            <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
