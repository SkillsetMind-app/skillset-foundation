"use client";

import { useEffect, useRef, useState } from "react";

// A entrada é um enfeite, nunca uma condição para ver a seção. Sem JavaScript,
// antes da hidratação, num navegador sem IntersectionObserver ou com movimento
// reduzido, a seção fica visível. Só depois de montada, e só se ainda estiver
// abaixo da tela (onde ninguém a vê sumir), ela é "armada": começa transparente
// e entra quando o topo dela passa dos 90% da altura da tela. O limite era 15%
// da seção, e uma faixa de ~2900px num celular deixava ~430px de página em
// branco antes de aparecer.
export function useRevealOnView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [armed, setArmed] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;

    if (!node || typeof window.IntersectionObserver === "undefined") {
      return;
    }

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // Já na tela, ou acima dela: fica como está, sem piscar.
    if (node.getBoundingClientRect().top < window.innerHeight) {
      return;
    }

    setArmed(true);
    const observer = new window.IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0 },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return { ref, armed, revealed };
}
