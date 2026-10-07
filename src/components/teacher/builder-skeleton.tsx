/**
 * Carregando o construtor (catálogo de movimento, item 9): blocos do tamanho
 * do que vem — cabeçalho, trilho de etapas e o painel da aba — no lugar de uma
 * linha de texto solta. O texto continua lá, para o leitor de tela. O pulso é
 * o `animate-pulse` do Tailwind; "reduzir movimento" o para no bloco global.
 * Sem "use client": serve ao fallback do Suspense (servidor) e ao construtor.
 */
const block = "bg-[var(--color-surface-strong)]";

export function BuilderSkeleton({ label }: { label: string }) {
  return (
    <section role="status" className="grid gap-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="grid animate-pulse gap-4">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <div className="flex flex-wrap gap-2">
            <div className={`h-7 w-20 rounded-chip ${block}`} />
            <div className={`h-7 w-28 rounded-chip ${block}`} />
          </div>
          <div className={`mt-6 h-8 w-2/3 max-w-md rounded-md ${block}`} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className={`h-14 rounded-md ${block}`} />
          ))}
        </div>
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <div className={`h-5 w-40 rounded-sm ${block}`} />
          <div className={`mt-3 h-4 w-full max-w-xl rounded-sm ${block}`} />
          <div className={`mt-6 h-11 w-full rounded-md ${block}`} />
          <div className={`mt-4 h-11 w-full rounded-md ${block}`} />
          <div className={`mt-4 h-28 w-full rounded-md ${block}`} />
        </div>
      </div>
    </section>
  );
}
