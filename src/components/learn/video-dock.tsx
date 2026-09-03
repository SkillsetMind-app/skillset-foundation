"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * No celular, rolar a sala para ler a descrição ou a discussão fazia o vídeo
 * sumir da tela — pausar, subir de volta, achar o ponto, descer de novo.
 * Passado o player, o quadro se prende no alto da tela, pequeno, com o nome da
 * aula e um X. Rolou de volta, ele volta ao tamanho sozinho.
 *
 * A REGRA que decide o desenho: o vídeo NUNCA muda de lugar no DOM. Um iframe
 * arrancado e recolocado recarrega, e a aula recomeçaria do zero. Aqui só
 * entra e sai uma classe; quem fixa e encolhe é o CSS (globals.css,
 * .member-video-dock--mini, dentro de @media (max-width: 767.98px)). O React
 * não desmonta nada — nem no telefone, nem no computador.
 *
 * Acima de 768px o estado continua sendo calculado, mas o CSS do mini vive
 * inteiro dentro da media query: a classe fica inerte.
 */
export function VideoDock({
  children,
  closeLabel = "Close mini player",
  enabled = true,
  title,
}: {
  children: ReactNode;
  closeLabel?: string;
  /** Aula sem vídeo (texto, mídia ainda não anexada, aula trancada) não tem o
   *  que prender no topo: só o quadro vazio subiria junto. */
  enabled?: boolean;
  title: string;
}) {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [scrolledPast, setScrolledPast] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // O quadro sai do fluxo ao prender; sem reservar a altura dele, a página
  // inteira salta para cima no instante em que o mini liga.
  const [reservedHeight, setReservedHeight] = useState(0);

  useEffect(() => {
    const dock = dockRef.current;

    if (!enabled || !dock || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return;
        }

        // `top < 0` é o que separa "passei do vídeo" de "ainda não cheguei
        // nele": chegar ao rodapé da página não pode acender o mini, e a
        // primeira leitura, com a sala fora da tela, também não.
        const next = !entry.isIntersecting && entry.boundingClientRect.top < 0;

        if (next && entry.boundingClientRect.height > 0) {
          setReservedHeight(entry.boundingClientRect.height);
        }

        // Fechar vale até o vídeo voltar à tela — não para sempre. Quem fecha
        // quer silêncio agora, não desligar o recurso. O reset mora aqui, no
        // retorno do observador, e não num efeito que reage a `scrolledPast`:
        // efeito que chama setState em cadeia é render extra a cada rolagem.
        if (!next) {
          setDismissed(false);
        }

        setScrolledPast(next);
      },
      { threshold: 0 },
    );

    observer.observe(dock);

    return () => observer.disconnect();
  }, [enabled]);

  const mini = enabled && scrolledPast && !dismissed;

  return (
    <div
      ref={dockRef}
      className={`member-video-dock${mini ? " member-video-dock--mini" : ""}`}
      data-mini={mini ? "true" : "false"}
      style={mini && reservedHeight > 0 ? { minHeight: reservedHeight } : undefined}
    >
      <div className="member-video-frame">
        {children}
        <div className="member-video-mini">
          <p className="member-video-mini__title">{title}</p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="member-video-mini__close"
            aria-label={closeLabel}
          >
            <X aria-hidden size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
