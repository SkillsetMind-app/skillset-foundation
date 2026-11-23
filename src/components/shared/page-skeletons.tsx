// Esperas no formato do que vem, para as telas que ainda esperavam com uma
// frase solta num cartão (ou com nada). O texto fica para o leitor de tela, num
// role="status" só; os blocos são aria-hidden. Sem hook nem "use client": serve
// ao servidor e ao cliente. Um tom de osso só, o dos esqueletos da casa
// (BuilderSkeleton).
const bone = "rounded-md bg-[var(--color-surface-strong)]";
const card = "rounded-lg border border-[var(--color-line)] bg-white shadow-[var(--shadow-soft)]";

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
