/**
 * Anyone buying from the European Union, the European Economic Area or the United Kingdom
 * has 14 days to withdraw from an online purchase. For digital content that
 * starts right away, that right only ends if the person asks for immediate access
 * AND acknowledges that they lose the right (Directive 2011/83/EU, art. 16(m); UK
 * Consumer Contracts Regulations 2013, reg. 37). That is why, for those countries,
 * the purchase only goes ahead with the checkbox ticked, and the consent is stored with the
 * payment and confirmed in the purchase email.
 *
 * EU (27) + EEA (Iceland, Liechtenstein, Norway) + United Kingdom, plus the
 * EU territories that have their own country code: the French outermost regions
 * (GF, GP, MQ, RE, YT, MF) and Åland (AX).
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
 * The buyer's country, from the header the hosting platform puts on every request.
 * Without the header (local development, unknown network) it returns null and the
 * checkbox is not required: the same "fail open" as the proxy's country filter.
 */
export function buyerCountryFromRequest(request: Request): string | null {
  const country = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : null;
}

/** What goes in the Stripe metadata when the checkbox was ticked. */
export const WITHDRAWAL_CONSENT_ACCEPTED = "accepted";
