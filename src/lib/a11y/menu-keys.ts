import type { KeyboardEvent } from "react";

const JUMPS = ["ArrowDown", "ArrowUp", "Home", "End"];

/**
 * Setas, Home e End entre os itens de um menu ou de uma lista de opções
 * (padrão de menu da WAI-ARIA). Vai no `onKeyDown` do contêiner; `selector`
 * diz quais filhos são itens. Os menus de produto e de compartilhar diziam
 * `role="menu"` mas só andavam no Tab. Outras teclas passam direto: Enter,
 * Espaço e Esc seguem com quem já cuidava delas.
 */
export function moveFocusByKey(event: KeyboardEvent<HTMLElement>, selector: string) {
  if (!JUMPS.includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector));
  if (items.length === 0) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next =
    event.key === "Home" ? 0
    : event.key === "End" ? last
    : event.key === "ArrowDown" ? (current + 1) % items.length
    : current <= 0 ? last : current - 1;
  items[next].focus();
}
