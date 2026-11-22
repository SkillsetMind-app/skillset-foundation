import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui";

/**
 * O quadro de numero do estudio, um desenho so. Eram sete: azul com numero de
 * 36px na Home, cinza de 24px em Relatorios, peso 900 em Ganhos, faixa sem
 * cartao em Eventos... e nenhum com algarismos de largura fixa, entao numeros
 * em fila nao se alinhavam. Cartao branco, rotulo de 12px em maiusculas,
 * numero em `.num` (tabular) de 24px, dica opcional de 12px.
 *
 * O valor vem pronto de quem chama: cada tela sabe quando o numero e
 * "Unavailable" (leitura que falhou nunca vira zero). `unavailable` so muda a
 * cara, para a palavra nao parecer um numero.
 *
 * `labelAs="dt"`: o quadro mora num <dl> e vira dt/dd; senao o rotulo e o
 * elemento pedido (p, h2, h3), conforme a ordem de titulos da tela.
 */
export function MetricCard({
  label,
  value,
  hint,
  trend,
  icon: Icon,
  loading = false,
  unavailable = false,
  labelAs: Label = "p",
  srOnlyHint = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  trend?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
  unavailable?: boolean;
  labelAs?: "p" | "dt" | "h2" | "h3";
  /** A dica so para o leitor de tela (faixas estreitas, como Eventos). */
  srOnlyHint?: boolean;
}) {
  const Item = Label === "dt" ? "dd" : "p";
  const title = (
    <Label className="break-words text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
      {label}
    </Label>
  );
  return (
    <Card as={Label === "dt" ? "div" : "article"} padding="sm">
      {/* Num <dl> o dt fica filho direto do grupo: o icone so existe fora dele. */}
      {Icon ? (
        <div className="flex items-start justify-between gap-3">
          {title}
          <Icon aria-hidden="true" size={16} className="shrink-0 text-[var(--color-accent-fg)]" />
        </div>
      ) : (
        title
      )}
      {loading ? (
        <Item className="mt-3 h-8 w-24 animate-pulse rounded bg-[var(--color-surface-strong)]" />
      ) : (
        <Item
          className={
            unavailable
              ? "mt-3 text-base font-semibold leading-8 text-[var(--color-ink-soft)]"
              : "num mt-3 break-words text-2xl font-bold leading-8 text-[var(--color-primary)]"
          }
        >
          {value}
        </Item>
      )}
      {!loading && trend ? <div className="mt-2">{trend}</div> : null}
      {hint ? (
        <Item className={srOnlyHint ? "sr-only" : "mt-2 text-xs leading-5 text-[var(--color-ink-soft)]"}>{hint}</Item>
      ) : null}
    </Card>
  );
}
