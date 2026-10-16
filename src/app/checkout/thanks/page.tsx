import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GuestAccessLink } from "@/components/courses/guest-access-link";
import { SiteNav } from "@/components/site/site-nav";
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

// Where Stripe sends a guest buyer after paying. The buyer is not signed in, so
// access goes by e-mail: the address comes from the cookie the guest checkout
// set (shown masked), and the sign-in link is sent from here.
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
      <SiteNav />
      <main id="conteudo" className="mx-auto w-full max-w-xl px-6 py-10 sm:px-8 sm:py-14">
        <h1 className="display-title page-title break-words text-[var(--color-ink)]">
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
