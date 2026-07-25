import Link from "next/link";

import { LegalArticle, LegalSection } from "@/components/site/legal-article";
import { refundWindowDays } from "@/data/plans";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Refunds and Returns Policy",
  description: `Course purchases on SkillsetMind can be refunded free of charge within ${refundWindowDays} days of purchase.`,
  path: "/refund-policy",
});

const EFFECTIVE_DATE = "July 5, 2026";
const SUPPORT_EMAIL = "support@skillsetmind.com";

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

export default function RefundPolicyPage() {
  return (
    <LegalArticle
      kicker="Legal"
      title="Refunds and Returns Policy"
      effectiveDate={EFFECTIVE_DATE}
      intro={
        <>
          <p>
            SkillsetMind is the marketplace and checkout for online courses
            sold by independent educators; the educator who published a course
            is its seller and merchant of record. Because courses are digital
            products delivered instantly,
            this policy explains when and how you can get your money back. It is
            part of our{" "}
            <Link
              className="font-semibold text-[var(--color-accent-fg)]"
              href="/legal/terms"
            >
              Terms of Service
            </Link>
            .
          </p>
          <p className="mt-3">
            The short version: course purchases can be refunded free of charge
            within {refundWindowDays} days of purchase.
          </p>
        </>
      }
    >
      <LegalSection heading={`1. Your ${refundWindowDays}-day refund window`}>
        <p>
          You may request a full refund of a course purchase within{" "}
          <strong className="text-[var(--color-ink)]">
            {refundWindowDays} days
          </strong>{" "}
          of the purchase date. There is no fee to request a refund inside this
          window. The refund goes back to your original payment method.
        </p>
        <p>
          The window closes early if a certificate of completion has been issued
          for the course, or if the course has been substantially completed,
          whichever happens first. This keeps the guarantee fair for the
          educators who create the content.
        </p>
      </LegalSection>

      <LegalSection heading="2. What can be refunded">
        <p>
          This policy covers one-time course purchases. Free enrollments have
          nothing to refund. Refunds are issued in the same currency you were
          charged.
        </p>
      </LegalSection>

      <LegalSection heading="3. Educator subscriptions">
        <p>
          Educator plan subscriptions are billed on a recurring basis. You can
          cancel a subscription at any time from your{" "}
          <Link
            className="font-semibold text-[var(--color-accent-fg)]"
            href="/account"
          >
            account billing page
          </Link>{" "}
          and you keep access until the end of the period you already paid for.
          Recurring subscription charges are not automatically prorated or
          refunded for partial periods, except where required by law.
        </p>
      </LegalSection>

      <LegalSection heading="4. How to request a refund">
        <p>
          Request a refund from your{" "}
          <Link
            className="font-semibold text-[var(--color-accent-fg)]"
            href="/account"
          >
            account billing page
          </Link>{" "}
          or by emailing <SupportLink /> with the course name and the email on
          your account. A request made from your billing page inside the{" "}
          {refundWindowDays}-day window is submitted to Stripe without manual
          review, as long as the purchase still meets the conditions in Section 1
          and you have not already been refunded for the same course. Requests
          sent by email, requests made after the window, and repeat requests for
          a course that was already refunded are reviewed within a few business
          days. How long a refunded amount then takes to reach your statement is
          set by your bank and card issuer — see Section 5.
        </p>
      </LegalSection>

      <LegalSection heading="5. How refunds are paid">
        <p>
          Approved refunds are created on the educator&apos;s Stripe account —
          the account that took your payment — and returned through Stripe to
          the original payment method used at checkout. The refunded amount is
          debited from the educator, and the platform fee SkillsetMind charged
          on that sale is returned to the educator with it. Depending on your
          bank or card issuer, it can take several business days for the amount
          to appear on your statement.
        </p>
      </LegalSection>

      <LegalSection heading="6. After the refund window">
        <p>
          After the {refundWindowDays}-day window, refunds are granted at our
          discretion, for example if a course was materially not as described.
          Nothing in this policy limits any non-waivable rights you have under
          the consumer-protection law of your country of residence, which may
          give you additional or longer rights.
        </p>
      </LegalSection>

      <LegalSection heading="7. Contact">
        <p>
          Questions about a refund? Email <SupportLink /> and we will help.
        </p>
      </LegalSection>
    </LegalArticle>
  );
}
