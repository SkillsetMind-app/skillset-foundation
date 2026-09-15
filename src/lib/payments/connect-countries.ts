// Creator payout countries for a US platform using Stripe Express accounts,
// DIRECT charges and application fees (Stripe research, 15/09/2026).
// Deliberately excluded:
//   - IS: recipient-only.
//   - MX, BR: application fees are blocked for a US platform.
//   - rest of Latin America: recipient-only, no card_payments, so no direct charges.
//   - GY: Stripe does not operate there.
// Shared by the client picker and the server routes, so it stays import-free.
export const CONNECT_PAYOUT_COUNTRIES = [
  "US", "CA", "GB", "CH",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
] as const;

export type ConnectPayoutCountry = (typeof CONNECT_PAYOUT_COUNTRIES)[number];

/** Case-insensitive ISO alpha-2 check against CONNECT_PAYOUT_COUNTRIES. */
export function isConnectPayoutCountry(value: unknown): boolean {
  return typeof value === "string"
    && (CONNECT_PAYOUT_COUNTRIES as readonly string[]).includes(value.toUpperCase());
}
