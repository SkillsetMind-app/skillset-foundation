import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";

// Co-producer records live inside each course's management central now — this
// route stays as a signpost for old links.
export default function TeacherCoProductionsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Co-productions" hideHeader>
        <section className="overflow-hidden rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Teacher Studio
          </p>
          <h3 className="display-title mt-4 max-w-3xl text-4xl leading-tight text-[var(--color-primary)]">
            Co-producers live in each course&apos;s central.
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Open a course, choose Manage, and head to the Co-producers section
            to record who co-created it and their revenue share. Automatic
            revenue splitting ships with the settlement engine — today every
            payout still routes to the course owner&apos;s connected account.
          </p>
          <div className="mt-6">
            <Link href="/teach/builder" className="button-solid px-4 py-2.5 text-sm">
              Open my courses
              <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
            </Link>
          </div>
        </section>
      </PlatformShell>
    </ProtectedSurface>
  );
}
