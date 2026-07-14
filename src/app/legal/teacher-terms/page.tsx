import Link from "next/link";

import { LegalArticle, LegalSection } from "@/components/site/legal-article";
import { payoutClearDays, refundWindowDays } from "@/data/plans";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Teacher Terms",
  description: "The terms that govern teaching and payouts on SkillsetMind.",
  path: "/legal/teacher-terms",
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

export default function TeacherTermsPage() {
  return (
    <LegalArticle
      kicker="Legal"
      title="Teacher Terms"
      effectiveDate={EFFECTIVE_DATE}
      intro={
        <>
          <p>
            These Teacher Terms apply in addition to the{" "}
            <Link className="font-semibold text-[var(--color-accent-fg)]" href="/legal/terms">
              Terms of Service
            </Link>{" "}
            when you publish or sell courses on SkillsetMind (&quot;educator,&quot;
            &quot;you&quot;). If these terms conflict with the Terms of
            Service, these terms control for your educator activity.
          </p>
          <p className="mt-3">
            They exist to protect three parties at once: your students, your
            work, and the trust of the marketplace. Our public commitments to
            you are written in{" "}
            <Link className="font-semibold text-[var(--color-accent-fg)]" href="/promise">
              The Promise
            </Link>
            .
          </p>
        </>
      }
    >
      <LegalSection heading="1. Your relationship with SkillsetMind">
        <p>
          You are an independent professional, not an employee, agent, or
          partner of SkillsetMind. You decide what to teach, how to price it
          (within the platform&apos;s supported options), and how to run your
          courses. SkillsetMind provides the technology, checkout, and marketplace
          — it does not supervise your professional practice.
        </p>
      </LegalSection>

      <LegalSection heading="2. Eligibility and accurate credentials">
        <p>
          You must be at least 18 years old. Any credentials, licenses,
          degrees, or professional experience you present on your profile or
          in your course pages must be truthful and current. Misrepresenting
          qualifications — especially clinical ones — is grounds for immediate
          removal.
        </p>
      </LegalSection>

      <LegalSection heading="3. Your content stays yours">
        <p>
          You retain full ownership of the intellectual property in the
          content you create. By publishing on SkillsetMind you grant us a
          non-exclusive, worldwide license to host, encode, display, and
          deliver your content to your enrolled students, and to use your
          course title, description, cover image, and public profile to
          promote your course on and off the platform. This license ends for a
          course when you remove it, except for students already enrolled, who
          keep the access they paid for.
        </p>
        <p>
          There is no exclusivity. You may sell the same or similar content
          anywhere else.
        </p>
      </LegalSection>

      <LegalSection heading="4. Content responsibility and review">
        <p>
          You are solely responsible for the accuracy, originality, legality,
          and student safety of everything you publish — videos, materials,
          community posts, and live sessions. You must own or have the rights
          to everything in your course, including music, images, and excerpts.
        </p>
        <p>
          Courses go through a platform review before publication. Review
          checks quality and policy compliance; it does not transfer any
          responsibility for your content to SkillsetMind. Courses may be returned
          for changes, paused, or removed if they fail quality, trust,
          payment, or content standards.
        </p>
      </LegalSection>

      <LegalSection heading="5. Education, not treatment">
        <p>
          SkillsetMind serves psychologists, therapists, and personal-development
          professionals, so this boundary is strict:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Courses must be educational. A course may teach methods,
            frameworks, and skills; it may not deliver individualized clinical
            care, diagnosis, or treatment disguised as a course.
          </li>
          <li>
            You may not use courses, communities, or live sessions to create a
            therapist-client relationship with students, nor present course
            participation as a substitute for therapy or medical treatment.
          </li>
          <li>
            Courses on clinical or mental-health topics must include a clear
            disclaimer that the content is educational and does not replace
            professional care.
          </li>
          <li>
            If your professional regulations (licensing board, professional
            council, or local law) restrict what you may offer online, you are
            responsible for complying with them.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Your students and their data">
        <p>
          Consistent with The Promise: your student list is yours. You can see
          the name, email, enrollment date, and progress of students in your
          courses, and you can export your content and your student data at
          any time. If you leave SkillsetMind, you take them with you.
        </p>
        <p>
          In return, you must treat student data lawfully: use it to run and
          support your courses and your own communication with your students,
          never sell it, and honor applicable privacy law (GDPR, LGPD, CCPA)
          for the data you export. Do not share one student&apos;s personal
          information with other students.
        </p>
      </LegalSection>

      <LegalSection heading="7. Pricing, commission, and payouts">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong className="text-[var(--color-ink)]">Checkout</strong> — all
            sales of your courses on SkillsetMind go through the platform&apos;s
            Stripe checkout. Directing platform buyers to an off-platform
            checkout for the same course is prohibited.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Commission</strong> —
            SkillsetMind keeps a commission on each sale according to your
            subscription plan, as shown on the{" "}
            <Link className="font-semibold text-[var(--color-accent-fg)]" href="/pricing">
              pricing page
            </Link>{" "}
            at the time of sale.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Payouts</strong> —
            paid via Stripe Connect to the account you connect, with support
            for 30+ currencies. Sale proceeds clear{" "}
            <strong className="text-[var(--color-ink)]">
              {payoutClearDays} days
            </strong>{" "}
            after the sale, so a payout can never precede a still-refundable
            charge. You must complete Stripe&apos;s identity verification to
            receive payouts.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Refunds and chargebacks</strong>{" "}
            — student refunds within the {refundWindowDays}-day window, and
            any chargebacks, are deducted from the corresponding sale proceeds
            (commission included). Repeated abnormal chargeback rates may lead
            to review of your account.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="8. Taxes">
        <p>
          You are responsible for your own taxes on your earnings, including
          income tax and any VAT/GST or local obligations that apply to you as
          an independent professional. SkillsetMind and Stripe may issue tax forms
          or collect tax information where the law requires.
        </p>
      </LegalSection>

      <LegalSection heading="9. Marketing claims">
        <p>
          Your course pages, testimonials, and promotions must be truthful.
          Do not guarantee clinical outcomes, cures, or income results.
          Testimonials must be genuine and may not imply results that are not
          typical.
        </p>
      </LegalSection>

      <LegalSection heading="10. Suspension, removal, and leaving">
        <p>
          We may pause or remove a course, or suspend an educator account,
          for violation of these terms, with notice and a chance to fix the
          issue where the violation is fixable. Fraud, credential
          misrepresentation, or student-safety issues may lead to immediate
          removal.
        </p>
        <p>
          If a course is removed or you close your account, students who
          already bought it keep access to what they purchased (or receive a
          refund handled per the refund policy), pending payouts for
          legitimate cleared sales are still paid out, and you may export your
          content and student data beforehand.
        </p>
      </LegalSection>

      <LegalSection heading="11. Indemnification and liability">
        <p>
          You will indemnify SkillsetMind against claims arising from your
          content, your professional conduct, your marketing claims, or your
          handling of student data. The warranty disclaimers and liability
          limits in the{" "}
          <Link className="font-semibold text-[var(--color-accent-fg)]" href="/legal/terms">
            Terms of Service
          </Link>{" "}
          apply equally to your educator activity.
        </p>
      </LegalSection>

      <LegalSection heading="12. Changes and contact">
        <p>
          Material changes to these terms — especially to commission or payout
          mechanics — will be announced before they take effect, and we will
          update the effective date above. Questions: <SupportLink /> or{" "}
          <a
            className="font-semibold text-[var(--color-accent-fg)]"
            href={`mailto:${LEGAL_EMAIL}`}
          >
            {LEGAL_EMAIL}
          </a>
          . Governing law
          and dispute resolution follow the{" "}
          <Link className="font-semibold text-[var(--color-accent-fg)]" href="/legal/terms">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
