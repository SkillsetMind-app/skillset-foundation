import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// O jsdom não implementa showModal/close: o stub faz o mínimo que o navegador
// faz (atributo open e o evento close), como em account-control-dialog.test.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  cleanup();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function Harness({ onConfirm }: { onConfirm: () => unknown }) {
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
          onClose={() => setOpen(false)}
        >
          This cannot be undone.
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function openDialog(onConfirm: () => unknown = vi.fn()) {
  render(<Harness onConfirm={onConfirm} />);
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
});
