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
  // F-19: a linha inteira pulsava em surface-soft, sem cantos; agora é a linha
  // de verdade (capa 16:9 + título e categoria) no osso da casa.
  const rows = (
    <div aria-hidden="true" className="grid animate-pulse gap-0">
      {[1, 2, 3].map((item) => (
        <div key={item} className="flex h-24 items-center gap-3 border-b border-[var(--color-line)] px-4">
          <div className={`aspect-video w-24 shrink-0 rounded-md ${block}`} />
          <div className="grid min-w-0 flex-1 gap-2">
            <div className={`h-4 w-1/2 max-w-xs rounded-sm ${block}`} />
            <div className={`h-3 w-1/3 max-w-40 rounded-sm ${block}`} />
          </div>
        </div>
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

/**
 * Uma tabela carregando (Vendas, Alunos, alunos do produto): os quadros de
 * numero quando a tela tem, a fileira de busca e filtros, a linha da contagem
 * e as linhas na altura de uma linha de verdade. Antes era "Loading your
 * sales..." num cartao, e filtros, contagem e linhas entravam de uma vez,
 * empurrando tudo para baixo.
 */
export function TableSkeleton({
  label,
  tiles = 0,
  controls = 1,
  rows = 5,
}: {
  label: string;
  tiles?: number;
  controls?: number;
  rows?: number;
}) {
  return (
    <div role="status" data-skeleton="table" className="grid gap-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="grid animate-pulse gap-4">
        {tiles ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: tiles }, (_, item) => (
              <div key={item} className={`h-24 rounded-lg ${block}`} />
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <div className={`h-11 min-w-[12rem] flex-1 rounded-md ${block}`} />
          {Array.from({ length: controls - 1 }, (_, item) => (
            <div key={item} className={`h-11 w-36 rounded-md ${block}`} />
          ))}
        </div>
        <div className={`h-4 w-48 rounded-sm ${block}`} />
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
          {Array.from({ length: rows }, (_, item) => (
            <div key={item} className="flex h-14 items-center border-b border-[var(--color-line)] px-4 last:border-b-0">
              <div className={`h-4 w-full rounded-sm ${block}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Uma pilha de cartões carregando (Mídia, Eventos): cartões
 * no lugar e no contorno dos de verdade, com a miniatura quando a tela tem.
 * Antes era uma frase cinza num cartão, e a lista entrava empurrando a página.
 */
export function CardStackSkeleton({
  label,
  cards = 3,
  thumb = false,
}: {
  label: string;
  cards?: number;
  thumb?: boolean;
}) {
  return (
    <div role="status" data-skeleton="cards" className="grid gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: cards }, (_, item) => (
        <div
          key={item}
          aria-hidden="true"
          className="flex animate-pulse gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        >
          {thumb ? <div className={`h-20 w-20 shrink-0 rounded-md ${block}`} /> : null}
          <div className="grid min-w-0 flex-1 content-start gap-2">
            <div className={`h-3 w-24 rounded-sm ${block}`} />
            <div className={`h-5 w-2/3 max-w-sm rounded-md ${block}`} />
            <div className={`h-4 w-1/2 max-w-xs rounded-sm ${block}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * O detalhe de uma venda carregando: a volta, a coluna dos cartoes (valor,
 * cliente, pagamento) e o cartao do curso ao lado, no mesmo grid da tela.
 */
export function SaleDetailSkeleton({ label }: { label: string }) {
  const card = "rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6";
  return (
    <div role="status" data-skeleton="detail" className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={`h-11 w-24 animate-pulse rounded-md ${block} lg:col-span-2`} />
      <div aria-hidden="true" className="grid animate-pulse content-start gap-5">
        <div className={card}>
          <div className={`h-4 w-40 rounded-sm ${block}`} />
          <div className={`mt-4 h-9 w-36 rounded-md ${block}`} />
          <div className={`mt-4 h-3 w-full max-w-md rounded-sm ${block}`} />
        </div>
        {[0, 1].map((item) => (
          <div key={item} className={card}>
            <div className={`h-3 w-24 rounded-sm ${block}`} />
            <div className={`mt-4 h-20 rounded-md ${block}`} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className={`${card} h-fit animate-pulse`}>
        <div className={`h-3 w-20 rounded-sm ${block}`} />
        <div className={`mt-3 h-6 w-3/4 rounded-md ${block}`} />
        <div className={`mt-5 h-9 w-40 rounded-md ${block}`} />
      </div>
    </div>
  );
}

/**
 * Uma tela de cartao (Verificacao) carregando: o titulo e o cartao com texto e
 * botao. `header={false}` quando o titulo ja esta na tela e so o cartao vem.
 */
export function CardPageSkeleton({ label, header = true }: { label: string; header?: boolean }) {
  return (
    <div role="status" data-skeleton="card" className="grid gap-6">
      <span className="sr-only">{label}</span>
      {header ? (
        <div aria-hidden="true" className="animate-pulse border-b border-[var(--color-line)] pb-5 pt-2">
          <div className={`h-9 w-72 max-w-full rounded-md ${block}`} />
        </div>
      ) : null}
      <div aria-hidden="true" className="animate-pulse rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <div className={`h-4 w-full max-w-xl rounded-sm ${block}`} />
        <div className={`mt-3 h-4 w-2/3 rounded-sm ${block}`} />
        <div className={`mt-6 h-11 w-48 rounded-md ${block}`} />
      </div>
    </div>
  );
}

/**
 * O lugar do formulario da Stripe (assinatura, ativacao, repasses) enquanto
 * ele nao chega: a caixa ja nasce com a altura do formulario e um esqueleto
 * dentro. Antes era "Preparing..." numa caixa de ~90px que pulava para ~600px
 * quando o iframe chegava, empurrando a pagina. Sem aria-busy junto do
 * role="status": alguns leitores de tela seguram o anuncio enquanto ele vale.
 */
export function StripeFrameSkeleton({ label }: { label: string }) {
  return (
    <div role="status" data-skeleton="stripe" className="min-h-[560px] p-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="grid animate-pulse gap-4">
        <div className={`h-4 w-32 rounded-sm ${block}`} />
        <div className={`h-11 rounded-md ${block}`} />
        <div className={`h-4 w-40 rounded-sm ${block}`} />
        <div className={`h-11 rounded-md ${block}`} />
        <div className="grid grid-cols-2 gap-3">
          <div className={`h-11 rounded-md ${block}`} />
          <div className={`h-11 rounded-md ${block}`} />
        </div>
        <div className={`mt-4 h-12 rounded-md ${block}`} />
      </div>
    </div>
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
