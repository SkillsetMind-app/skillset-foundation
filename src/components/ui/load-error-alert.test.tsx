import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadErrorAlert } from "@/components/ui/load-error-alert";

afterEach(cleanup);

function renderAlert(onRetry: () => Promise<unknown> | void, busy = false) {
  const focusRef = createRef<HTMLDivElement>();
  // Sem I18nProvider: o useTranslation cai no inglês padrão.
  render(
    <div ref={focusRef} tabIndex={-1}>
      <LoadErrorAlert onRetry={onRetry} focusRef={focusRef} busy={busy}>
        Could not load.
      </LoadErrorAlert>
    </div>,
  );
  return focusRef;
}

// O "Try again" virava "Trying again..." com o anel na frente e o botão
// crescia a cada releitura. Agora os dois rótulos moram na mesma célula e o
// nome é sempre o que está à vista.
describe("LoadErrorAlert", () => {
  it("os dois rótulos na mesma célula; o nome é 'Try again' em repouso e 'Trying again...' na espera", async () => {
    let finish!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const focusRef = renderAlert(onRetry);

    const button = screen.getByRole("button", { name: "Try again" });
    const idle = within(button).getByText("Try again");
    const waiting = within(button).getByText("Trying again...");
    expect(waiting).toHaveAttribute("aria-hidden", "true");
    expect(idle).not.toHaveAttribute("aria-hidden");
    expect(idle.parentElement).toBe(waiting.parentElement);
    expect(idle).toHaveClass("[grid-area:1/1]");
    expect(waiting).toHaveClass("[grid-area:1/1]", "invisible");
    expect(idle.parentElement).toHaveClass("inline-grid");

    act(() => { button.click(); });
    const busy = screen.getByRole("button", { name: "Trying again..." });
    expect(busy).toBe(button);
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(within(busy).getByText("Try again")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.activeElement).toBe(focusRef.current);

    await act(async () => { finish(); });
    expect(screen.getByRole("button", { name: "Try again" })).toBe(button);
    expect(button).toBeEnabled();
  });

  it("dois cliques antes de redesenhar abrem uma releitura só", async () => {
    let finish!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderAlert(onRetry);
    const button = screen.getByRole("button", { name: "Try again" });

    act(() => {
      button.click();
      button.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    await act(async () => { finish(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("com a releitura acompanhada pela tela (busy), o botão já espera e não relê", () => {
    const onRetry = vi.fn();
    renderAlert(onRetry, true);
    const button = screen.getByRole("button", { name: "Trying again..." });
    expect(button).toBeDisabled();
    expect(within(button).getByText("Try again")).toHaveAttribute("aria-hidden", "true");
    act(() => { button.click(); });
    expect(onRetry).not.toHaveBeenCalled();
  });
});
