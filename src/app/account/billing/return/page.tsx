import Link from "next/link";
import { Info } from "lucide-react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("billingCheckout.returnTitle");
}

type SearchParamValue = string | string[] | undefined;

type BillingReturnPageProps = {
  searchParams?: Promise<Record<string, SearchParamValue>>;
};

function firstParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// A referencia na URL nao verifica pagamento, assinatura nem titularidade.
export default async function BillingReturnPage({
  searchParams,
}: BillingReturnPageProps) {
  const { t } = await getServerTranslation();
  const params = (await searchParams) ?? {};
  const hasCheckoutReference = Boolean(firstParam(params.session_id)?.trim());

  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell title={t("billingCheckout.returnTitle")} compact>
        <div className="px-4 py-8 text-center">
          <div className="mx-auto grid size-12 place-items-center text-[var(--color-ink-soft)]">
            <Info aria-hidden="true" size={24} />
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-[var(--color-primary)]">
            {t(hasCheckoutReference ? "billingCheckout.returnHeading" : "billingCheckout.noCheckout")}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
            {t(hasCheckoutReference ? "billingCheckout.returnBody" : "billingCheckout.noCheckoutBody")}
          </p>
          <Link
            href="/account/billing?tab=overview"
            className="button-outline mt-5 inline-flex px-4 py-2.5 text-sm"
          >
            {t("billingCheckout.backToBilling")}
          </Link>
        </div>
      </PlatformShell>
    </ProtectedSurface>
  );
}
