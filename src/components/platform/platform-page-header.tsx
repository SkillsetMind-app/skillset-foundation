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
 *
 * So no estudio (/teach): a sala do aluno, a conta, o suporte e o painel
 * interno seguem com o cabecalho antigo da casca. Por isso as classes sao
 * utilitarias e nao `.platform-page-heading`, que e a regra deles.
 */
export function PlatformPageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleAside,
  children,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Ao lado do h1, fora dele (o "?" da ajuda): dentro, o leitor de tela lia o
   *  nome do botao como parte do titulo da pagina. */
  titleAside?: ReactNode;
  /** Abaixo da frase, na mesma coluna (um "Learn more" recolhido). */
  children?: ReactNode;
  compact?: boolean;
}) {
  const heading = (
    <h1
      className={`display-title ${
        eyebrow && !titleAside ? "mt-2" : ""
      } max-w-4xl text-3xl leading-tight text-[var(--color-primary)]`}
    >
      {title}
    </h1>
  );
  return (
    <div
      className={`flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5 ${
        compact ? "pt-1" : "pt-2"
      }`}
    >
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        {titleAside ? (
          <div className={`flex items-center gap-2 ${eyebrow ? "mt-2" : ""}`}>
            {heading}
            {titleAside}
          </div>
        ) : heading}
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
