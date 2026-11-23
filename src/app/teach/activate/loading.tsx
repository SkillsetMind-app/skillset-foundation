import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { StripeFrameSkeleton } from "@/components/teacher/builder-skeleton";
import { getServerTranslation } from "@/lib/i18n/server";

/**
 * A página pergunta ao banco (creator_activation_blocked) antes de mandar
 * qualquer coisa. Sem este arquivo o clique em "Activate" deixava a tela
 * anterior parada, sem sinal nenhum, até a resposta chegar.
 *
 * A mesma moldura da página (guarda, casca e título) e o mesmo lugar guardado
 * do fallback do Suspense dela e do painel: uma espera só, que não pula. Com a
 * guarda, a primeira carga mostra o mesmo giro que a página mostraria.
 */
export default async function LoadingActivation() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("activationCheckout.pageTitle")} compact>
        <div className="overflow-hidden rounded-lg border fine-rule bg-white shadow-[var(--shadow-soft)]">
          <StripeFrameSkeleton label={t("activationCheckout.preparing")} />
        </div>
      </PlatformShell>
    </ProtectedSurface>
  );
}
