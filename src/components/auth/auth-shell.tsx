import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { brand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
};

export async function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: AuthShellProps) {
  const { t } = await getServerTranslation();

  // Two short, factual role lines for the showcase footer (no claims/stats).
  const roleLines: ReadonlyArray<readonly [string, string]> = [
    [t("auth.shell.learnersLabel"), t("auth.shell.learnersDesc")],
    [t("auth.shell.educatorsLabel"), t("auth.shell.educatorsDesc")],
  ];

  return (
    <main className="page-shell min-h-screen">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl gap-8 px-5 py-6 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch lg:gap-10">
        {/* Showcase panel — the brand photo on navy with overlaid copy. Faithful
            to the DESIGN V2 .mb-auth-show; hidden under lg so mobile is form-only. */}
        <section className="relative hidden min-h-[600px] overflow-hidden rounded-[16px] lg:flex">
          <Image
            src="/brand/hero/auth-portrait.jpg"
            alt=""
            fill
            priority
            // Cover is height-driven in this tall panel; track viewport height.
            sizes="(min-width: 1024px) 60vw, 0px"
            // ponytail: tuned to keep her face centred in the tall left panel;
            // nudge the x% if the crop ever frames her off-centre.
            className="object-cover [object-position:40%_center]"
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(7,9,13,0.28), rgba(7,9,13,0.82))",
            }}
          />
          <div className="relative z-10 flex w-full flex-col justify-between p-10 sm:p-12">
            <Image
              src={brand.logoFullDark}
              alt={brand.name}
              width={brand.logoFullDarkSize.width}
              height={brand.logoFullDarkSize.height}
              priority
              className="h-12 w-auto object-contain"
            />
            <div className="max-w-[30ch]">
              <span className="mb-5 inline-block rounded-full border border-white/30 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-white/80">
                {eyebrow}
              </span>
              <h1 className="display-title text-[clamp(2rem,3.4vw,3.1rem)] leading-[1.05] text-white">
                {title}
              </h1>
              <p className="mt-4 text-[15.5px] leading-[1.6] text-white/82">
                {description}
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              {roleLines.map(([role, rest]) => (
                <span
                  key={role}
                  className="inline-flex items-center gap-2.5 text-[13.5px] font-medium text-white/85"
                >
                  <Check size={16} className="shrink-0 text-white/85" aria-hidden="true" />
                  <span>
                    <strong className="font-bold text-white">{role}</strong>: {rest}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Form panel — vertically centred; carries the brand mark on mobile
            where the showcase is hidden. */}
        <section className="flex flex-col justify-center rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)] sm:p-7">
          <LogoWordmark compact className="mb-6 lg:hidden" />
          {children}
          <div className="mt-4 border-t border-[var(--color-line)] pt-4 text-sm text-[var(--color-ink-soft)]">
            {footer}
          </div>
          <Link
            href="/"
            className="mt-3 inline-flex text-sm font-semibold text-[var(--color-primary)]"
          >
            {t("auth.shell.backToHomepage")}
          </Link>
        </section>
      </div>
    </main>
  );
}
