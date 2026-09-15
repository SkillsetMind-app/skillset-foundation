import type { ReactNode } from "react";

// Controles bidi (ALM, LRM/RLM, LRE..RLO, LRI..PDI), escritos como escape de
// proposito: caractere invisivel no fonte e o proprio ataque. Com eles o
// texto do link "le" um dominio e o href vai para outro (RLO + URL invertida).
const bidi = "\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069";
const bidiControls = new RegExp(`[${bidi}]`, "gu");

/**
 * Texto do professor -> React com links clicaveis, sem HTML cru.
 * So http(s) vira link: javascript:, data: e "www." sem esquema ficam texto.
 * A pontuacao do fim (. , ) ! ? ; : ') fica fora do link.
 * ponytail: um regex so; URL que termina em ")" (Wikipedia) perde o ")".
 * Contar parenteses se alguem reclamar.
 */
export function linkify(text: string): ReactNode[] {
  // Tira os controles bidi do texto todo; as classes tambem os recusam.
  const clean = text.replace(bidiControls, "");
  const pattern = new RegExp(`https?:\\/\\/[^\\s<>"${bidi}]*[^\\s<>".,)!?;:'${bidi}]`, "giu");
  const parts: ReactNode[] = [];
  let last = 0;
  for (let match = pattern.exec(clean); match; match = pattern.exec(clean)) {
    parts.push(clean.slice(last, match.index));
    parts.push(
      <a
        key={match.index}
        href={match[0]}
        dir="ltr"
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className="underline [overflow-wrap:anywhere]"
      >
        {match[0]}
      </a>,
    );
    last = match.index + match[0].length;
  }
  parts.push(clean.slice(last));
  return parts;
}
