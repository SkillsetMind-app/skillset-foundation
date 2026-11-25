/**
 * Request header the proxy sets, for this request only, once it has verified
 * the session with Supabase (and written a refreshed token to the cookies if
 * the old one was about to expire).
 *
 * The root layout resolves the signed-in session for the first HTML only when
 * this header is present. A server component cannot save a rotated token, so
 * it must never be the one that refreshes it: a refresh that is not saved
 * leaves the browser holding a token that was already used, and using it
 * again ends the whole session. Requests the proxy lets through without
 * touching the session (a creator's own domain, for one) carry no header, and
 * the browser resolves the session there as it always did.
 *
 * The proxy deletes whatever the client sent under this name first, so it can
 * only ever come from the proxy.
 */
export const SESSION_CHECKED_HEADER = "x-skillset-session-checked";
