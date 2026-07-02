import Link from "next/link";

import { Define, LegalArticle, LegalSection } from "@/components/site/legal-article";
import { refundWindowDays } from "@/data/plans";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Terms of Service",
  description: "The terms that govern use of the Skillset platform.",
  path: "/legal/terms",
});

const EFFECTIVE_DATE = "July 2, 2026";
const SUPPORT_EMAIL = "support@skillset.app";

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

export default function TermsPage() {
  return (
    <LegalArticle
      kicker="Legal"
      title="Terms of Service"
      effectiveDate={EFFECTIVE_DATE}
      intro={
        <>
          <p>
            These Terms of Service (&quot;Terms&quot;) are a binding agreement
            between you and{" "}
            <Define>DEFINE: legal entity name, e.g. Skillset Mind LLC</Define>{" "}
            (&quot;Skillset,&quot; &quot;we,&quot; &quot;us&quot;), the operator
            of the Skillset platform. They apply when you create an account,
            browse, enroll in a course, or publish content on Skillset.
          </p>
          <p className="mt-3">
            Skillset is an online course marketplace for psychologists,
            therapists, and personal-development professionals. Two additional
            documents form part of this agreement: the{" "}
            <Link className="font-semibold text-[var(--color-accent-fg)]" href="/legal/privacy">
              Privacy Policy
            </Link>{" "}
            and, if you publish courses, the{" "}
            <Link className="font-semibold text-[var(--color-accent-fg)]" href="/legal/teacher-terms">
              Teacher Terms
            </Link>
            .
          </p>
        </>
      }
    >
      <LegalSection heading="1. Acceptance and eligibility">
        <p>
          By creating an account or using Skillset you accept these Terms. If
          you do not agree, do not use the platform.
        </p>
        <p>
          You must be at least <strong className="text-[var(--color-ink)]">18 years old</strong>{" "}
          and legally capable of entering into contracts to use Skillset. If
          you use Skillset on behalf of an organization, you confirm you are
          authorized to bind that organization to these Terms.
        </p>
      </LegalSection>

      <LegalSection heading="2. Your account and roles">
        <p>
          Skillset uses a single account with up to two roles: learner
          (enrolling in courses) and educator (publishing courses). You choose
          your role after registration and may hold both under the same
          account. Registration requires a valid email address and password;
          authentication is provided through our infrastructure provider,
          Supabase.
        </p>
        <p>
          You are responsible for all activity under your account and for
          keeping your credentials secure. Accounts are personal and
          non-transferable. Notify us promptly at <SupportLink /> if you
          believe your account has been accessed without authorization. You
          must provide accurate information and keep it current.
        </p>
      </LegalSection>

      <LegalSection heading="3. The platform and course review">
        <p>
          Skillset provides the technology to host and deliver courses: video
          classrooms, private per-course communities, live sessions, publicly
          verifiable certificates, and course reviews by enrolled learners.
          Courses are created by independent educators, not by Skillset.
        </p>
        <p>
          Courses go through a platform review before publication. Review is a
          quality and policy screen only: it is not an endorsement,
          certification, or guarantee of any course&apos;s accuracy,
          effectiveness, or fitness for your needs.
        </p>
      </LegalSection>

      <LegalSection heading="4. License to course content">
        <p>
          Enrolling in a course grants you a personal, non-transferable,
          non-exclusive, revocable license to access that course&apos;s content
          for your own learning. You may not resell, redistribute, publicly
          display, record, or share paid course materials, or grant access to
          anyone else. Course availability, structure, and pricing are set by
          the educator and may change over time.
        </p>
      </LegalSection>

      <LegalSection heading="5. Not therapy or medical advice">
        <p>
          Courses on Skillset are educational products. They are{" "}
          <strong className="text-[var(--color-ink)]">
            not psychotherapy, counseling, medical care, or a substitute for
            treatment
          </strong>
          , and no therapist-client or doctor-patient relationship is created
          by enrolling in a course or participating in a community or live
          session. If you are experiencing a mental-health crisis, contact
          local emergency services or a crisis hotline immediately. Decisions
          about your health should be made with a qualified professional who
          treats you individually.
        </p>
      </LegalSection>

      <LegalSection heading="6. Payments and billing">
        <p>
          Paid enrollments and educator subscriptions are processed by Stripe.
          Skillset does not store full payment card numbers. Prices are shown
          at checkout in the listed currency, and you authorize the charge when
          you confirm a purchase. You are responsible for any taxes, duties,
          or bank fees that apply to your purchase under your local law.
        </p>
      </LegalSection>

      <LegalSection heading="7. Refunds">
        <p>
          Course purchases are eligible for a refund within{" "}
          <strong className="text-[var(--color-ink)]">
            {refundWindowDays} days
          </strong>{" "}
          of purchase, provided the course has not been substantially completed
          and no certificate has been issued.{" "}
          <Define>
            DEFINE: confirm final refund window — market standard is 7 to 30
            days; the platform currently operates at {refundWindowDays} days
          </Define>
          . Request a refund from your{" "}
          <Link className="font-semibold text-[var(--color-accent-fg)]" href="/account">
            account billing page
          </Link>{" "}
          or by contacting <SupportLink />. Refunds are returned through the
          original payment method via Stripe. After the refund window, refunds
          are granted at our discretion or where required by applicable
          consumer law, which may give you additional non-waivable rights
          depending on your country of residence.
        </p>
      </LegalSection>

      <LegalSection heading="8. Certificates">
        <p>
          Certificates issued on Skillset attest to completion of a specific
          course and are verifiable through a public URL. They are not
          professional licenses, accreditations, or clinical qualifications,
          and may not be presented as such.
        </p>
      </LegalSection>

      <LegalSection heading="9. Communities, live sessions, and reviews">
        <p>
          When you post in a community, join a live session, or leave a course
          review, you remain responsible for what you share. Reviews must
          reflect your genuine experience. You grant Skillset a non-exclusive
          license to host and display the content you post on the platform so
          the features can function.
        </p>
        <p>
          Do not share other participants&apos; personal information or
          recordings of live sessions outside the platform.
        </p>
      </LegalSection>

      <LegalSection heading="10. Prohibited conduct">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>use the platform for any unlawful, fraudulent, or harmful purpose;</li>
          <li>share, scrape, download, or copy paid content outside your personal license;</li>
          <li>attempt to bypass security, access controls, or payment flows;</li>
          <li>upload malware or content that infringes the rights of others;</li>
          <li>impersonate any person or misrepresent credentials or affiliations;</li>
          <li>harass, threaten, or abuse other learners, educators, or staff;</li>
          <li>
            solicit platform users off-platform to circumvent Skillset checkout
            for a course sold on Skillset;
          </li>
          <li>use automated tools to access the platform except through interfaces we provide.</li>
        </ul>
        <p>
          We may suspend or terminate accounts that violate these Terms, and
          remove content that violates them, with notice where practicable.
        </p>
      </LegalSection>

      <LegalSection heading="11. Intellectual property">
        <p>
          Course content remains the property of the educators who create it or
          their licensors. The Skillset name, brand, design, and platform
          software are owned by Skillset. Except for the access license in
          Section 4, nothing in these Terms transfers any ownership to you.
        </p>
        <p>
          If you believe content on Skillset infringes your copyright, send a
          notice to <SupportLink /> identifying the work, the infringing
          material, and your contact details, and we will process it under
          applicable law (including the DMCA where it applies).
        </p>
      </LegalSection>

      <LegalSection heading="12. Third-party services">
        <p>
          The platform relies on third-party providers, including Supabase
          (authentication and data), Stripe (payments), Vercel (hosting), and
          PostHog (product analytics). Their processing of your data is
          described in our{" "}
          <Link className="font-semibold text-[var(--color-accent-fg)]" href="/legal/privacy">
            Privacy Policy
          </Link>
          . We are not responsible for third-party sites that educators link to
          from their content.
        </p>
      </LegalSection>

      <LegalSection heading="13. Disclaimer of warranties">
        <p>
          The platform and all courses are provided &quot;as is&quot; and
          &quot;as available,&quot; without warranties of any kind, express or
          implied, including merchantability, fitness for a particular purpose,
          and non-infringement. We do not warrant that the platform will be
          uninterrupted or error-free, or that any course will produce a
          specific learning, professional, health, or income outcome. Some
          jurisdictions do not allow certain warranty exclusions, so parts of
          this section may not apply to you.
        </p>
      </LegalSection>

      <LegalSection heading="14. Limitation of liability">
        <p>
          To the maximum extent permitted by law, Skillset will not be liable
          for indirect, incidental, special, consequential, or punitive
          damages, or for lost profits, data, or goodwill. Our total aggregate
          liability for any claim relating to the platform is limited to the
          greater of (a) the amounts you paid to Skillset in the twelve months
          before the claim arose, or (b) USD 100. Nothing in these Terms limits
          liability that cannot be limited by law, including under mandatory
          consumer-protection rules of your country of residence.
        </p>
      </LegalSection>

      <LegalSection heading="15. Indemnification">
        <p>
          You will indemnify and hold Skillset harmless from claims, damages,
          and reasonable legal costs arising from your content, your violation
          of these Terms, or your violation of any law or third-party right,
          except to the extent caused by our own breach of this agreement.
        </p>
      </LegalSection>

      <LegalSection heading="16. Governing law and disputes">
        <p>
          These Terms are governed by the laws of{" "}
          <Define>
            DEFINE: jurisdiction — suggested: the State of Delaware, USA, or
            the state where the company is incorporated
          </Define>
          , without regard to conflict-of-law rules. Before filing any claim,
          you agree to contact us at <SupportLink /> and attempt to resolve the
          dispute informally for 30 days.
        </p>
        <p>
          Unresolved disputes will be settled by{" "}
          <Define>
            DEFINE: dispute forum — suggested: binding individual arbitration
            under AAA rules, seat in Delaware; class actions waived to the
            extent permitted
          </Define>
          . If you reside in a jurisdiction whose law guarantees you access to
          your local courts or protections that cannot be waived (including
          consumers in the European Union and Brazil), those rights are not
          affected by this section.
        </p>
      </LegalSection>

      <LegalSection heading="17. Changes and language">
        <p>
          We may update these Terms as the platform evolves. For material
          changes we will update the effective date above and notify you by
          email or in-product notice before the changes take effect. Continuing
          to use Skillset after that date means you accept the revised Terms.
        </p>
        <p>
          These Terms are written in English. Translations may be provided for
          convenience; if there is a conflict, the English version controls
          except where local law requires otherwise.
        </p>
      </LegalSection>

      <LegalSection heading="18. Contact">
        <p>
          <Define>DEFINE: legal entity name</Define>,{" "}
          <Define>DEFINE: registered address</Define>. Questions about these
          Terms: <SupportLink /> or{" "}
          <Define>DEFINE: dedicated legal contact email, e.g. legal@skillset.app</Define>
          .
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
