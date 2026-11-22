import { fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";

import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";

// Apoio dos testes que passam pela janela de confirmacao (ConfirmDialog).
// O jsdom nao implementa showModal/close: o stub faz o minimo que o navegador
// faz (atributo open e o evento close), como em confirm-dialog.test. Devolve
// quem desfaz, para o prototipo voltar ao que era no afterEach.
export function stubDialogs() {
  const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
  return () => {
    if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  };
}

// A janela ignora o confirmar nos primeiros CONFIRM_GUARD_MS (toque duplo):
// o relogio anda ate la so para este clique.
export function clickConfirm(dialog: HTMLElement, name: string | RegExp) {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + CONFIRM_GUARD_MS);
  try {
    fireEvent.click(within(dialog).getByRole("button", { name }));
  } finally {
    clock.mockRestore();
  }
}
