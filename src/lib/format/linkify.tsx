import type { ReactNode } from "react";

// Bidi controls (ALM, LRM/RLM, LRE..RLO, LRI..PDI), written as escapes on
// purpose: an invisible character in the source is the attack itself. With them the
// link text "reads" one domain and the href goes to another (RLO + reversed URL).
const bidi = "\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069";
const bidiControls = new RegExp(`[${bidi}]`, "gu");

/**
 * A teacher's text -> React with clickable links, without raw HTML.
 * Only http(s) becomes a link: javascript:, data: and "www." without a scheme stay text.
 * The trailing punctuation (. , ) ! ? ; : ') stays outside the link.
 * ponytail: a single regex; a URL that ends in ")" (Wikipedia) loses the ")".
 * Count parentheses if someone complains.
 */
export function linkify(text: string): ReactNode[] {
  // Strips the bidi controls from the whole text; the classes also refuse them.
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
