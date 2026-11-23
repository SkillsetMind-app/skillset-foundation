import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { getServerTranslation } from "@/lib/i18n/server";

// As perguntas que um coach de 55+ faz antes de se cadastrar, só as que a
// central de ajuda já responde: [categoria do /help, posição nela]. Pergunta
// e resposta são as mesmas chaves do /help (publicPages.helpFaq), sem reescrever
// nada, e cada resposta termina com o link para a categoria dela no /help.
// Ficou de fora "preciso saber mexer com tecnologia?": a central não responde.
const QUESTIONS = [
  ["plans", 0], // Qual plano: preço, comissão e o 14-day free trial.
  ["payouts", 0], // O comprador paga direto ao professor, e quando o dinheiro cai.
  ["plans", 2], // Cancelar, inclusive durante o teste, sem cobrança.
  ["refunds", 0], // Reembolso.
  ["course-creation", 0], // O próprio professor sobe o curso.
  ["integrations", 0], // Vídeo e arquivos hospedados na plataforma, nada a configurar.
] as const;

// <details>/<summary> nativo: abre e fecha pelo teclado, sem JavaScript. A
// seta gira ao abrir; com movimento reduzido ela troca de posição sem andar.
export async function HomeFaq() {
  const { t } = await getServerTranslation();

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      <RevealSection className="home-heading max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("footer.helpCenter")}
        </p>
        <h2 className="display-title mt-3 text-[clamp(2.25rem,4.2vw,3.25rem)] leading-[1.05] text-[var(--color-primary)]">
          {t("publicPages.pricing.common_questions")}
        </h2>
      </RevealSection>
      <div className="mt-10 grid max-w-4xl gap-3 sm:mt-12">
        {QUESTIONS.map(([category, index]) => {
          const key = `publicPages.helpFaq.${category}.items.${index}`;
          const questionId = `home-faq-${category}-${index}`;
          return (
            <details
              key={key}
              className="group rounded-lg border fine-rule bg-white shadow-[var(--shadow-soft)] [&_summary::-webkit-details-marker]:hidden"
            >
              {/* Pergunta em 18px e alvo de toque de 56px (público de 55+); o
                  anel de foco é o global do <summary>. */}
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-5 py-4 text-lg font-semibold leading-snug text-[var(--color-ink)]">
                <span id={questionId}>{t(`${key}.q`)}</span>
                <ChevronDown
                  aria-hidden="true"
                  size={22}
                  strokeWidth={2.2}
                  className="shrink-0 text-[var(--color-primary)] group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-[var(--duration-base)] motion-safe:ease-[var(--ease-standard)]"
                />
              </summary>
              <div className="px-5 pb-6">
                <p className="text-[1.0625rem] leading-[1.6] text-[var(--color-ink)] md:text-lg">
                  {t(`${key}.a`)}
                </p>
                {/* O mesmo texto nos seis links: a pergunta entra como
                    descrição, para a lista de links do leitor de tela. */}
                <Link
                  href={`/help#${category}`}
                  aria-describedby={questionId}
                  className="mt-3 inline-flex min-h-12 items-center gap-2 text-base font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
                >
                  {t("home.faq.more")}
                  <ArrowRight aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
                </Link>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
