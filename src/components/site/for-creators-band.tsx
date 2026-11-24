import { getImageProps } from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { formatUsdWhole } from "@/data/platform";
import { formatPlanCommission, publicPlans } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";

// Server component: texto traduzido e uma foto, nenhum estado. Sai do bundle do
// navegador; o que precisa do cliente aqui é o RevealSection, que continua
// cliente e é montado como filho.
export async function ForCreatorsBand() {
  const { t } = await getServerTranslation();

  const trustBullets = [
    t("home.creators.bullet2"),
    t("home.creators.bullet3"),
    t("home.creators.bullet4"),
  ];

  // A foto da faixa (feita por IA, pessoa que não existe) tem dois cortes: 3:4
  // no celular, com o texto EMBAIXO dela (nunca letra branca sobre a foto no
  // celular), e 12:5 do md para cima, com a parede vazia à esquerda para o
  // título. <picture> com getImageProps: o navegador baixa só um dos dois, e
  // preguiçoso (a faixa fica no fim da página; o LCP do topo não muda).
  const photoAlt = t("home.creators.photoAlt");
  const wide = getImageProps({ src: "/brand/home/home-cta-desktop.avif", alt: photoAlt, fill: true, sizes: "100vw" }).props;
  const tall = getImageProps({ src: "/brand/home/home-cta-mobile.avif", alt: photoAlt, fill: true, sizes: "100vw" }).props;

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:max-w-none lg:px-0 lg:py-24">
      <RevealSection className="home-creators">
        {/* Celular e tablet: o cartão azul de sempre, com a foto no topo dele.
            Do lg para cima a faixa vai de ponta a ponta: a foto 12:5 fica
            atrás do título, que mora na parede vazia (metade esquerda), e os
            planos e os três itens vêm logo abaixo da foto. */}
        <div className="relative overflow-hidden rounded-lg bg-[var(--color-primary)] text-white shadow-[var(--shadow-strong)] [--focus-ring:#fff] lg:rounded-none lg:shadow-none">
          <div className="absolute inset-0 bg-gradient-to-br from-[#07172a] via-[#102944] to-[#1a365d]" />
          <div className="relative lg:flex lg:aspect-[12/5] lg:min-h-[28rem] lg:items-center">
            {/* No lg a base da foto se dissolve no azul da faixa (máscara) e
                um degradê escurece a parede atrás do texto. A pessoa fica no
                terço direito: se a faixa ficar mais alta que 12:5, o corte sai
                da parede (object-right). */}
            <div className="home-creators__photo relative aspect-[3/4] overflow-hidden md:aspect-[12/5] lg:absolute lg:inset-0 lg:aspect-auto lg:[mask-image:linear-gradient(to_bottom,#000_80%,transparent)]">
              <picture>
                {/* 48rem, igual ao md do Tailwind: com fonte padrao maior no navegador,
                    768px fixos traziam o corte largo para dentro do quadro 3:4. */}
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
                {/* Alvo de 48px nos dois links (público de 55+). */}
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
          {/* Três colunas para os três itens do md para cima (a faixa ocupa a
              largura toda): em duas, o terceiro ficava sozinho com meia
              largura. Os planos ficam numa linha inteira acima deles. */}
          <div className="relative z-10 px-6 pb-6 sm:px-8 sm:pb-8 lg:mx-auto lg:max-w-7xl lg:pb-12">
            <div className="grid gap-3 md:grid-cols-3">
              {/* Os 3 planos com preço, mensal e anual, nas letras miúdas da
                  home (decisão de 13/11/2026). */}
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
              {/* Sem uma segunda entrada aqui dentro: a faixa inteira já entra
                  de uma vez, e os itens pingavam um a um. Os três itens são o
                  texto corrido da faixa: 17/18px, sem mudar o tom claro (a
                  faixa é azul-marinho). Os planos ficam nas letras miúdas. */}
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
