// A ÚNICA tela de espera da sala de aula.
//
// Abrir um curso passava por até quatro: a do arquivo de rota (escura, com os
// cursos nascendo claros), a do Suspense, um cartão branco no workspace do
// criador e o esqueleto do workspace. Agora as quatro são esta.
//
// Sem "use client" e sem hooks: o arquivo de rota (servidor) e os workspaces
// (cliente) desenham a mesma marcação, e quem chama traduz o texto. Cores --ma-*
// com reserva nas da plataforma: dentro da casca da área de membros vale o tema
// do curso; no arquivo de rota, antes da casca e sem tema conhecido, valem as
// cores neutras da plataforma.
//
// `short`: quem já sabe que a aula abre com o cabeçalho curto (52px, aula no
// endereço) pede o bloco do topo nessa altura; sem isso ele tem a altura da
// capa do curso (members-hero, globals.css), que é o que a primeira visita vê.
export function ClassroomLoading({ label, short = false }: { label: string; short?: boolean }) {
  const block = "animate-pulse bg-[var(--ma-line,var(--color-surface-strong))]";

  return (
    // px-4 só no celular: abaixo de md a casca não tem margem lateral (a sala
    // vai de ponta a ponta), e a espera encostava na borda da tela.
    <section aria-busy="true" className="grid gap-4 px-4 md:px-0">
      <p role="status" className="text-sm text-[var(--ma-ink-soft,var(--color-ink-soft))]">
        {label}
      </p>
      {/* Os cantos dos cartoes de verdade (12px; 8px nas linhas da lista):
          com canto reto, tudo "mudava de forma" quando o curso chegava. */}
      <div
        className={`${short ? "h-[52px]" : "min-h-[clamp(300px,min(43vw,48svh),520px)]"} rounded-lg ${block}`}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`aspect-video rounded-lg ${block}`} />
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className={`h-16 rounded-md ${block}`} />
          ))}
        </div>
      </div>
    </section>
  );
}
