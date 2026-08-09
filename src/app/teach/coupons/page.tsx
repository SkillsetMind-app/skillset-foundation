import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";

// Coupons live inside each course's management central now — this route stays
// as a signpost for old links.
export default function TeacherCouponsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Coupons & promotions" hideHeader>
        <section className="overflow-hidden rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Teacher Studio
          </p>
          <h3 className="display-title mt-4 max-w-3xl text-4xl leading-tight text-[var(--color-primary)]">
            Coupons live in each course&apos;s central.
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Open a course, choose Manage, and head to the Coupons section to
            create discount codes for it. Codes are live at checkout: buyers
            enter them on your course page and the discount applies before
            payment.
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
