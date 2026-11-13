import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

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
      {/* O mesmo cabeçalho da página de compra: quem acabou de pagar continua
          no mesmo lugar, e o próximo passo é o e-mail, não o menu do site. */}
      <CheckoutHeader secureLabel={t("publicCourses.checkoutSecure")} skipLabel={t("nav.skipToContent")} />
      <main id="conteudo" className="mx-auto w-full max-w-xl px-6 py-10 sm:px-8 sm:py-14">
        <span className="grid size-14 place-items-center rounded-full bg-[var(--color-success-soft)] text-[var(--color-success-fg)]">
          <MailCheck aria-hidden="true" size={28} strokeWidth={1.8} />
        </span>
        <h1 className="display-title page-title mt-5 break-words text-[var(--color-ink)]">
          {t("guestCheckout.thanks.title")}
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--color-ink-soft)]">{t("guestCheckout.thanks.body")}</p>
        {pending ? (
          <GuestAccessLink maskedEmail={maskEmail(pending.email)} />
        ) : (
          <p className="mt-6 info-notice">{t("guestCheckout.thanks.noEmail")}</p>
        )}
        <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
          {t("guestCheckout.thanks.haveAccount")}{" "}
          <Link
            href={`/login?returnTo=${encodeURIComponent(coursePath)}`}
            className="font-semibold text-[var(--color-primary)]"
          >
            {t("guestCheckout.form.signIn")}
          </Link>
        </p>
      </main>
    </div>
  );
}
