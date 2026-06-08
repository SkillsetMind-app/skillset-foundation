"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatPrimaryRole } from "@/domain/auth";

export function SessionCard({ collapsed = false }: { collapsed?: boolean }) {
  const { status, user } = useAuth();

  if (status === "loading") {
    return (
      <div className={`mt-3 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-2 text-xs text-[var(--color-ink-soft)] ${collapsed ? "text-center" : ""}`}>
        Checking session...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (collapsed) {
    return (
      <Link
        href="/account?tab=profile"
        className="mt-3 grid place-items-center rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.28)]"
        aria-label="Open profile settings"
      >
        <UserAvatar
          name={user.displayName || user.email}
          photoURL={user.photoURL}
          size="md"
          className="shadow-[var(--shadow-avatar)]"
        />
      </Link>
    );
  }

  // Sign-out lives in the top-right AccountMenu — repeating it here just
  // doubled the sidebar's bottom footprint. This card is now a tap-target
  // shortcut to profile settings; the avatar + name make the link obvious.
  return (
    <Link
      href="/account?tab=profile"
      className="mt-3 flex items-center gap-2 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] p-2 transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.28)]"
    >
      <UserAvatar
        name={user.displayName || user.email}
        photoURL={user.photoURL}
        size="sm"
      />
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-[var(--color-ink)]">
          {user.displayName || user.email || "Skillset user"}
        </p>
        <p className="truncate text-[10px] text-[var(--color-ink-soft)]">
          {formatPrimaryRole(user.roles)}
        </p>
      </div>
    </Link>
  );
}
