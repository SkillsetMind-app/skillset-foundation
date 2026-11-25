import {
  Award,
  Calendar,
  Globe,
  LayoutGrid,
  MessagesSquare,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { getServerTranslation } from "@/lib/i18n/server";

type Capability = {
  title: string;
  description: string;
  Icon: LucideIcon;
};

// Server component: only translated text, no state. It stays out of the browser
// bundle; what needs the client here is RevealSection, which remains a
// client component and is mounted as a child.
export async function CapabilitiesGrid() {
  const { t } = await getServerTranslation();
  const capabilities: ReadonlyArray<Capability> = [
    { title: t("home.capabilities.c1Title"), description: t("home.capabilities.c1Desc"), Icon: LayoutGrid },
    { title: t("home.capabilities.c2Title"), description: t("home.capabilities.c2Desc"), Icon: Calendar },
    { title: t("home.capabilities.c3Title"), description: t("home.capabilities.c3Desc"), Icon: MessagesSquare },
    { title: t("home.capabilities.c4Title"), description: t("home.capabilities.c4Desc"), Icon: Globe },
    {
      title: t("home.capabilities.c5Title"),
      description: t("home.capabilities.c5Desc"),
      Icon: Wallet,
    },
    { title: t("home.capabilities.c6Title"), description: t("home.capabilities.c6Desc"), Icon: Award },
  ];

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      {/* Same title and text scale as the other home sections: 36px
          to 52px, always below the top title (wide, to fit in two
          lines), and 17/18px text in the full color. */}
      <RevealSection className="home-heading max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("home.capabilities.kicker")}
        </p>
        <h2 className="display-title mt-3 text-[clamp(2.25rem,4.2vw,3.25rem)] leading-[1.05] text-[var(--color-primary)]">
          {t("home.capabilities.title")}
        </h2>
        <p className="mt-4 max-w-xl text-[1.0625rem] leading-[1.6] text-[var(--color-ink)] md:text-lg">
          {t("home.capabilities.sub")}
        </p>
      </RevealSection>
      <div className="home-cards mt-10 grid gap-5 sm:mt-12 md:grid-cols-2 xl:grid-cols-3">
        {capabilities.map((capability) => {
          const { Icon } = capability;
          return (
            <RevealSection key={capability.title} className="home-card">
              {/* Reading card, not a link: still on mouse. Lifting and changing
                  the icon color made it look like a button that opens nothing. */}
              <article className="h-full rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
                <span
                  className="grid size-12 place-items-center rounded-md bg-[var(--color-surface-soft)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-line)] shadow-[0_6px_14px_rgba(26,54,93,0.08)]"
                  aria-hidden="true"
                >
                  <Icon size={22} strokeWidth={1.7} />
                </span>
                <h3 className="mt-5 text-lg font-bold text-[var(--color-primary)]">
                  {capability.title}
                </h3>
                <p className="mt-3 text-[1.0625rem] leading-[1.6] text-[var(--color-ink)] md:text-lg">
                  {capability.description}
                </p>
              </article>
            </RevealSection>
          );
        })}
      </div>
    </section>
  );
}
