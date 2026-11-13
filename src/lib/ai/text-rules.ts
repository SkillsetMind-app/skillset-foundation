// Trava de saída para o texto que a IA escreve para o professor (título,
// descrição, quiz). A regra da casa: a plataforma não redige promessa de
// resultado ou de renda nem alegação de saúde. Se redigir, a responsabilidade
// vira nossa. O prompt já pede isso; esta lista é o cinto além do suspensório.
//
// Não vale para a legenda: ali a IA transcreve e traduz o que o PROFESSOR disse.
//
// ponytail: lista de palavras, não classificador. Pega o óbvio ("guaranteed",
// "cure", "$5k a month") e deixa passar paráfrase. Quem decide é o professor,
// que revisa tudo antes de usar; endureça com exemplos reais se aparecerem.
const RESULT_OR_INCOME =
  /\bguarantee(?:d|s)?\b|\bresults? guaranteed\b|\b(?:make|earn|making|earning)\s+(?:\$|\d|money|six figures|a living)|\$\s?\d[\d,.]*\s?(?:k\b)?\s*(?:\/|a|per)\s*(?:day|week|month|year)\b|\bsix[- ]figures?\b|\bpassive income\b|\bget rich\b|\bfinancial freedom\b|\bquit your job\b|\bgarantizad[oa]s?\b|\bgana(?:r)? dinero\b/i;

const HEALTH_OR_THERAPY =
  /\bcur(?:e|es|ed|ing)\b|\bheal(?:s|ed|ing)?\b|\btreat(?:s|ed|ing|ment|ments)?\b|\bdiagnos\w*|\btherap(?:y|ies|ist|ists|eutic)\b|\bpsychotherap\w*|\bcounsell?or\w*|\bclinical(?:ly)?\b|\bcurar\b|\bsanar\b|\btratamiento\b|\bterapia\b|\bterapeuta\b/i;

export function breaksTextRules(text: string): boolean {
  return RESULT_OR_INCOME.test(text) || HEALTH_OR_THERAPY.test(text);
}
