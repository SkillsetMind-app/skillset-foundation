import { ProtectedSurface } from "@/components/auth/protected-surface";
import { ClassroomLoading } from "@/components/learn/classroom-loading";
import { getServerTranslation } from "@/lib/i18n/server";

/**
 * As quatro rotas da área de membros (/learn/areas/<criador>, /<area> e as
 * duas comunidades) buscam a marca do criador no servidor antes de responder.
 * Sem este arquivo o clique deixava a tela anterior parada até a resposta.
 *
 * Sem a casca da área de propósito, como no loading da sala: a casca desenha
 * a marca, e a marca só se sabe depois da busca. Vale a espera neutra da sala,
 * nas cores da plataforma. Com a guarda, a primeira carga mostra o mesmo giro
 * que a página mostraria.
 */
export default async function LoadingMemberArea() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
        <ClassroomLoading label={t("learn.memberArea.loading")} />
      </div>
    </ProtectedSurface>
  );
}
