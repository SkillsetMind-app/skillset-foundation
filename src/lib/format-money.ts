// Dinheiro na tela, uma moeda de cada vez. Nasceu no painel de Ganhos (#580) e
// mora aqui para que Inicio, Relatorios e Ganhos escrevam valor do mesmo jeito.

type MoneyOptions = Pick<
  Intl.NumberFormatOptions,
  "minimumFractionDigits" | "maximumFractionDigits" | "notation"
>;

/**
 * Um valor em UMA moeda, no idioma pedido. Codigo que o Intl recusa
 * ("UNSPECIFIED" das linhas antigas sem moeda, ou vazio) cai em
 * "CODIGO 12.34": um RangeError aqui derrubaria a pagina inteira.
 */
export function formatMoney(
  amountMinor: number,
  currency: string | null | undefined,
  locale: string,
  options: MoneyOptions = {},
): string {
  try {
    return new Intl.NumberFormat(locale, {
      ...options,
      style: "currency",
      currency: currency ?? "",
    }).format(amountMinor / 100);
  } catch {
    return `${currency ?? ""} ${(amountMinor / 100).toFixed(2)}`.trim();
  }
}

/**
 * Varias moedas lado a lado, cada uma no proprio valor ("R$100.00 · $20.00"),
 * na ordem recebida: nada converte, nada soma moedas diferentes. Sem valor
 * nenhum: zero na unica moeda conhecida, ou "0" puro (sem inventar moeda).
 */
export function formatMoneyBreakdown(
  values: ReadonlyArray<{ currency: string; amountMinor: number }>,
  locale: string,
  zeroCurrency: string | null,
  options: MoneyOptions = {},
): string {
  if (!values.length) {
    return zeroCurrency ? formatMoney(0, zeroCurrency, locale, options) : "0";
  }
  return values
    .map((value) => formatMoney(value.amountMinor, value.currency, locale, options))
    .join(" · ");
}
