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
        <div
          aria-hidden="true"
          className="mx-auto mb-5 size-14 rounded-full border-[3px] border-[rgba(26,54,93,0.12)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin"
        />
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
