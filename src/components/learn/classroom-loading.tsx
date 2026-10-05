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
export function ClassroomLoading({ label }: { label: string }) {
  const block = "animate-pulse bg-[var(--ma-line,var(--color-surface-strong))]";

  return (
    <section aria-busy="true" className="grid gap-4">
      <p role="status" className="text-sm text-[var(--ma-ink-soft,var(--color-ink-soft))]">
        {label}
      </p>
      <div className={`h-32 ${block}`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`aspect-video ${block}`} />
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className={`h-16 ${block}`} />
          ))}
        </div>
      </div>
    </section>
  );
}
