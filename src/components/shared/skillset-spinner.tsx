import type { ReactNode } from "react";

type SkillsetSpinnerProps = {
  title: string;
  /** When true, fills the viewport (centered). Otherwise inline-centered. */
  fullscreen?: boolean;
  /** Fica abaixo do aviso (ex.: "Try again" de uma espera longa), fora da região lida. */
  children?: ReactNode;
};

/**
 * The single canonical SkillsetMind loading visual: an animated circular
 * spinner with one short line. Used everywhere a loading state is shown so the
 * experience is consistent (no second style).
 *
 * Da entrada ao estúdio a pessoa passa por até cinco telas de espera seguidas
 * (/loading, a montagem do roteador, /welcome, a entrevista, a área protegida).
 * Todas usam este componente com a mesma frase: sem título em serifa de 22px
 * nem descrição que muda, a troca de uma tela para a outra não aparece. O
 * `role="status"` faz o leitor de tela ler a frase, o que nenhuma delas fazia.
 */
export function SkillsetSpinner({
  title,
  fullscreen = true,
  children,
}: SkillsetSpinnerProps) {
  const Title = fullscreen ? "h1" : "p";
  const content = (
    <section className="text-center">
      <div role="status">
        <SpinnerRing className="mx-auto mb-5" />
        <Title className="text-base font-semibold text-[var(--color-primary)]">
          {title}
        </Title>
      </div>
      {children}
    </section>
  );

  if (fullscreen) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--color-base)] px-5">
        {content}
      </main>
    );
  }

  return (
    <div className="grid min-h-[280px] place-items-center px-5">{content}</div>
  );
}

/**
 * O anel da casa, sozinho, para quem ja tem a frase e so precisa do sinal
 * (ex.: o icone do cartao de volta do pagamento). Um desenho so de anel: antes
 * havia uma copia a mao com outro trilho.
 *
 * Trilho em `--color-line`: o navy a 12% fixo sumia no tema escuro. O arco
 * latao gira so sem "reduzir movimento"; com ele ligado o anel fica parado e
 * a vista.
 */
export function SpinnerRing({
  size = "lg",
  className = "",
}: {
  size?: "sm" | "lg";
  className?: string;
}) {
  const shape = size === "sm" ? "size-5 border-2" : "size-14 border-[3px]";
  return (
    <span
      aria-hidden="true"
      className={`block ${shape} rounded-full border-[var(--color-line)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin ${className}`.trim()}
    />
  );
}
