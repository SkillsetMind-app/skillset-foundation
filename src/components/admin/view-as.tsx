"use client";

import { useAuth } from "@/components/auth/auth-provider";
import type { Role } from "@/lib/permissions";

/**
 * Preview the product as another level.
 *
 * An admin sees admin surfaces everywhere, which makes it impossible to answer
 * "what does a learner actually get" without creating a throwaway account. This
 * swaps the role the INTERFACE reads, so the same session can walk the learner
 * or instructor product and walk back out.
 *
 * It is a preview, not an impersonation: no other account is involved, no data
 * belonging to anyone else is read, and it can only narrow what is on offer.
 * Every write is still gated server-side, which knows nothing about this.
 */

const PREVIEWABLE: ReadonlyArray<{ role: Role; label: string }> = [
  { role: "student", label: "Learner" },
  { role: "teacher", label: "Instructor" },
  { role: "support", label: "Team" },
];

export function ViewAsSwitcher() {
  const { isRealAdmin, viewAsRole, setViewAsRole } = useAuth();

  if (!isRealAdmin) {
    return null;
  }

  return (
    <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
      <h3 className="display-title text-2xl leading-none text-[var(--color-ink)]">
        Preview the product
      </h3>
      <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
        See the platform the way a learner or an instructor sees it, without
        creating a second account. Your own access is untouched — only what the
        interface offers changes.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {PREVIEWABLE.map((entry) => (
          <button
            key={entry.role}
            type="button"
            onClick={() => setViewAsRole(entry.role)}
            aria-pressed={viewAsRole === entry.role}
            className={`rounded-[10px] px-4 py-2 text-sm font-bold transition ${
              viewAsRole === entry.role
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-line)] text-[var(--color-ink-soft)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
        {viewAsRole ? (
          <button
            type="button"
            onClick={() => setViewAsRole(null)}
            className="rounded-[10px] border border-[var(--color-line)] px-4 py-2 text-sm font-bold text-[var(--color-ink)]"
          >
            Back to admin
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Always-on reminder that the product on screen is a preview.
 *
 * Mounted globally, because the preview follows you off the ops page — without
 * this, an admin who wanders into the classroom has no way to tell a missing
 * button from a broken one, and no way back except clearing storage.
 */
export function ViewAsBanner() {
  const { isRealAdmin, viewAsRole, setViewAsRole } = useAuth();

  if (!isRealAdmin || !viewAsRole) {
    return null;
  }

  const label =
    PREVIEWABLE.find((entry) => entry.role === viewAsRole)?.label ?? viewAsRole;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-3 bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white"
    >
      <span>Previewing as {label}. Your admin access is unchanged.</span>
      <button
        type="button"
        onClick={() => setViewAsRole(null)}
        className="rounded-[8px] bg-white/15 px-3 py-1 text-xs font-bold underline-offset-2 hover:underline"
      >
        Exit preview
      </button>
    </div>
  );
}
