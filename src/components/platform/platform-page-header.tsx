import type { ReactNode } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * O cabecalho de pagina da plataforma, o unico. Eram cinco sistemas em telas
 * irmas (48px em serifa em Vendas, 36px sem serifa na Home, 30px dentro de um
 * cartao na Midia, 20px no celular...). Agora: rotulo opcional (so quando nomeia
 * um grupo), h1 em serifa de 30px em qualquer largura, uma frase, e as acoes
 * da pagina a direita, sobre a mesma linha de baixo. As telas que montam o
 * proprio cabecalho (o titulo depende do que carregou) usam este mesmo
 * componente com `hideHeader` na casca.
 */
export function PlatformPageHeader({
  eyebrow,
  title,
  description,
  actions,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`platform-page-heading flex flex-wrap items-end justify-between gap-4 ${
        compact ? "platform-page-heading--compact" : ""
      }`}
    >
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1
          className={`display-title ${
            eyebrow ? "mt-2" : ""
          } max-w-4xl text-3xl leading-tight text-[var(--color-primary)]`}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
