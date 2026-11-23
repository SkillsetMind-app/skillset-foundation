// Esperas no formato do que vem, para as telas que ainda esperavam com uma
// frase solta num cartão (ou com nada). O texto fica para o leitor de tela, num
// role="status" só; os blocos são aria-hidden. Sem hook nem "use client": serve
// ao servidor e ao cliente. Um tom de osso só, o dos esqueletos da casa
// (BuilderSkeleton).
const tone = "bg-[var(--color-surface-strong)]";
const bone = `rounded-md ${tone}`;
const card = "rounded-lg border border-[var(--color-line)] bg-white shadow-[var(--shadow-soft)]";

/**
 * A casca da plataforma enquanto a sessão resolve (F-03, estágio 0): era um
 * anel no meio de uma página vazia e, depois, a barra lateral, o topo e o
 * conteúdo entravam de uma vez. As medidas não moram aqui: cada peça usa a
 * MESMA classe da PlatformShell (`.platform-grid` e seus modificadores dão a
 * largura da barra, `.platform-topbar__inner` a altura do topo,
 * `.platform-content` o respiro, `.platform-mobile-nav` a barra de baixo do
 * celular), então a troca pela casca de verdade não mexe em nada. Inerte: sem
 * link, sem botão, sem nome nem rótulo do menu; um role="status" só, com a
 * frase de antes para o leitor de tela. A barra lateral fica só no navy dela:
 * o osso claro pintado sobre o navy seria um segundo tom.
 */
export function PlatformShellSkeleton({
  label,
  collapsed,
  auto,
  framed,
}: {
  label: string;
  collapsed: boolean;
  auto: boolean;
  /** A coluna de 1280px das telas do estúdio, da conta e das listas do aluno. */
  framed: boolean;
}) {
  return (
    <main className="page-shell platform-shell-root">
      <div className="platform-shell-body">
        <div className="platform-shell-inner w-full">
          <div
            className={[
              "platform-grid",
              collapsed ? "platform-grid--collapsed" : "",
              auto ? "platform-grid--auto" : "",
            ].join(" ")}
          >
            <aside
              aria-hidden="true"
              className={`platform-sidebar platform-sidebar-panel ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}
            >
              <div className="platform-sidebar-brand" />
            </aside>
            <div className="platform-main-column">
              <div aria-hidden="true" className="platform-topbar">
                <div className="platform-topbar__inner motion-safe:animate-pulse">
                  {/* A marca só no celular e o caminho só de 768px para cima,
                      como no topo de verdade. */}
                  <span className={`platform-topbar__logo size-10 ${bone}`} />
                  <span className={`hidden h-4 w-48 md:block ${bone}`} />
                  <span className="platform-topbar__actions">
                    {[0, 1, 2].map((item) => (
                      <span key={item} className={`size-10 rounded-full ${tone}`} />
                    ))}
                  </span>
                </div>
              </div>
              <section className="platform-content">
                <div
                  role="status"
                  className={["space-y-6", framed ? "mx-auto w-full min-[1440px]:max-w-7xl" : ""].join(" ")}
                >
                  <span className="sr-only">{label}</span>
                  <div aria-hidden="true" className="border-b border-[var(--color-line)] pb-5 pt-2 motion-safe:animate-pulse">
                    <div className={`h-9 w-72 max-w-full ${bone}`} />
                  </div>
                  <div aria-hidden="true" className="grid gap-4 motion-safe:animate-pulse">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className={`p-4 sm:p-5 ${card}`}>
                        <div className={`h-5 w-2/3 max-w-md ${bone}`} />
                        <div className={`mt-4 h-4 w-1/2 max-w-sm ${bone}`} />
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
      {/* A barra de baixo do celular: a classe só a mostra abaixo de 768px. */}
      <div aria-hidden="true" className="platform-mobile-nav motion-safe:animate-pulse">
        {[0, 1, 2, 3, 4].map((item) => (
          <span key={item} className="grid min-w-0 flex-1 place-items-center gap-1 px-2 py-2">
            <span className={`size-5 ${bone}`} />
            <span className={`h-2.5 w-10 ${bone}`} />
          </span>
        ))}
      </div>
    </main>
  );
}

/**
 * As listas de cartões da área do aluno (certificados, sessões ao vivo,
 * comunidades): a fileira de cima e dois cartões lado a lado. `head` é o que
 * fica em cima na tela pronta: os filtros ou o título da seção.
 */
export function CardListSkeleton({ label, head }: { label: string; head: "tabs" | "title" }) {
  return (
    <div role="status" className="grid gap-5">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={`${head === "tabs" ? "h-11 w-72" : "h-5 w-32"} max-w-full animate-pulse ${bone}`} />
      <div aria-hidden="true" className="grid animate-pulse gap-4 lg:grid-cols-2">
        {[0, 1].map((item) => (
          <div key={item} className={`p-4 sm:p-5 ${card}`}>
            <div className={`h-5 w-2/3 ${bone}`} />
            <div className={`mt-4 h-4 w-1/2 ${bone}`} />
            <div className={`mt-4 h-11 w-32 ${bone}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
