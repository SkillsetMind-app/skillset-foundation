// Output guard for the text the AI writes for the teacher (title,
// description, quiz). The house rule: the platform does not draft promises of
// results or income or health claims. If it did, the responsibility
// would become ours. The prompt already asks for this; this list is the belt on top of the suspenders.
//
// Does not apply to captions: there the AI transcribes and translates what the TEACHER said.
//
// ponytail: word list, not a classifier. Catches the obvious and lets a
// paraphrase through; the teacher reviews everything before using it. Each health term is
// tied to a health target, so ordinary coaching is not blocked ("treat
// yourself", "diagnose your funnel", "money-back guarantee", "make 3 calls").
// Tighten with real examples when they show up.

const HEALTH_TARGET =
  "(?:anxiety|depression|trauma|ptsd|adhd|ocd|insomnia|addiction|disorders?|illness(?:es)?|diseases?|symptoms?|panic attacks?|burnout|grief|cortisol|blood pressure|pain|mental health)";

const RESULT_OR_INCOME = new RegExp(
  [
    "\\bguarantee[ds]?\\s+(?:you\\b|that\\b|your\\b|results?\\b|success\\b|income\\b|clients?\\b|sales\\b)",
    "\\bguaranteed\\s+(?:results?|income|success|money|clients|sales|outcomes?)\\b",
    "\\bresults?\\s+(?:are\\s+)?guaranteed\\b",
    "\\b(?:make|earn|making|earning)\\s+(?:\\$|\\d[\\d,.]*\\s?(?:k\\b|dollars|usd|a (?:day|week|month|year)|per\\b|\\/)|money\\b|six[- ]figures|seven[- ]figures|a living\\b)",
    "\\$\\s?\\d[\\d,.]*\\s?k?\\s*(?:\\/|a\\s|per\\s)\\s*(?:day|week|month|mo|year|yr)\\b",
    "\\$\\s?\\d+k\\s+months?\\b",
    "\\b\\d+[- ]figures?\\b",
    "\\bsix[- ]figures?\\b",
    "\\bpassive income\\b",
    "\\bget rich\\b",
    "\\bfinancial freedom\\b",
    "\\bquit your job\\b",
    "\\breplace your (?:salary|income|job)\\b",
    "\\b(?:double|triple|10x)\\s+your\\s+(?:revenue|income|sales|earnings|money)\\b",
    // español y português
    "\\bgarantizad[oa]s?\\b",
    "\\bgarant[ií]a de resultados\\b",
    "\\bingresos? pasivos?\\b",
    "\\blibertad financiera\\b",
    "\\bgana(?:r)? dinero\\b",
    "\\bgarantid[oa]s?\\b",
    "\\brenda passiva\\b",
    "\\bliberdade financeira\\b",
    "\\bganh(?:ar|e) dinheiro\\b",
  ].join("|"),
  "i",
);

const HEALTH_OR_THERAPY = new RegExp(
  [
    "\\bcur(?:e|es|ed|ing)\\b",
    "\\bheal(?:s|ed|ing)?\\b",
    `\\btreat(?:s|ed|ing)?\\s+(?:your\\s+|the\\s+)?${HEALTH_TARGET}`,
    "\\btreatments?\\b",
    `\\bdiagnos(?:e|es|ed|ing|is)\\s+(?:your\\s+|the\\s+|a\\s+)?${HEALTH_TARGET}`,
    `\\b(?:relieve|relieves|relief from|reduce|reduces|lower|lowers|overcome|overcomes|beat|beats|eliminate|eliminates|end|ends)\\s+(?:your\\s+)?${HEALTH_TARGET}`,
    `\\b${HEALTH_TARGET}\\s+relief\\b`,
    "\\bimmune system\\b",
    "\\bmental illness\\b",
    "\\btherap(?:y|ies|ist|ists|eutic)\\b",
    "\\bpsychotherap\\w*",
    "\\bcounsell?or\\w*",
    "\\bclinical(?:ly)?\\b",
    // español y português
    "\\bcurar\\b",
    "\\bcura\\b",
    "\\bsanar\\b",
    "\\btratamientos?\\b",
    "\\btratamentos?\\b",
    "\\bterapias?\\b",
    "\\bterapeutas?\\b",
  ].join("|"),
  "i",
);

// Phrases that NAME the limit of the practice (referring to a professional, "this
// is not therapy") are exactly what the house wants: they are removed before the test.
const SCOPE_OF_PRACTICE =
  /\brefer\w*\s+(?:\w+\s+){0,4}to\s+(?:a\s+)?(?:licensed\s+)?(?:therapist|counsell?or|mental health professional|doctor|physician)s?\b|\b(?:is\s+not|isn't|not)\s+(?:a\s+)?(?:therapy|therapist|treatment|counsell?ing)\b/gi;

export function breaksTextRules(text: string): boolean {
  const rest = text.replace(SCOPE_OF_PRACTICE, " ");
  return RESULT_OR_INCOME.test(rest) || HEALTH_OR_THERAPY.test(rest);
}
