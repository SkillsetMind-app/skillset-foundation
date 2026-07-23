// Normalizes an AI reply into calm, plain prose for the chat panels.
//
// The advisor/assistant wording comes from the n8n system prompt, and reasoning
// models default to markdown (**bold**, ## headings, "—" dashes, "- " bullets).
// The panels render the reply raw (whitespace-pre-wrap), so those markers would
// show literally. We strip them here — at the reply sink — so the agent always
// reads as natural writing regardless of what the model emits. The n8n prompt
// carries the same instruction; this is the belt to that suspenders.
//
// Deliberately conservative: hyphen-minus ("first-class", "one-on-one") is left
// alone — only real em/en dashes become commas. snake_case and URLs keep their
// underscores. ponytail: emphasis-only assumption; a literal "2*3" in advice is
// vanishingly rare, so lone-asterisk stripping is fine.
export function toPlainProse(text: string): string {
  if (!text) return "";

  const perLine = text
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "") // "## Heading" -> "Heading"
        .replace(/^\s{0,3}>\s?/, "") // "> quote" -> "quote"
        .replace(/^(\s*)[-*+]\s+/, "$1• "), // "- item" / "* item" -> "• item"
    )
    .join("\n");

  return perLine
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)") // "[text](url)" -> "text (url)"
    .replace(/`+/g, "") // drop code backticks, keep the content
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1") // "**x**" -> "x"
    .replace(/__(.+?)__/g, "$1") // "__x__" -> "x"
    .replace(/\*(\S.*?\S|\S)\*/g, "$1") // "*x*" -> "x" (bullets already converted)
    .replace(/(^|[\s(])_(\S.*?\S|\S)_(?=$|[\s).,!?;:])/g, "$1$2") // "_x_" -> "x", spares snake_case
    .replace(/\s*[—–]\s*/g, ", ") // em/en dash -> comma; hyphen-minus untouched
    .replace(/[ \t]{2,}/g, " ") // collapse runs of spaces
    .trim();
}
