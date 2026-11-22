"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

// Um módulo do currículo da página de venda, que abre e fecha. Botão com
// aria-expanded DENTRO do título (o padrão de sanfona), e não <details>: o
// Safari com VoiceOver achata o conteúdo do <summary>, e quem navega por
// títulos perdia os módulos. O desenho é o mesmo de antes: nome, aulas e
// duração na linha, seta que gira.
export function CourseModuleDisclosure({
  title,
  meta,
  defaultOpen = false,
  headingLevel = 2,
  children,
}: {
  title: string;
  /** "3 lessons · 25 min": o que o módulo tem, visível mesmo fechado. */
  meta: string;
  defaultOpen?: boolean;
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <div className="rounded-lg border fine-rule bg-[var(--color-surface-soft)]">
      <Heading>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-4 py-3 text-left"
        >
          <span className="text-base font-bold text-[var(--color-ink)]">{title}</span>
          {/* O espaço não aparece na grade, mas separa nome e dados no nome
              lido pelo leitor de tela. */}
          {" "}
          <span className="mt-0.5 text-xs font-normal text-[var(--color-ink-soft)]">{meta}</span>
          <ChevronDown
            aria-hidden="true"
            size={18}
            strokeWidth={2.2}
            className={`col-start-2 row-span-2 row-start-1 text-[var(--color-primary)] motion-safe:transition-transform motion-safe:duration-[180ms]${open ? " rotate-180" : ""}`}
          />
        </button>
      </Heading>
      {/* Fechado, as aulas saem da tela e do leitor de tela, como num <details>. */}
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
