// Esqueleto da página de venda enquanto o curso carrega, no servidor (fallback
// do Suspense) e no cliente (antes da assinatura do curso responder). No lugar
// dele havia um cartão com um segundo título "Loading course..." e um botão que
// levava o comprador para fora da página bem na hora da compra; quando os dados
// chegavam, o cartão sumia e tudo pulava. Aqui é o mesmo grid da página
// carregada, sem título e sem botão: o leitor de tela ouve só o aviso.
// Sem hook nem "use client": serve igual ao servidor e ao cliente.
export function CourseDetailSkeleton({
  label,
  checkoutOnly = false,
}: {
  label: string;
  /** Na página de compra o cartão é a coluna inteira: só ele. */
  checkoutOnly?: boolean;
}) {
  const bar = "rounded-md bg-[var(--color-surface-strong)]";
  const buyCard = (
    // Mesma caixa, mesmas alturas do cartão de compra: o preço e o botão
    // nascem no lugar que vão ocupar.
    <div
      aria-hidden="true"
      className="h-fit min-w-0 animate-pulse self-start rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6"
    >
      <div className={`h-2.5 w-12 ${bar}`} />
      <div className={`mt-2 h-9 w-[150px] max-w-full ${bar}`} />
      <div className="mt-5 h-px bg-[var(--color-line)]" />
      <div className="mt-5 grid gap-4">
        <div className={`h-3.5 ${bar}`} />
        <div className={`h-3.5 ${bar}`} />
        <div className={`h-3.5 ${bar}`} />
      </div>
      <div className={`mt-6 h-12 ${bar}`} />
    </div>
  );

  return (
    <>
      <p role="status" className="sr-only">{label}</p>
      {checkoutOnly ? buyCard : (
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div aria-hidden="true" className="min-w-0 animate-pulse">
            {/* Assinatura do instrutor, menu das seções e os primeiros blocos. */}
            <div className="mt-5 flex min-h-11 items-center gap-2.5">
              <div className="size-8 shrink-0 rounded-full bg-[var(--color-surface-strong)]" />
              <div className={`h-3.5 w-36 ${bar}`} />
            </div>
            <div className="mt-6 flex gap-4 border-b border-[var(--color-line)] pb-4 pt-3">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className={`h-3.5 w-16 ${bar}`} />
              ))}
            </div>
            <div className="mt-8 h-40 rounded-lg border border-[var(--color-line)] bg-white" />
            <div className="mt-8 h-40 rounded-lg border border-[var(--color-line)] bg-white" />
          </div>
          {buyCard}
        </div>
      )}
    </>
  );
}
