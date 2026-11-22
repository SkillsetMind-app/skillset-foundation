/**
 * Carregando o construtor (catálogo de movimento, item 9): blocos do tamanho
 * do que vem — cabeçalho, trilho de etapas e o painel da aba — no lugar de uma
 * linha de texto solta. O texto continua lá, para o leitor de tela. O pulso é
 * o `animate-pulse` do Tailwind; "reduzir movimento" o para no bloco global.
 * Sem "use client": serve ao fallback do Suspense (servidor) e ao construtor.
 */
const block = "bg-[var(--color-surface-strong)]";

/**
 * As linhas da lista de produtos carregando. Mora aqui para a lista e o
 * fallback da rota desenharem a mesma coisa; antes era um <div> genérico com
 * aria-label (ignorado pelo leitor de tela) dentro de teacher-course-studio.
 */
export function ProductRowsSkeleton({ label }: { label?: string }) {
  const rows = (
    <div aria-hidden="true" className="grid gap-0">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-24 animate-pulse border-b border-[var(--color-line)] bg-[var(--color-surface-soft)]" />
      ))}
    </div>
  );
  return label ? (
    <div role="status">
      <span className="sr-only">{label}</span>
      {rows}
    </div>
  ) : rows;
}

/**
 * /teach/builder sem curso é a LISTA: o fallback da rota mostrava o esqueleto
 * do editor (cabeçalho, cinco etapas, formulário) e depois trocava pelo da
 * lista — dois pulos antes da tabela. Este tem a forma da lista: cabeçalho com
 * o botão, a fileira de busca e filtros, e as linhas.
 */
export function ProductListSkeleton({ label }: { label: string }) {
  return (
    <section role="status" data-skeleton="list" className="grid gap-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
        <div className="grid w-full max-w-xl animate-pulse gap-2">
          <div className={`h-3 w-24 rounded-sm ${block}`} />
          <div className={`h-8 w-64 max-w-full rounded-md ${block}`} />
          <div className={`h-4 w-full rounded-sm ${block}`} />
        </div>
        <div className={`h-11 w-36 animate-pulse rounded-md ${block}`} />
      </div>
      <div aria-hidden="true" className="grid animate-pulse gap-4">
        <div className={`h-5 w-48 rounded-sm ${block}`} />
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(150px,auto)_minmax(170px,auto)]">
          {[0, 1, 2].map((item) => (
            <div key={item} className={`h-11 rounded-md ${block}`} />
          ))}
        </div>
      </div>
      <ProductRowsSkeleton />
    </section>
  );
}

export function BuilderSkeleton({ label }: { label: string }) {
  return (
    <section role="status" data-skeleton="editor" className="grid gap-4">
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
