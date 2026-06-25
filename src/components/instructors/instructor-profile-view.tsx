"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { UserAvatar } from "@/components/shared/user-avatar";
import type { PublicProfile } from "@/domain/user-profile";
import { subscribeToPublicProfile } from "@/lib/data/user-profiles";

export function InstructorProfileView({ uid }: { uid: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // Subscribe-only effect: state is mutated solely inside the Firestore
    // callbacks below. The parent passes `key={uid}` so a different instructor
    // remounts this component, resetting to the initial loading state without a
    // synchronous setState in the effect body.
    const unsubscribe = subscribeToPublicProfile(
      uid,
      (next) => {
        setProfile(next);
        setIsLoading(false);
      },
      () => {
        setHasError(true);
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [uid]);

  if (isLoading) {
    return (
      <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-8 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">
          Loading instructor&hellip;
        </p>
      </section>
    );
  }

  if (hasError || !profile) {
    return (
      <section className="rounded-[18px] border border-dashed border-[rgba(26,54,93,0.18)] bg-[var(--color-surface-soft)] p-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Profile unavailable
        </p>
        <h1 className="display-title mt-4 text-3xl leading-tight text-[var(--color-primary)]">
          This instructor profile isn&rsquo;t available.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
          The instructor may not have published a profile yet. Explore the
          marketplace to discover available courses.
        </p>
        <div className="mt-7">
          <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
            Browse the marketplace
          </Link>
        </div>
      </section>
    );
  }

  const name = profile.displayName || "Skillset instructor";

  return (
    <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <UserAvatar name={name} photoURL={profile.photoURL} size="lg" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Instructor
          </p>
          <h1 className="display-title mt-2 text-3xl text-[var(--color-ink)] sm:text-4xl">
            {name}
          </h1>
          {profile.username ? (
            <p className="mt-1 text-sm font-semibold text-[var(--color-ink-soft)]">
              @{profile.username}
            </p>
          ) : null}
        </div>
      </div>

      {profile.bio ? (
        <p className="mt-6 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {profile.bio}
        </p>
      ) : null}

      {profile.credentials.length > 0 ? (
        <div className="mt-7 border-t border-[var(--color-line)] pt-6">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            Background &amp; credentials
          </p>
          <ul className="mt-3 grid gap-2">
            {profile.credentials.map((credential, index) => (
              <li
                key={index}
                className="flex gap-2 text-sm leading-6 text-[var(--color-ink-soft)]"
              >
                <span aria-hidden className="text-[var(--color-brand)]">
                  &bull;
                </span>
                <span>{credential}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-8">
        <Link href="/courses" className="button-outline px-4 py-2.5 text-sm">
          View courses on Skillset
        </Link>
      </div>
    </section>
  );
}
