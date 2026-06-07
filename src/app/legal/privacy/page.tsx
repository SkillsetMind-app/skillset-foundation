import Link from "next/link";

import { SiteNav } from "@/components/site/site-nav";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Privacy Policy",
  description:
    "How Skillset collects, uses, and protects your data.",
  path: "/legal/privacy",
});

const EFFECTIVE_DATE = "June 1, 2026";
const SUPPORT_EMAIL = "support@skillset.app";

export default function PrivacyPage() {
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-8">
        <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-8 shadow-[var(--shadow-soft)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Legal
          </p>
          <h1 className="display-title mt-4 text-6xl leading-none text-[var(--color-primary)]">
            Privacy policy
          </h1>
          <p className="mt-6 text-sm leading-8 text-[var(--color-ink-soft)]">
            This policy explains what information Skillset collects, how we use
            it, and the choices you have. It applies to visitors, learners, and
            educators who use the platform.
          </p>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
            Effective {EFFECTIVE_DATE} · Current operating version
          </p>
        </section>

        <section className="mt-6 space-y-10 rounded-[18px] border border-[var(--color-line)] bg-white p-8 text-sm leading-8 text-[var(--color-ink-soft)] shadow-[var(--shadow-soft)] sm:p-10">
          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              1. Information we collect
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                <strong className="text-[var(--color-ink)]">Account details</strong>{" "}
                — your name and email, managed through Firebase Authentication,
                plus your role (learner or educator).
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">Learning activity</strong>{" "}
                — courses you enroll in, lesson progress, and certificates you
                earn.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">Purchase records</strong>{" "}
                — enrollment and order history. Payments are processed by Stripe;
                we receive confirmation and receipt details but not your full card
                number.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">Support and community</strong>{" "}
                — messages you send to support and any posts or comments you make
                in community spaces.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">Usage and device data</strong>{" "}
                — product analytics collected through PostHog, plus cookies used to
                keep you signed in and to understand how the platform is used.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              2. How we use your information
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>provide and operate your account, courses, and certificates;</li>
              <li>process payments, refunds, and educator payouts;</li>
              <li>provide support and respond to your requests;</li>
              <li>keep the platform secure and prevent fraud or abuse;</li>
              <li>improve the product and understand how it is used;</li>
              <li>meet legal, tax, and accounting obligations.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              3. Service providers we share with
            </h2>
            <p className="mt-3">
              We use trusted providers to run the platform and share only the data
              they need to perform their service:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>
                <strong className="text-[var(--color-ink)]">Google Firebase</strong>{" "}
                — authentication, database, and hosting.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">Stripe</strong> —
                payment processing and payouts.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">PostHog</strong> —
                product analytics.
              </li>
            </ul>
            <p className="mt-3">
              We do not sell your personal data. We may disclose information if
              required by law or to protect the rights and safety of our users.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              4. Cookies and analytics
            </h2>
            <p className="mt-3">
              We use essential cookies to keep you signed in and analytics cookies
              to understand how the platform is used. You can manage non-essential
              cookies through the consent controls shown on the site and through
              your browser settings.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              5. Data retention
            </h2>
            <p className="mt-3">
              We keep your information for as long as your account is active and as
              needed to provide the service. We retain purchase and tax records for
              the periods required by law, even after an account is closed.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              6. Your rights
            </h2>
            <p className="mt-3">
              You can request access to, correction of, a copy of, or deletion of
              your personal data. Email{" "}
              <a className="font-semibold text-[var(--color-accent-fg)]" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              and we will respond in line with applicable law. Some records, such
              as financial history, may be retained where the law requires it.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              7. Security
            </h2>
            <p className="mt-3">
              We protect your data with encryption in transit, access controls, and
              rules-based authorization on our database and storage. No method of
              transmission or storage is completely secure, but we work to protect
              your information and to address issues promptly.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              8. International processing
            </h2>
            <p className="mt-3">
              Skillset is operated using infrastructure located in the United
              States. By using the platform, you understand that your information
              may be processed there.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              9. Children
            </h2>
            <p className="mt-3">
              Skillset is not directed to children under 13, and learners in the
              European Union must be at least 16 or have guardian consent. We do not
              knowingly collect data from children below these ages.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
              10. Changes and contact
            </h2>
            <p className="mt-3">
              We may update this policy as the platform evolves and will revise the
              effective date above when we do. Questions or requests? Contact{" "}
              <a className="font-semibold text-[var(--color-accent-fg)]" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              or visit the{" "}
              <Link className="font-semibold text-[var(--color-accent-fg)]" href="/support">
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
