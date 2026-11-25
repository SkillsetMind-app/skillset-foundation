import { getImageProps } from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { formatUsdWhole } from "@/data/platform";
import { formatPlanCommission, publicPlans } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";

// Server component: translated text and one photo, no state. It stays out of the
// browser bundle; what needs the client here is RevealSection, which remains a
// client component and is mounted as a child.
export async function ForCreatorsBand() {
  const { t } = await getServerTranslation();

  const trustBullets = [
    t("home.creators.bullet2"),
    t("home.creators.bullet3"),
    t("home.creators.bullet4"),
  ];

  // The band photo (made by AI, a person who does not exist) has two crops: 3:4
  // on phones, with the text BELOW it (never white letters over the photo on
  // phones), and 12:5 from md up, with the empty wall on the left for the
  // title. <picture> with getImageProps: the browser downloads only one of the
  // two, and lazily (the band is at the end of the page; the top LCP does not change).
  const photoAlt = t("home.creators.photoAlt");
  const wide = getImageProps({ src: "/brand/home/home-cta-desktop.avif", alt: photoAlt, fill: true, sizes: "100vw" }).props;
  const tall = getImageProps({ src: "/brand/home/home-cta-mobile.avif", alt: photoAlt, fill: true, sizes: "100vw" }).props;

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:max-w-none lg:px-0 lg:py-24">
      <RevealSection className="home-creators">
        {/* Phone and tablet: the usual blue card, with the photo at the top of it.
            From lg up the band runs edge to edge: the 12:5 photo sits
            behind the title, which lives on the empty wall (left half), and the
            plans and the three items come right below the photo. */}
        <div className="relative overflow-hidden rounded-lg bg-[var(--color-primary)] text-white shadow-[var(--shadow-strong)] [--focus-ring:#fff] lg:rounded-none lg:shadow-none">
          <div className="absolute inset-0 bg-gradient-to-br from-[#07172a] via-[#102944] to-[#1a365d]" />
          <div className="relative lg:flex lg:aspect-[12/5] lg:min-h-[28rem] lg:items-center">
            {/* At lg the bottom of the photo dissolves into the band's blue (mask) and
                a gradient darkens the wall behind the text. The person stays in the
                right third: if the band gets taller than 12:5, the crop comes
                off the wall (object-right). */}
            <div className="home-creators__photo relative aspect-[3/4] overflow-hidden md:aspect-[12/5] lg:absolute lg:inset-0 lg:aspect-auto lg:[mask-image:linear-gradient(to_bottom,#000_80%,transparent)]">
              <picture>
                {/* 48rem, same as Tailwind's md: with a larger default font in the browser,
                    a fixed 768px brought the wide crop into the 3:4 frame. */}
                <source media="(min-width: 48rem)" srcSet={wide.srcSet} sizes={wide.sizes} />
                <img {...tall} alt={photoAlt} className="object-cover object-right" />
              </picture>
              <div
                aria-hidden="true"
                className="absolute inset-0 hidden lg:block"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(7,23,42,0.78) 0%, rgba(7,23,42,0.78) 46%, rgba(7,23,42,0.55) 50%, rgba(7,23,42,0) 57%)",
                }}
              />
            </div>
            <div className="relative z-10 w-full p-6 sm:p-8 lg:mx-auto lg:max-w-7xl lg:py-12">
              <div className="home-creators__lead lg:max-w-[min(36rem,50%)]">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/75 lg:text-white">
                  {t("home.creators.eyebrow")}
                </p>
                <h2 className="display-title mt-3 text-[clamp(2.25rem,4.2vw,3.25rem)] leading-[1.05] text-white">
                  {t("home.creators.title")}
                </h2>
                {/* 48px target on both links (55+ audience). */}
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    href="/auth?mode=signup&path=teacher"
                    className="button-solid-light group inline-flex min-h-12 items-center gap-2 px-4 py-2.5 text-sm"
                  >
                    {t("home.creators.ctaStart")}
                    <ArrowRight
                      aria-hidden="true"
                      size={16}
                      strokeWidth={2}
                      className="transition-transform duration-200 group-hover:translate-x-0.5"
                    />
                  </Link>
                  <Link
                    href="/promise"
                    className="inline-flex min-h-12 items-center px-2 py-3 text-sm font-semibold text-white underline-offset-4 transition hover:text-white hover:underline"
                  >
                    {t("home.creators.ctaPromise")}
                  </Link>
                </div>
              </div>
            </div>
          </div>
          {/* Three columns for the three items from md up (the band takes the
              full width): with two, the third sat alone at half
              width. The plans take a full row above them. */}
          <div className="relative z-10 px-6 pb-6 sm:px-8 sm:pb-8 lg:mx-auto lg:max-w-7xl lg:pb-12">
            <div className="grid gap-3 md:grid-cols-3">
              {/* The 3 plans with price, monthly and yearly, in the home's
                  fine print (decision of 13/11/2026). */}
              <div className="home-creators__item rounded-lg border border-white/16 bg-white/10 p-4 text-sm leading-6 text-white/85 md:col-span-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
                  {t("home.creators.plansLabel")}
                </p>
                <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                  {publicPlans.map((plan) => (
                    <li key={plan.id}>
                      <span className="block font-bold text-white">{plan.name}</span>
                      <span className="block">
                        {t("home.creators.planPrice")
                          .replace("{monthly}", () => formatUsdWhole(plan.monthlyUsd))
                          .replace("{yearly}", () => formatUsdWhole(plan.yearlyUsd))}
                      </span>
                      <span className="block text-white/70">
                        {plan.commissionPercent === 0
                          ? t("home.creators.planFeeZero")
                          : t("home.creators.planFee").replace("{fee}", () => formatPlanCommission(plan))}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs leading-5 text-white/70">{t("home.creators.plansNote")}</p>
              </div>
              {/* No second entrance inside here: the whole band already enters
                  at once, and the items used to drip in one by one. The three items are
                  the running text of the band: 17/18px, without changing the light tone (the
                  band is navy blue). The plans stay in the fine print. */}
              {trustBullets.map((bullet) => (
                <div key={bullet} className="home-creators__item flex h-full items-start gap-3 rounded-lg border border-white/16 bg-white/10 p-4 text-[1.0625rem] leading-[1.6] text-white/85 md:text-lg">
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-accent)]/30 text-[var(--color-accent-soft)]"
                  >
                    <Check size={14} strokeWidth={2.4} />
                  </span>
                  <span>{bullet}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </RevealSection>
    </section>
  );
}
