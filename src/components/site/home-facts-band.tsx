import { PLAN_TRIAL_DAYS } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";
import { supportedStripeCurrencies } from "@/lib/payments/currencies";

// Faixa de fatos logo abaixo do topo, no lugar dos números de receita, alunos
// e países que a concorrência mostra. Só entra o que já é verdade e já está
// escrito no site: as 30 moedas do checkout, os 24 meses da Promessa 01, os
// seis compromissos dela e o 14-day free trial. Nada aqui fala de ganho. A
// Promessa 01 trava a comissão e a tarifa por venda, não o preço do plano: a
// legenda diz exatamente isso, para não parecer falsa no dia em que os planos
// mudarem de preço. Onde o número mora no código (moedas, dias do teste) ele
// vem de lá, para a faixa não descolar do produto. A legenda do teste começa
// em minúscula, porque continua o número: "14" + "day free trial, card
// required" se lê "14-day free trial". Os números são estáticos: o movimento (aparecer e subir 12px,
// um depois do outro) existe só no globals.css, atrás das mesmas travas da
// coreografia da home, e fora delas a faixa fica parada e inteira.
export async function HomeFactsBand() {
  const { t } = await getServerTranslation();
  const facts: ReadonlyArray<{ figure: string; label: string }> = [
    { figure: String(supportedStripeCurrencies.length), label: t("home.facts.currencies") },
    { figure: t("home.facts.feeLockMonths"), label: t("home.facts.feeLock") },
    { figure: t("home.facts.commitmentsCount"), label: t("home.facts.commitments") },
    { figure: String(PLAN_TRIAL_DAYS), label: t("home.facts.trial") },
  ];

  return (
    <section
      aria-labelledby="home-facts-title"
      className="home-facts border-b fine-rule bg-[var(--color-surface-soft)] py-12 sm:py-14 lg:py-16"
    >
      <h2 id="home-facts-title" className="sr-only">
        {t("home.facts.title")}
      </h2>
      {/* 2x2 no celular, 4 colunas do lg. O número fica sempre abaixo do
          título do topo (clamp(2.3rem, 4.6vw, 3.6rem)) em qualquer largura;
          a legenda é texto corrido: 17/18px na cor cheia. A caixa é a mesma
          do topo e do "How it works" (max-w-7xl com o recuo DENTRO dela):
          com o recuo na faixa, a 1440px a faixa começava 32px à esquerda
          das outras seções. O fundo continua de ponta a ponta. */}
      <dl className="mx-auto grid w-full max-w-7xl grid-cols-2 gap-x-6 gap-y-10 px-5 sm:px-8 lg:grid-cols-4 lg:gap-x-10">
        {facts.map((fact) => (
          <div key={fact.label} className="home-facts__item">
            <dt className="display-title text-[clamp(2.25rem,4.4vw,3.5rem)] leading-none text-[var(--color-primary)]">
              {fact.figure}
            </dt>
            <dd className="mt-4 text-[1.0625rem] leading-[1.5] text-[var(--color-ink)] before:mb-3 before:block before:h-0.5 before:w-10 before:bg-[var(--color-accent)] before:content-[''] md:text-lg">
              {fact.label}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
