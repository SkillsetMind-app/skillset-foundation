import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeTour } from "@/components/learn/welcome-tour";
import { TeacherWelcomeTour } from "@/components/teacher/teacher-welcome-tour";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc }) }));

// P-24: o tour cobre a tela inteira no primeiro login e oferece duas saídas
// explícitas — o X (16px de ícone + 4px de padding = 24px) e o "Skip" (texto
// sem padding, 20px de altura). Menos da metade do alvo mínimo de 44px que a
// própria casa fixa em .button-solid/.button-outline, dentro do mesmo modal.
// jsdom não mede layout, então o que dá para morder é a classe de tamanho.
describe("saídas do tour de boas-vindas", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("no tour do professor, X e Skip têm alvo de 44px", async () => {
    render(<TeacherWelcomeTour userId="teacher-1" firstName="Ana" />);

    await screen.findByRole("dialog");

    expect(screen.getByRole("button", { name: "Skip the tour" })).toHaveClass("h-11", "w-11");
    expect(screen.getByRole("button", { name: "Skip" })).toHaveClass("min-h-11");
  });

  it("no tour do aluno, X e Skip têm alvo de 44px", async () => {
    render(<WelcomeTour userId="student-1" firstName="Ana" />);

    await screen.findByRole("dialog");

    // Ordem no DOM: o X no cabeçalho, depois o Skip no rodapé, antes de Next.
    const [close, skip] = within(screen.getByRole("dialog")).getAllByRole("button");
    expect(close).toHaveAttribute("aria-label");
    expect(close).toHaveClass("h-11", "w-11");
    expect(skip).toHaveClass("min-h-11");
  });

  it("no tour do aluno, um nome com $& aparece literal, sem virar '{name}'", async () => {
    // Num replace sem callback, "$&" vira o trecho casado ("{name}") e "$'" o
    // resto da frase. O nome vem do cadastro: é texto da pessoa, não nosso.
    render(<WelcomeTour userId="student-1" firstName="Mc$&Donald" />);

    expect(await screen.findByRole("heading", { name: "Welcome, Mc$&Donald" })).toBeInTheDocument();
  });
});

describe.each([
  ["teacher", TeacherWelcomeTour],
  ["student", WelcomeTour],
] as const)("first welcome for %s", (surface, Tour) => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    localStorage.clear();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("waits for the account claim before interrupting the page", async () => {
    let resolve!: (result: { data: boolean; error: null }) => void;
    rpc.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<Tour userId="pending" firstName="Ana" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("claim_welcome_tour", { p_uid: "pending", p_surface: surface }));
    await act(async () => resolve({ data: true, error: null }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not repeat a remotely seen tour in an empty browser", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    render(<Tour userId="already-seen" firstName="Ana" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shares the pending claim during StrictMode and closes with Escape", async () => {
    render(<StrictMode><Tour userId="strict" firstName="Ana" /></StrictMode>);
    await screen.findByRole("dialog");
    expect(rpc).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    cleanup();
    rpc.mockResolvedValueOnce({ data: false, error: null });
    render(<Tour userId="strict" firstName="Ana" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a late claim after switching accounts", async () => {
    let resolve!: (result: { data: boolean; error: null }) => void;
    rpc.mockReturnValueOnce(new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce({ data: false, error: null });
    const { rerender } = render(<Tour key="a" userId="a" firstName="Ana" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    rerender(<Tour key="b" userId="b" firstName="Bea" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    await act(async () => resolve({ data: true, error: null }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rpc).toHaveBeenLastCalledWith("claim_welcome_tour", { p_uid: "b", p_surface: surface });
  });

  it.each(["transport", "server", "malformed"])("does not open on a %s failure and permits a later retry", async (failure) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    if (failure === "transport") rpc.mockRejectedValueOnce(new Error("private backend detail"));
    else rpc.mockResolvedValueOnce(failure === "server"
      ? { data: null, error: { message: "private backend detail" } }
      : { data: "true", error: null });
    render(<Tour userId={`failed-${failure}`} firstName="Ana" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => {});
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private backend detail");
    cleanup();
    render(<Tour userId={`failed-${failure}`} firstName="Ana" />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("works without browser storage access", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    render(<Tour userId="no-storage" firstName="Ana" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Skip the tour" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
