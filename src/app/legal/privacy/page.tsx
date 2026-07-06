import Link from "next/link";

import { LegalArticle, LegalSection } from "@/components/site/legal-article";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Privacy Policy",
  description: "How Skillset collects, uses, and protects your data.",
  path: "/legal/privacy",
});

const EFFECTIVE_DATE = "July 5, 2026";
const SUPPORT_EMAIL = "support@skillsetmind.com";
const LEGAL_EMAIL = "legal@skillsetmind.com";

function SupportLink() {
  return (
    <a
      className="font-semibold text-[var(--color-accent-fg)]"
      href={`mailto:${SUPPORT_EMAIL}`}
    >
      {SUPPORT_EMAIL}
    </a>
  );
}

export default function PrivacyPage() {
  return (
    <LegalArticle
      kicker="Legal"
      title="Privacy Policy"
      effectiveDate={EFFECTIVE_DATE}
      intro={
        <>
          <p>
            This policy explains what personal information Skillset collects,
            why, who it is shared with, and the rights you have over it. It
            applies to visitors, learners, and educators. The data controller
            is Skillset USA, 26 Broadway, New York, NY 10006, United States
            (&quot;Skillset,&quot; &quot;we,&quot; &quot;us&quot;).
          </p>
          <p className="mt-3">
            Short version: we collect what the platform needs to run — your
            account, your learning activity, your purchases — plus product
            analytics you can opt out of. We do not sell your personal
            information.
          </p>
        </>
      }
    >
      <LegalSection heading="1. Information we collect">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong className="text-[var(--color-ink)]">Account data</strong> —
            name, email address, password (stored hashed by Supabase Auth), and
            your role on the platform (learner and/or educator).
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Profile data</strong> —
            information you add to your profile, such as a photo, bio, or
            professional background (for educators).
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Learning activity</strong>{" "}
            — courses you enroll in, lesson progress, certificates you earn,
            reviews you write, and posts in course communities and live
            sessions.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Transaction data</strong>{" "}
            — order history, amounts, currency, and refund status. Payments are
            processed by Stripe; we receive confirmation and receipt metadata
            but never your full card number.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Educator payout data</strong>{" "}
            — if you sell courses, the identity and banking information Stripe
            Connect requires for payouts is collected and held by Stripe under
            its own privacy terms; we see payout status and account state.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Usage data</strong> —
            product analytics collected through PostHog: pages viewed, features
            used, device and browser type, and approximate location derived
            from IP.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Cookies</strong> —
            described in Section 4 and controlled through the cookie banner.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Communications</strong>{" "}
            — messages you send to support and notification preferences.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="2. How we use it, and on what legal basis">
        <p>
          Under the GDPR (EU/EEA/UK) and the LGPD (Brazil), each use of
          personal data needs a legal basis. Ours are:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong className="text-[var(--color-ink)]">Performing our contract with you</strong>{" "}
            — creating and securing your account, delivering courses you enroll
            in, issuing certificates, processing purchases and refunds, paying
            educators.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Legitimate interests</strong>{" "}
            — keeping the platform safe, preventing fraud and abuse, improving
            features based on aggregate usage, and sending service messages
            about your account and purchases.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Consent</strong> —
            optional analytics cookies and marketing emails. You can withdraw
            consent at any time (cookie banner, unsubscribe link, or account
            settings) without affecting your use of the platform.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Legal obligations</strong>{" "}
            — tax, accounting, and lawful requests from authorities.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. What educators can see">
        <p>
          When you enroll in a course, the educator who runs it can see your
          name, email, enrollment date, and progress in their course — this is
          how they support their students. Under our public creator commitments
          (&quot;The Promise&quot;), each educator&apos;s student list belongs
          to that educator. Educators must handle student data lawfully and may
          not sell it; their obligations are set out in the{" "}
          <Link className="font-semibold text-[var(--color-accent-fg)]" href="/legal/teacher-terms">
            Teacher Terms
          </Link>
          . Educators do not see your payment details or your activity in other
          educators&apos; courses.
        </p>
      </LegalSection>

      <LegalSection heading="4. Cookies and analytics">
        <p>
          We use strictly necessary cookies for sign-in sessions and language
          preference, and optional analytics cookies (PostHog) to understand
          how the product is used. The cookie banner lets you accept or reject
          the optional ones; strictly necessary cookies cannot be switched off
          because the platform does not work without them. Analytics data is
          used in aggregate and not to profile you for advertising.
        </p>
      </LegalSection>

      <LegalSection heading="5. Who we share data with (subprocessors)">
        <p>
          We never sell your personal information. We share it only with the
          service providers that run the platform, under contracts that limit
          what they can do with it:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong className="text-[var(--color-ink)]">Supabase</strong> —
            authentication, database, and file storage (hosted in the United
            States).
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Stripe</strong> —
            payment processing, refunds, and educator payouts (Stripe Connect).
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Vercel</strong> —
            application hosting and content delivery.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">PostHog</strong> —
            product analytics.
          </li>
        </ul>
        <p>
          We may also disclose data when required by law, to protect the
          rights and safety of users, or as part of a corporate transaction
          (merger, acquisition), in which case this policy continues to apply
          to your data.
        </p>
      </LegalSection>

      <LegalSection heading="6. International transfers">
        <p>
          Our infrastructure is hosted in the United States. If you access
          Skillset from outside the US (including the EU/EEA, UK, or Brazil),
          your data is transferred to and processed in the US. For transfers
          from the EU/EEA and UK we rely on our providers&apos; Standard
          Contractual Clauses and, where applicable, the EU-US Data Privacy
          Framework; for Brazil, on the LGPD&apos;s international-transfer
          provisions (art. 33). Data processing agreements with our
          infrastructure providers (Supabase, Stripe, Vercel) are incorporated
          into their respective service terms.
        </p>
      </LegalSection>

      <LegalSection heading="7. Retention">
        <p>
          We keep personal data only as long as needed for the purposes above:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Account and learning data — while your account is active, and
            deleted or anonymized within 90 days after account deletion, except
            where retention is legally required.
          </li>
          <li>
            Certificates — the verification record persists so issued
            certificates remain verifiable, unless you ask us to remove it.
          </li>
          <li>
            Transaction records — kept for the period required by tax and
            accounting law (typically 5&ndash;10 years depending on
            jurisdiction).
          </li>
          <li>Analytics data — retained in identifiable form for no longer than 24 months.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="8. Security">
        <p>
          Data is encrypted in transit (TLS) and at rest by our infrastructure
          providers. Access to production data is restricted, and database
          access is governed by row-level security policies so users can only
          read what belongs to them. No system is perfectly secure; if a breach
          affects your personal data we will notify you and the competent
          authority as required by law (including GDPR art. 33/34 and LGPD
          art. 48).
        </p>
      </LegalSection>

      <LegalSection heading="9. Your rights">
        <p>
          You can exercise any of these rights by emailing <SupportLink /> or
          from your account settings. We respond within the timeframe required
          by your law (30 days under GDPR, 15 days for confirmation and access
          requests under LGPD, 45 days under CCPA). We will never discriminate
          against you for exercising a privacy right.
        </p>
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            European Union, EEA, and United Kingdom (GDPR / UK GDPR)
          </h3>
          <p className="mt-2">
            You have the right of access, rectification, erasure, restriction
            of processing, data portability, objection to processing based on
            legitimate interests, and withdrawal of consent. You may lodge a
            complaint with your local supervisory authority.
          </p>
        </div>
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            Brazil (LGPD)
          </h3>
          <p className="mt-2">
            You have the rights set out in article 18 of the LGPD:
            confirmation of processing, access, correction, anonymization or
            deletion of unnecessary or excessive data, portability, deletion of
            data processed with consent, information about sharing and about
            the consequences of refusing consent, and revocation of consent.
            You may file a complaint with the ANPD (Autoridade Nacional de
            Prote&ccedil;&atilde;o de Dados).
          </p>
        </div>
        <div>
          <h3 className="text-base font-semibold text-[var(--color-ink)]">
            California (CCPA / CPRA)
          </h3>
          <p className="mt-2">
            You have the right to know what personal information we collect,
            use, and disclose; to delete it; to correct it; and to opt out of
            &quot;sale&quot; or &quot;sharing.&quot; We do not sell or share
            personal information as defined by the CCPA, and we do not use
            sensitive personal information beyond what is necessary to provide
            the service. You may designate an authorized agent to submit
            requests for you.
          </p>
        </div>
      </LegalSection>

      <LegalSection heading="10. Children">
        <p>
          Skillset is for adults. We do not knowingly collect personal
          information from anyone under 18. If you believe a minor has created
          an account, contact <SupportLink /> and we will delete it.
        </p>
      </LegalSection>

      <LegalSection heading="11. Changes to this policy">
        <p>
          When we make material changes we will update the effective date above
          and notify you by email or in-product notice before they take effect.
          This policy is written in English; translations may be provided for
          convenience, and the English version controls except where local law
          requires otherwise.
        </p>
      </LegalSection>

      <LegalSection heading="12. Contact and data protection officer">
        <p>
          Privacy questions and rights requests: <SupportLink /> or{" "}
          <a
            className="font-semibold text-[var(--color-accent-fg)]"
            href={`mailto:${LEGAL_EMAIL}`}
          >
            {LEGAL_EMAIL}
          </a>
          . Data protection contact (including as
          &quot;encarregado&quot; under the Brazilian LGPD): Skillset Legal,
          reachable at the same address.
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
