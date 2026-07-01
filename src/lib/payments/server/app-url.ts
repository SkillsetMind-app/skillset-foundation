import { SITE_URL } from "@/lib/seo/page-metadata";

/**
 * Absolute origin used to build Stripe success/cancel/return URLs from Route
 * Handlers. Ports getAppUrl() from the Firebase functions: prefer the deploy's
 * SKILLSET_APP_URL, fall back to the canonical SITE_URL, and strip a trailing
 * slash so `${appUrl}/path` never doubles it.
 */
export function getAppUrl(): string {
  return (process.env.SKILLSET_APP_URL || SITE_URL).replace(/\/$/, "");
}
