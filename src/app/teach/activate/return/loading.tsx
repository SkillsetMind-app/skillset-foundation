import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { Card } from "@/components/ui/card";
import { getServerTranslation } from "@/lib/i18n/server";

/**
 * A volta do Stripe pergunta ao banco antes de responder. Sem este arquivo
 * valia o loading.tsx de /teach/activate, com o título e o esqueleto do
 * checkout: a tela piscava "Activate your storefront" antes do retorno.
 * Aqui a mesma casca e o cartão do retorno (PaymentReturnCard) em esqueleto:
 * ícone redondo, frase, explicação e os dois botões.
 */
export default async function LoadingActivationReturn() {
  const { t } = await getServerTranslation();
  const bone = "rounded-md bg-[var(--color-surface-strong)]";
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("activationCheckout.returnTitle")} compact>
        <Card padding="lg">
          <div role="status">
            <span className="sr-only">{t("activationCheckout.confirming")}</span>
            <div aria-hidden="true" className="animate-pulse">
              <div className="size-10 rounded-full bg-[var(--color-surface-strong)]" />
              <div className={`mt-3 h-6 w-64 max-w-full ${bone}`} />
              <div className={`mt-3 h-4 max-w-xl ${bone}`} />
              <div className="mt-4 flex flex-wrap gap-3">
                <div className={`h-11 w-44 ${bone}`} />
                <div className={`h-11 w-28 ${bone}`} />
              </div>
            </div>
          </div>
        </Card>
      </PlatformShell>
    </ProtectedSurface>
  );
}
