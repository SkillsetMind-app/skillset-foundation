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

// Server component: só texto traduzido, nenhum estado. Sai do bundle do
// navegador; o que precisa do cliente aqui é o RevealSection, que continua
// cliente e é montado como filho.
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
      <RevealSection className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("home.capabilities.kicker")}
        </p>
        <h2 className="display-title mt-3 text-4xl leading-tight text-[var(--color-primary)] sm:text-5xl">
          {t("home.capabilities.title")}
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("home.capabilities.sub")}
        </p>
      </RevealSection>
      <div className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-2 xl:grid-cols-3">
        {capabilities.map((capability) => {
          const { Icon } = capability;
          return (
            <RevealSection key={capability.title}>
              <article className="group h-full rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] transition duration-[180ms] ease-out hover:-translate-y-0.5 hover:border-[var(--color-line-strong)] hover:shadow-[var(--shadow-strong)]">
                <span
                  className="grid size-12 place-items-center rounded-[10px] bg-[var(--color-surface-soft)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-line)] shadow-[0_6px_14px_rgba(26,54,93,0.08)] transition-all duration-[180ms] ease-out group-hover:bg-[var(--color-primary)] group-hover:text-[var(--color-base)] group-hover:shadow-[0_10px_22px_rgba(26,54,93,0.20)]"
                  aria-hidden="true"
                >
                  <Icon size={22} strokeWidth={1.7} />
                </span>
                <h3 className="mt-5 text-lg font-bold text-[var(--color-primary)]">
                  {capability.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
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
