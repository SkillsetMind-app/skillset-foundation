import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIRM_GUARD_MS, ConfirmDialog } from "@/components/ui/confirm-dialog";

// O jsdom não implementa showModal/close: o stub faz o mínimo que o navegador
// faz (atributo open e o evento close), como em account-control-dialog.test.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

beforeEach(() => {
  // Só o relógio (Date) é falso: a trava do toque duplo lê Date.now(), e os
  // setTimeout reais continuam servindo o findBy/waitFor.
  vi.useFakeTimers({ toFake: ["Date"] });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function Harness({ onConfirm, errorLabel }: { onConfirm: () => unknown; errorLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open ? (
        <ConfirmDialog
          eyebrow="Danger zone"
          title="Delete it?"
          confirmLabel="Yes, delete"
          pendingLabel="Deleting…"
          cancelLabel="Keep it"
          danger
          onConfirm={onConfirm}
          errorLabel={errorLabel}
          onClose={() => setOpen(false)}
        >
          This cannot be undone.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function openDialog(onConfirm: () => unknown = vi.fn(), errorLabel?: string) {
  render(<Harness onConfirm={onConfirm} errorLabel={errorLabel} />);
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("dialog", { name: "Delete it?" }) };
}

describe("ConfirmDialog", () => {
  it("abre modal, cabe na tela, descreve a consequência e começa no lado seguro", () => {
    const { dialog } = openDialog();
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveClass("modal-panel", "modal-panel-scroll");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Yes, delete" })).toHaveClass("button-danger", "button-danger-solid");
  });

  it("cancelar e Esc fecham sem confirmar e devolvem o foco ao gatilho", () => {
    const onConfirm = vi.fn();
    const { trigger } = openDialog(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirma uma vez só, trava durante o pedido e fecha quando ele termina", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    openDialog(onConfirm);
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    const confirm = screen.getByRole("button", { name: "Yes, delete" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeDisabled();

    // Esc no meio do pedido não fecha.
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => finish());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // No celular o confirmar ocupa a largura toda logo abaixo do centro: num
  // toque duplo em "Delete account", o 2º toque cairia nele.
  it("ignora o confirmar logo depois de abrir e aceita depois da trava", () => {
    const onConfirm = vi.fn();
    openDialog(onConfirm);
    const confirm = screen.getByRole("button", { name: "Yes, delete" });

    fireEvent.click(confirm);
    vi.advanceTimersByTime(CONFIRM_GUARD_MS - 1);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    // A trava não desliga o botão: só descarta o clique.
    expect(confirm).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();

    vi.advanceTimersByTime(1);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("se o onConfirm rejeitar, fica aberta, destrava e avisa; a nova tentativa fecha", async () => {
    const onConfirm = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    openDialog(onConfirm);
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);

    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't go through. Try again in a moment.");
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Yes, delete" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  // Aviso sem escolha (era o window.alert): um botão só, sem vermelho, que
  // fecha no primeiro toque; dar ciência não desfaz nada.
  it("acknowledge: um botão só, com o foco, sem trava de toque duplo", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog acknowledge danger title="Upload in progress" confirmLabel="OK, I'll wait" onConfirm={onConfirm} onClose={onClose}>
        Wait for it to finish.
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Upload in progress" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    const ok = within(dialog).getByRole("button", { name: "OK, I'll wait" });
    expect(ok).toHaveFocus();
    expect(ok).not.toHaveClass("button-danger-solid");

    // Sem avançar o relógio: o primeiro toque já vale.
    fireEvent.click(ok);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("acknowledge: Esc também fecha", () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog acknowledge title="Upload in progress" confirmLabel="OK" onConfirm={vi.fn()} onClose={onClose}>
        Wait.
      </ConfirmDialog>,
    );
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("mostra o errorLabel de quem chamou no lugar da frase genérica", async () => {
    openDialog(vi.fn().mockRejectedValue(new Error("network")), "Could not delete it.");
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete it.");
  });
});
