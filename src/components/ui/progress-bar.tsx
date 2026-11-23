import { cn } from "@/lib/cn";

/**
 * Eram 15 barras feitas à mão, em 3 alturas e 8 cores de trilho; seis trilhos
 * (navy a 12%) sumiam no tema escuro e 0% parecia "sem barra". Uma só aqui:
 * 6px, cantos redondos, trilho --color-line (aparece nos dois temas, mas é
 * claro: no tema claro fica ~1.8:1 contra o branco) e preenchimento no latão
 * de texto, --color-accent-fg. O latão de fundo (#c99a46) dava 1.44:1 contra o
 * trilho; o de texto dá ~3.7:1 no claro e ~3.3:1 no escuro, o mínimo de 3:1
 * para o que a barra mostra (theme-tokens.test.tsx confere).
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
  /**
   * Passos ("Step 1 of 2", "Question 3 of 8"): o leitor de tela segue ouvindo
   * o passo, de 1 ao total, e a frase do `label`; o `value` só desenha.
   */
  step?: { current: number; total: number };
};

export function ProgressBar({ value, label, className, fillClassName, step }: ProgressBarProps) {
  const percent = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={step ? step.current : percent}
      aria-valuemin={step ? 1 : 0}
      aria-valuemax={step ? step.total : 100}
      aria-valuetext={step ? label : undefined}
      className={cn("h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]", className)}
    >
      {/* Desliza com transform, não com width: o contrato de movimento só anima
          transform e opacity, e só para quem não pediu menos movimento. */}
      <div
        className={cn(
          "h-full w-full rounded-full bg-[var(--color-accent-fg)] motion-safe:transition-transform motion-safe:duration-[var(--duration-slow)] motion-safe:ease-[var(--ease-standard)]",
          fillClassName,
        )}
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </div>
  );
}
