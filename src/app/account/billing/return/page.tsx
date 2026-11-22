import Link from "next/link";
import { Info } from "lucide-react";

import { BillingReturnStatus } from "@/components/account/billing-return-status";
import { PaymentReturnCard } from "@/components/account/payment-return-card";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { buttonClasses } from "@/components/ui/button";
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
        {/* Com referencia de checkout, a tela confere a assinatura no servidor e
            confirma o teste gratis (BillingReturnStatus). Sem referencia, nada
            ha para conferir: segue o aviso de que a visita nao confirma nada. */}
        {hasCheckoutReference ? (
          <BillingReturnStatus />
        ) : (
          <PaymentReturnCard
            icon={<Info aria-hidden="true" size={20} />}
            heading={t("billingCheckout.noCheckout")}
            body={t("billingCheckout.noCheckoutBody")}
            actions={
              <>
                <Link href="/account/billing?tab=overview" className={buttonClasses({ variant: "solid" })}>
                  {t("billingCheckout.backToBilling")}
                </Link>
                <Link href="/support" className={buttonClasses({ variant: "outline" })}>
                  {t("billingCheckout.support")}
                </Link>
              </>
            }
          />
        )}
      </PlatformShell>
    </ProtectedSurface>
  );
}
