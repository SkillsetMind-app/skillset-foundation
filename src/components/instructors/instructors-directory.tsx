"use client";

import { ArrowRight, GraduationCap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { UserAvatar } from "@/components/shared/user-avatar";
import type { PublicProfile } from "@/domain/user-profile";
import { listPublicProfiles } from "@/lib/data/user-profiles";

export function InstructorsDirectory() {
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;

    void listPublicProfiles()
      .then((nextProfiles) => {
        if (!active) {
          return;
        }

        setProfiles(nextProfiles);
        setHasError(false);
      })
      .catch(() => {
        if (active) {
          setHasError(true);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (isLoading) {
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <p className="sr-only" role="status">
          Loading instructors...
        </p>
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-56 animate-pulse rounded-[16px] border border-[var(--color-line)] bg-white shadow-[var(--shadow-soft)]"
          />
        ))}
      </section>
    );
  }

  if (hasError) {
    return (
      <section className="mt-12 rounded-[16px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] p-6">
        <p className="text-sm font-semibold text-[var(--color-danger-fg)]">
          Instructor profiles could not load right now.
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
          Course pages still show verified instructor identity when a public
          profile is available.
        </p>
      </section>
    );
  }

  if (profiles.length === 0) {
    return (
      <section className="mt-12 rounded-[16px] border border-dashed border-[rgba(26,54,93,0.22)] bg-[var(--color-surface-soft)] p-8 sm:p-10">
        <div className="flex max-w-3xl flex-col gap-5 sm:flex-row sm:items-start">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-[var(--color-primary)] shadow-[var(--shadow-soft)]">
            <GraduationCap aria-hidden="true" size={22} strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              First cohort
            </p>
            <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
              Public instructor profiles appear after review.
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              SkillsetMind only lists real published profiles. New creators can
              finish onboarding and submit their first reviewed course before
              they appear here.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/auth?mode=signup&path=teacher"
                className="button-solid px-4 py-2.5 text-sm"
              >
                Start teaching
              </Link>
              <Link
                href="/courses"
                className="button-outline px-4 py-2.5 text-sm"
              >
                Browse courses
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-12" aria-labelledby="instructors-directory-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Directory
          </p>
          <h2
            id="instructors-directory-heading"
            className="display-title mt-2 text-3xl text-[var(--color-primary)]"
          >
            Published instructors
          </h2>
        </div>
        <Link
          href="/courses"
          className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-primary)] underline-offset-4 hover:underline"
        >
          Browse their courses
          <ArrowRight aria-hidden="true" size={16} strokeWidth={1.9} />
        </Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.map((profile) => (
          <InstructorCard key={profile.uid} profile={profile} />
        ))}
      </div>
    </section>
  );
}

function InstructorCard({ profile }: { profile: PublicProfile }) {
  const name =
    profile.displayName || profile.username || "SkillsetMind instructor";
  const credentials = profile.credentials.slice(0, 2);

  return (
    <article className="flex min-h-64 flex-col rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-3">
        <UserAvatar name={name} photoURL={profile.photoURL} size="lg" />
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-[var(--color-ink)]">
            {name}
          </h3>
          {profile.username ? (
            <p className="mt-1 truncate text-xs font-semibold text-[var(--color-ink-soft)]">
              @{profile.username}
            </p>
          ) : null}
        </div>
      </div>

      {profile.bio ? (
        <p className="mt-4 line-clamp-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          {profile.bio}
        </p>
      ) : (
        <p className="mt-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          This instructor has published their profile and is preparing reviewed
          learning experiences on SkillsetMind.
        </p>
      )}

      {credentials.length > 0 ? (
        <ul className="mt-4 grid gap-2 border-t border-[var(--color-line)] pt-4">
          {credentials.map((credential, index) => (
            <li
              key={`${profile.uid}-credential-${index}`}
              className="text-xs leading-5 text-[var(--color-ink-soft)]"
            >
              {credential}
            </li>
          ))}
        </ul>
      ) : null}

      <Link
        href={`/instructors/${encodeURIComponent(profile.uid)}`}
        className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-bold text-[var(--color-primary)] underline-offset-4 hover:underline"
      >
        View profile
        <ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
      </Link>
    </article>
  );
}
