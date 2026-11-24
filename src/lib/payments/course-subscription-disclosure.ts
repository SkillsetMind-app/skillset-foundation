type Translate = (key: string) => string;

export type CourseSubscriptionInterval = "month" | "year";

/**
 * O aviso de renovação automática de um curso por assinatura (US ROSCA,
 * 15 U.S.C. 8403), dito ANTES de o cartão ser pedido: no cartão de compra, ao
 * lado do botão, e na página do Stripe como `custom_text.submit.message`.
 * Uma função só, para os dois dizerem o mesmo preço e o mesmo intervalo.
 *
 * `amountMinor` é o preço de tabela na convenção da casa (valor x 100 em toda
 * moeda): é o que cada renovação cobra. Um cupom só vale na primeira fatura,
 * por isso a frase diz "Charged today, then {price}" em vez de repetir o valor.
 */
export function courseSubscriptionDisclosure({
  t,
  locale,
  amountMinor,
  currency,
  interval,
}: {
  t: Translate;
  locale: string;
  amountMinor: number;
  currency: string;
  interval: CourseSubscriptionInterval;
}): string {
  const price = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountMinor / 100);
  return t(
    interval === "year"
      ? "publicCourses.subscriptionDisclosureYearly"
      : "publicCourses.subscriptionDisclosureMonthly",
  ).replace("{price}", () => price);
}
