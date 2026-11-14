// Trava de saída para o texto que a IA escreve para o professor (título,
// descrição, quiz). A regra da casa: a plataforma não redige promessa de
// resultado ou de renda nem alegação de saúde. Se redigir, a responsabilidade
// vira nossa. O prompt já pede isso; esta lista é o cinto além do suspensório.
//
// Não vale para a legenda: ali a IA transcreve e traduz o que o PROFESSOR disse.
//
// ponytail: lista de palavras, não classificador. Pega o óbvio e deixa passar
// paráfrase; o professor revisa tudo antes de usar. Cada termo de saúde é
// amarrado a um alvo de saúde, para não barrar coaching comum ("treat
// yourself", "diagnose your funnel", "money-back guarantee", "make 3 calls").
// Endureça com exemplos reais quando aparecerem.

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

// Frases que NOMEIAM o limite da prática (encaminhar a um profissional, "isto
// não é terapia") são justamente o que a casa quer: saem antes do teste.
const SCOPE_OF_PRACTICE =
  /\brefer\w*\s+(?:\w+\s+){0,4}to\s+(?:a\s+)?(?:licensed\s+)?(?:therapist|counsell?or|mental health professional|doctor|physician)s?\b|\b(?:is\s+not|isn't|not)\s+(?:a\s+)?(?:therapy|therapist|treatment|counsell?ing)\b/gi;

export function breaksTextRules(text: string): boolean {
  const rest = text.replace(SCOPE_OF_PRACTICE, " ");
  return RESULT_OR_INCOME.test(rest) || HEALTH_OR_THERAPY.test(rest);
}
