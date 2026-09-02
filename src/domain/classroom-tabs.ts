// As abas da sala de aula, cada uma com endereco proprio.
//
// POR QUE ISTO EXISTE
//
// Materiais, comunidade, mensagens e avaliacao moravam na mesma rolagem da
// aula, depois do curriculo, sem endereco: nao dava para mandar o link da
// comunidade do curso nem voltar para ela pelo historico. E os botoes "Aula
// atual / Materiais / Discussao" so rolavam a pagina — pareciam navegacao e
// nao levavam a lugar nenhum. Agora cada aba e um caminho
// (/learn/courses/<curso>/community?lesson=<aula>): clicar abre, o voltar do
// navegador devolve a aula, o link e compartilhavel. A aula atual segue no
// endereco em toda aba, entao "voltar para a aula" e sempre a mesma aula.

export const CLASSROOM_TABS = [
  "lesson",
  "materials",
  "lives",
  "community",
  "messages",
  "review",
  "about",
] as const;

export type ClassroomTab = (typeof CLASSROOM_TABS)[number];

export function isClassroomTab(value: string): value is ClassroomTab {
  return (CLASSROOM_TABS as readonly string[]).includes(value);
}

/** O caminho da sala sem a aba: "/learn/courses/<curso>". Em aula, e o
 *  proprio pathname; numa aba, tira o "/<aba>" do fim. */
export function classroomBasePath(pathname: string, tab: ClassroomTab): string {
  if (tab === "lesson") {
    return pathname;
  }
  const suffix = `/${tab}`;
  return pathname.endsWith(suffix) ? pathname.slice(0, -suffix.length) : pathname;
}

/** O endereco de uma aba, levando a aula atual junto (?lesson=). A aba
 *  "lesson" e a propria base — sem segmento. */
export function classroomTabHref(
  basePath: string,
  tab: ClassroomTab,
  lessonId: string | null,
): string {
  const path = tab === "lesson" ? basePath : `${basePath}/${tab}`;
  return lessonId ? `${path}?lesson=${encodeURIComponent(lessonId)}` : path;
}
