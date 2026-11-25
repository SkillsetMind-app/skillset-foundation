import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// What the person suffered: the pages behind login (/account, /learn, /teach)
// had no title of their own — the browser tab showed the site's generic title.
// Each page now exports `generateMetadata` calling `privatePageMetadata(key)`
// with the SAME key it already uses in `PlatformShell title={t(key)}`. This
// test is static (it reads the source text, it does not render or call
// generateMetadata): it checks that the list of covered pages is exactly the
// one that exists on disk, that the helper's key matches the header's, and that
// the key exists in both dictionaries.
const PAGES_WITH_OWN_TITLE = [
  "account/billing/page.tsx",
  "account/billing/return/page.tsx",
  "account/billing/upgrade/page.tsx",
  "account/notifications/page.tsx",
  "account/page.tsx",
  "account/payments/page.tsx",
  "account/plans/page.tsx",
  "learn/community/page.tsx",
  "learn/credentials/page.tsx",
  "learn/events/page.tsx",
  "learn/messages/page.tsx",
  "learn/page.tsx",
  "learn/wishlist/page.tsx",
  "teach/activate/page.tsx",
  "teach/activate/return/page.tsx",
  "teach/builder/page.tsx",
  "teach/courses/[courseId]/community/page.tsx",
  "teach/courses/[courseId]/manage/page.tsx",
  "teach/events/page.tsx",
  "teach/marketing/page.tsx",
  "teach/media/page.tsx",
  "teach/member-area/page.tsx",
  "teach/members/page.tsx",
  "teach/messages/page.tsx",
  "teach/page.tsx",
  "teach/reports/page.tsx",
  "teach/sales/[orderId]/page.tsx",
  "teach/sales/page.tsx",
  "teach/storefront/page.tsx",
  "teach/students/page.tsx",
  "teach/subscriptions/page.tsx",
  "teach/verification/page.tsx",
] as const;

function readPage(relPath: string): string {
  return readFileSync(`src/app/${relPath}`, "utf8");
}

/** Every page.tsx under account/, learn/, teach/ whose source text calls privatePageMetadata(...). */
function pagesWithPrivateMetadataOnDisk(): string[] {
  const sections = ["account", "learn", "teach"];
  const relPaths = sections.flatMap((section) =>
    (readdirSync(`src/app/${section}`, { recursive: true }) as string[])
      .filter((entry) => entry.endsWith("page.tsx"))
      .map((entry) => `${section}/${entry.replace(/\\/g, "/")}`),
  );
  return relPaths.filter((relPath) => readPage(relPath).includes("privatePageMetadata("));
}

describe("tab title of the signed-in pages", () => {
  it("the list of covered pages is exactly the one on disk (it does not shrink by accident)", () => {
    expect(pagesWithPrivateMetadataOnDisk().sort()).toEqual(
      [...PAGES_WITH_OWN_TITLE].sort(),
    );
  });

  it.each(PAGES_WITH_OWN_TITLE)(
    "%s: the helper key is the same as the header key and exists in en/es",
    (relPath) => {
      const source = readPage(relPath);

      const helperMatch = source.match(/privatePageMetadata\(\s*"([^"]+)"\s*\)/);
      expect(helperMatch, `generateMetadata via privatePageMetadata() missing in ${relPath}`).not.toBeNull();
      const helperKey = helperMatch![1];

      const shellMatch = source.match(/PlatformShell[\s\S]*?\btitle=\{t\("([^"]+)"\)\}/);
      expect(shellMatch, `PlatformShell title={t(...)} missing in ${relPath}`).not.toBeNull();
      const shellKey = shellMatch![1];

      expect(helperKey, `helper key differs from the header key in ${relPath}`).toBe(shellKey);

      // translate() falls back to en and, if it is missing there too, returns
      // the key itself — so "!== key" proves that at least en.json has the
      // entry. The en/es parity itself is the job of dictionary-parity.test.ts.
      expect(translate(getDictionary("en"), helperKey), `missing key: ${helperKey}`).not.toBe(helperKey);
      expect(translate(getDictionary("es"), helperKey), `missing key: ${helperKey}`).not.toBe(helperKey);
    },
  );
});
