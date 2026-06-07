import Link from "next/link";

import { SiteNav } from "@/components/site/site-nav";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Terms of Service",
  description:
    "The terms that govern use of the Skillset platform.",
  path: "/legal/terms",
});

const EFFECTIVE_DATE = "June 1, 2026";
const SUPPORT_EMAIL = "support@skillset.app";

export default function TermsPage() {
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-8">
        <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-8 shadow-[var(--shadow-soft)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent)]">
            Legal
          </p>
          <h1 className="display-title mt-4 text-6xl leading-none text-[var(--color-primary)]">
            Terms of service
          </h1>
          <p className="mt-6 text-sm leading-8 text-[var(--color-ink-soft)]">
            These terms explain how the site, courses, and educator tools can be
            used across Skillset. They form a binding agreement between you and
            Skillset when you create an account, enroll in a course, or publish
            as an educator.
          </p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
            Effective {EFFECTIVE_DATE} · Current operating version
          </p>
        </section>

        <section className="mt-6 space-y-10 rounded-[18px] border border-[var(--color-line)] bg-white p-8 text-sm leading-8 text-[var(--color-ink-soft)] shadow-[var(--shadow-soft)] sm:p-10">
          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              1. Acceptance and eligibility
            </h2>
            <p className="mt-3">
              By creating an account or using Skillset you agree to these terms.
              You must be at least 13 years old (or 16 in the European Union) to
              use the platform. If you use Skillset on behalf of an organization,
              you confirm you are authorized to accept these terms for it.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              2. Your account
            </h2>
            <p className="mt-3">
              You are responsible for the activity under your account and for
              keeping your sign-in credentials secure. Accounts are personal and
              non-transferable. Tell us promptly at{" "}
              <a className="font-semibold text-[var(--color-accent)]" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              if you believe your account has been accessed without your
              permission.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              3. Courses and access
            </h2>
            <p className="mt-3">
              Enrolling in a course grants you a personal, non-transferable,
              non-exclusive license to access that course&apos;s content for your
              own learning. You may not resell, redistribute, publicly broadcast,
              or share paid course materials. Course availability, structure, and
              pricing are set by the educator and may change over time.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              4. Payments, billing, and refunds
            </h2>
            <p className="mt-3">
              Paid enrollments are processed securely by Stripe. Skillset does not
              store full payment card numbers. Prices are shown at checkout in the
              listed currency and you authorize the charge when you confirm your
              purchase.
            </p>
            <p className="mt-3">
              Course purchases are eligible for a refund within{" "}
              <strong className="text-[var(--color-ink)]">7 days</strong> of
              purchase, provided the course has not been substantially completed.
              Request a refund from your{" "}
              <Link className="font-semibold text-[var(--color-accent)]" href="/account">
                account billing page
              </Link>{" "}
              or by contacting{" "}
              <a className="font-semibold text-[var(--color-accent)]" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
              . Educator payout and refund handling is described in the{" "}
              <Link className="font-semibold text-[var(--color-accent)]" href="/fees-and-payouts">
                fees and payouts policy
              </Link>
              .
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              5. Educators and creators
            </h2>
            <p className="mt-3">
              If you publish courses, additional terms apply, including payout,
              commission, and content responsibilities described in the{" "}
              <Link className="font-semibold text-[var(--color-accent)]" href="/legal/teacher-terms">
                educator terms
              </Link>
              . You are responsible for the accuracy, ownership, and lawfulness of
              the content you publish, and you grant Skillset the rights needed to
              host and deliver it to your enrolled learners.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              6. Acceptable use
            </h2>
            <p className="mt-3">You agree not to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>use the platform for any unlawful, fraudulent, or harmful purpose;</li>
              <li>share, scrape, or copy paid content outside your personal license;</li>
              <li>attempt to bypass security, access controls, or payment flows;</li>
              <li>upload malware or content that infringes the rights of others;</li>
              <li>harass other learners, educators, or staff.</li>
            </ul>
            <p className="mt-3">
              We may suspend or remove accounts that violate these terms.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              7. Intellectual property
            </h2>
            <p className="mt-3">
              Course content remains the property of the educators who create it
              or their licensors. The Skillset name, brand, and platform are owned
              by Skillset. Nothing in these terms transfers ownership to you beyond
              the access license described above.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              8. Disclaimers and limitation of liability
            </h2>
            <p className="mt-3">
              Skillset and its courses are educational and provided on an
              &quot;as is&quot; basis. We do not guarantee any specific learning,
              career, or income outcome. To the maximum extent permitted by law,
              Skillset&apos;s total liability for any claim relating to the service
              is limited to the amount you paid to Skillset in the twelve months
              before the claim.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              9. Changes to these terms
            </h2>
            <p className="mt-3">
              We may update these terms as the platform evolves. When we make
              material changes we will update the effective date above and, where
              appropriate, notify you. Continuing to use Skillset after an update
              means you accept the revised terms.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              10. Contact
            </h2>
            <p className="mt-3">
              Questions about these terms? Reach us at{" "}
              <a className="font-semibold text-[var(--color-accent)]" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              or through the{" "}
              <Link className="font-semibold text-[var(--color-accent)]" href="/support">
                support page
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
