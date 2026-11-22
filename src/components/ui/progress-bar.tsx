import { cn } from "@/lib/cn";

/**
 * Eram 15 barras feitas à mão, em 3 alturas e 8 cores de trilho; seis trilhos
 * (navy a 12%) sumiam no tema escuro e 0% parecia "sem barra". Uma só aqui:
 * 6px, cantos redondos, trilho --color-line (passa de 3:1 nos dois temas) e
 * preenchimento latão, a cor do progresso da pessoa.
 *
 * O número continua com quem chama (cada tela tem o seu formato); a barra só
 * desenha e diz o valor ao leitor de tela.
 */
export type ProgressBarProps = {
  /** Porcentagem, de 0 a 100. Fora disso é cortada nas pontas. */
  value: number;
  /** Nome acessível da barra ("Progress", "40% complete"). */
  label: string;
  /** Trilho: margem, largura ou a cor sobre foto e sobre o tema de um curso. */
  className?: string;
  /** Preenchimento: só para a cor de destaque de uma área de membros. */
  fillClassName?: string;
};

export function ProgressBar({ value, label, className, fillClassName }: ProgressBarProps) {
  const percent = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]", className)}
    >
      {/* Desliza com transform, não com width: o contrato de movimento só anima
          transform e opacity, e só para quem não pediu menos movimento. */}
      <div
        className={cn(
          "h-full w-full rounded-full bg-[var(--color-accent)] motion-safe:transition-transform motion-safe:duration-[var(--duration-slow)] motion-safe:ease-[var(--ease-standard)]",
          fillClassName,
        )}
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </div>
  );
}
