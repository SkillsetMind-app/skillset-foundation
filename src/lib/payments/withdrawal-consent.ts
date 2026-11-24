/**
 * Quem compra da União Europeia, do Espaço Econômico Europeu ou do Reino Unido
 * tem 14 dias para desistir de uma compra online. Para conteúdo digital que
 * começa na hora, esse direito só termina se a pessoa pedir o acesso imediato
 * E reconhecer que perde o direito (Diretiva 2011/83/UE, art. 16(m); UK
 * Consumer Contracts Regulations 2013, reg. 37). Por isso, para esses países,
 * a compra só segue com a caixa marcada, e o aceite fica guardado com o
 * pagamento e confirmado no e-mail da compra.
 *
 * UE (27) + EEE (Islândia, Liechtenstein, Noruega) + Reino Unido, mais os
 * territórios da UE que têm código de país próprio: as regiões ultraperiféricas
 * francesas (GF, GP, MQ, RE, YT, MF) e Åland (AX).
 */
const WITHDRAWAL_RIGHT_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
  "GB",
  "GF", "GP", "MQ", "RE", "YT", "MF", "AX",
]);

export function requiresWithdrawalConsent(country: string | null | undefined): boolean {
  return Boolean(country) && WITHDRAWAL_RIGHT_COUNTRIES.has(String(country).toUpperCase());
}

/**
 * O país do comprador, pelo cabeçalho que a hospedagem põe em cada pedido.
 * Sem cabeçalho (desenvolvimento local, rede desconhecida) devolve null e a
 * caixa não é exigida: o mesmo "falha aberto" do filtro de países do proxy.
 */
export function buyerCountryFromRequest(request: Request): string | null {
  const country = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : null;
}

/** O que vai no metadata do Stripe quando a caixa foi marcada. */
export const WITHDRAWAL_CONSENT_ACCEPTED = "accepted";
