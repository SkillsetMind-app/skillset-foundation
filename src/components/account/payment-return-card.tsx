import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

// As telas de depois do pagamento (retorno do plano, visita sem referencia de
// checkout, retorno da taxa de ativacao) tinham cada uma um desenho: uma
// centralizada com icone cinza e um botao de contorno, outra com "THANKS" e
// uma segunda serifa. Agora o mesmo cartao, na mesma ordem: icone redondo,
// frase principal, explicacao e acoes, a principal primeiro e a unica cheia.
// Sem servidor nem estado aqui: as frases e o que confirma (ou nao) o
// pagamento continuam com cada tela.
export function PaymentReturnCard({
  icon,
  heading,
  body,
  actions,
  headingLevel = 2,
}: {
  icon: ReactNode;
  heading: string;
  body: string;
  actions: ReactNode;
  /** Fora da casca da plataforma (sem titulo de pagina), a frase e o h1. */
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <Card padding="lg">
      {/* Uma regiao viva so, a mesma em todos os estados: o leitor de tela le
          a frase principal e, quando ela muda, o resultado. */}
      <div role="status" aria-live="polite">
        <span className="grid size-10 place-items-center rounded-full bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
          {icon}
        </span>
        <Heading className="mt-3 text-lg font-bold leading-[26px] text-[var(--color-ink)]">{heading}</Heading>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-ink-soft)]">{body}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">{actions}</div>
    </Card>
  );
}
