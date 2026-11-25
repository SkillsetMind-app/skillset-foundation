/**
 * The database refuses excess writes with RAISE 'RATE_LIMIT' (enforce_rate_limit,
 * including on the community and support INSERT triggers). supabase-js
 * delivers that as an error with message "RATE_LIMIT"; the screen swaps the
 * generic message, which says to try again right away, for "wait a moment".
 */
export function isRateLimitError(error: unknown): boolean {
  const message = error && typeof error === "object" && "message" in error ? error.message : null;
  return typeof message === "string" && message.startsWith("RATE_LIMIT");
}
