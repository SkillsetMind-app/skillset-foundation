import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";

import { PaymentReturnCard } from "@/components/account/payment-return-card";
import { GuestAccessLink } from "@/components/courses/guest-access-link";
import { CheckoutHeader } from "@/components/site/checkout-header";
import { getServerTranslation } from "@/lib/i18n/server";
import { maskEmail } from "@/lib/payments/guest-checkout";
import {
  decodeGuestCheckoutCookie,
  GUEST_CHECKOUT_COOKIE,
  isGuestCheckoutConfigured,
} from "@/lib/payments/server/guest-checkout";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return {
    title: `${t("guestCheckout.thanks.title")} | SkillsetMind`,
    robots: { index: false, follow: false },
  };
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// Where Stripe sends a guest buyer after checkout. The buyer is not signed in,
// so access goes by e-mail: the paid sale sends the sign-in link (Stripe
// webhook), and this page names the address from the cookie the guest checkout
// set (masked) and offers a resend. It does not confirm the payment itself, so
// its words never claim one.
export default async function CheckoutThanksPage({ searchParams }: PageProps) {
  // Same switch as the guest checkout routes: off means this page does not exist.
  if (!isGuestCheckoutConfigured()) notFound();
  const { t } = await getServerTranslation();
  const pending = decodeGuestCheckoutCookie((await cookies()).get(GUEST_CHECKOUT_COOKIE)?.value);
  const params = (await searchParams) ?? {};
  const courseParam = typeof params.course === "string" ? params.course.slice(0, 160) : "";
  const courseId = pending?.courseId ?? courseParam;
  const coursePath = courseId ? `/learn/courses/${encodeURIComponent(courseId)}` : "/learn";

  return (
    <div className="page-shell">
      {/* The same header as the purchase page: whoever just paid stays
          in the same place, and the next step is the email, not the site menu. */}
      <CheckoutHeader secureLabel={t("publicCourses.checkoutSecure")} skipLabel={t("nav.skipToContent")} />
      <main id="conteudo" className="mx-auto w-full max-w-xl px-6 py-10 sm:px-8 sm:py-14">
        {/* The same card as the other after-payment screens (plan and
            activation fee), with the same sentences and links as before. Here there
            is no shell with a page title: the card sentence is the h1. */}
        <PaymentReturnCard
          headingLevel={1}
          icon={<Mail aria-hidden="true" size={20} />}
          heading={t("guestCheckout.thanks.title")}
          body={t("guestCheckout.thanks.body")}
          actions={
            <div className="grid w-full gap-4">
              {pending ? (
                <GuestAccessLink maskedEmail={maskEmail(pending.email)} />
              ) : (
                <p className="info-notice">{t("guestCheckout.thanks.noEmail")}</p>
              )}
              <p className="text-sm text-[var(--color-ink-soft)]">
                {t("guestCheckout.thanks.haveAccount")}{" "}
                <Link
                  href={`/login?returnTo=${encodeURIComponent(coursePath)}`}
                  className="font-semibold text-[var(--color-primary)]"
                >
                  {t("guestCheckout.form.signIn")}
                </Link>
              </p>
            </div>
          }
        />
      </main>
    </div>
  );
}
