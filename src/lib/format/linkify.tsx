import type { ReactNode } from "react";

/**
 * Texto do professor -> React com links clicaveis, sem HTML cru.
 * So http(s) vira link: javascript:, data: e "www." sem esquema ficam texto.
 * A pontuacao do fim (. , ) ! ? ; : ') fica fora do link.
 * ponytail: um regex so; URL que termina em ")" (Wikipedia) perde o ")".
 * Contar parenteses se alguem reclamar.
 */
export function linkify(text: string): ReactNode[] {
  const pattern = /https?:\/\/[^\s<>"]*[^\s<>".,)!?;:']/gi;
  const parts: ReactNode[] = [];
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    parts.push(text.slice(last, match.index));
    parts.push(
      <a
        key={match.index}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className="underline [overflow-wrap:anywhere]"
      >
        {match[0]}
      </a>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}
