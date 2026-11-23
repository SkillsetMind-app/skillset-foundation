import { PenLine, Send, Sparkles, type LucideIcon } from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { getServerTranslation } from "@/lib/i18n/server";

type Step = {
  number: string;
  title: string;
  description: string;
  Icon: LucideIcon;
};

// Server component: só texto traduzido, nenhum estado. Sai do bundle do
// navegador; o que precisa do cliente aqui é o RevealSection, que continua
// cliente e é montado como filho.
export async function HowItWorksStrip() {
  const { t } = await getServerTranslation();

  const steps: ReadonlyArray<Step> = [
    {
      number: "01",
      title: t("home.how.step1Title"),
      description: t("home.how.step1Desc"),
      Icon: PenLine,
    },
    {
      number: "02",
      title: t("home.how.step2Title"),
      description: t("home.how.step2Desc"),
      Icon: Sparkles,
    },
    {
      number: "03",
      title: t("home.how.step3Title"),
      description: t("home.how.step3Desc"),
      Icon: Send,
    },
  ];

  return (
    <section className="home-how__panel mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      {/* Título de seção maior, de 36px no celular a 52px, sempre abaixo do
          título do topo (clamp(2.3rem, 4.6vw, 3.6rem)) em qualquer largura.
          Mais largo (max-w-4xl) para ficar em duas linhas: o painel preso do
          computador precisa caber abaixo da barra. */}
      <RevealSection className="home-heading max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("home.how.kicker")}
        </p>
        <h2 className="display-title mt-3 text-[clamp(2.25rem,4.2vw,3.25rem)] leading-[1.05] text-[var(--color-primary)]">
          {t("home.how.title")}
        </h2>
      </RevealSection>
      <div className="home-steps mt-10 grid gap-8 sm:mt-12 lg:grid-cols-3">
        {steps.map((step) => {
          const { Icon } = step;
          return (
            <RevealSection key={step.number} className="home-step">
              <article className="home-step__line border-t-2 border-[var(--color-primary)] pt-6">
                <div className="flex items-center gap-4">
                  <span
                    className="home-step__icon grid size-11 place-items-center rounded-md bg-[var(--color-primary)] text-[var(--color-base)] shadow-[var(--shadow-soft)]"
                    aria-hidden="true"
                  >
                    <Icon size={20} strokeWidth={1.7} />
                  </span>
                  <p
                    className="home-step__number display-title text-6xl leading-none text-[var(--color-ink-muted)]"
                    aria-hidden="true"
                  >
                    {step.number}
                  </p>
                </div>
                <h3 className="mt-5 text-lg font-bold text-[var(--color-primary)]">
                  {step.title}
                </h3>
                {/* Texto corrido em 17px (18px do md) e na cor de texto cheia,
                    para leitura de quem tem 55+. Do lg para cima os passos
                    viram três colunas estreitas dentro do painel preso, que
                    precisa caber abaixo da barra em 1280x640 e 1024x720 (o
                    passo 3 em espanhol é o mais longo): ali 16px com linha de
                    24px ocupa a mesma altura dos 14px/28px de antes. */}
                <p className="mt-3 text-[1.0625rem] leading-[1.6] text-[var(--color-ink)] md:text-lg lg:text-base lg:leading-6">
                  {step.description}
                </p>
              </article>
            </RevealSection>
          );
        })}
      </div>
    </section>
  );
}
