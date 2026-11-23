import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaHomeSkeleton } from "@/components/learn/member-area-home";
import { getServerTranslation } from "@/lib/i18n/server";

/**
 * As rotas da área de membros (/learn/areas/<criador>, /<area> e as duas
 * comunidades) buscam a marca do criador no servidor antes de responder. Sem
 * este arquivo o clique deixava a tela anterior parada até a resposta.
 *
 * Sem a casca da área de propósito, como no loading da sala: a casca desenha a
 * marca, e a marca só se sabe depois da busca. O esqueleto é o da própria área
 * (o mesmo que ela mostra enquanto lê), na mesma caixa: as classes do <main>
 * da casca e a margem que a área põe em volta dele. Assim a espera é uma só,
 * sem trocar de forma. Com a guarda, a primeira carga mostra o mesmo giro que
 * a página mostraria.
 */
export default async function LoadingMemberArea() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <div className="mx-auto w-full max-w-[1280px] py-6 md:px-6 lg:px-8">
        <div className="px-4 md:px-0">
          <MemberAreaHomeSkeleton label={t("learn.memberArea.loading")} />
        </div>
      </div>
    </ProtectedSurface>
  );
}
