import type { Metadata } from "next";

import { brand } from "@/data/brand";
import { getServerTranslation } from "@/lib/i18n/server";

/**
 * Metadata for pages behind login (/account, /learn, /teach). Reuses the same
 * dictionary key the page already shows via `PlatformShell title={t(titleKey)}`,
 * so the browser tab matches the header instead of the root layout's generic
 * title. No canonical/Open Graph: these pages require auth and must never be
 * indexed.
 *
 * Lives apart from page-metadata.ts on purpose: client components import that
 * file, and this helper reads the request cookie (next/headers), which only
 * exists on the server. Putting it there broke the production build.
 */
export async function privatePageMetadata(titleKey: string): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return {
    title: `${t(titleKey)} | ${brand.name}`,
    robots: { index: false, follow: false },
  };
}
