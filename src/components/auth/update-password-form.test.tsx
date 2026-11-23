import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { I18nProvider } from "@/components/i18n/i18n-provider";

const mocks = vi.hoisted(() => ({
  auth: { status: "authenticated" as string },
  completePasswordRecovery: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/auth/supabase-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/supabase-auth")>()),
  completePasswordRecovery: mocks.completePasswordRecovery,
}));

const newSecret = "UnchangedPassword42!";

function renderForm(recoveryVerified = true) {
  return render(
    <I18nProvider initialLocale="en">
      <UpdatePasswordForm recoveryVerified={recoveryVerified} />
    </I18nProvider>,
  );
}

// A-10 e A-12 na troca de senha pelo link do e-mail: regras antes de digitar,
// fora do <label>; o olho nos dois campos; e o titulo grande dizendo o estado.
describe("UpdatePasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: "authenticated" };
  });
  afterEach(cleanup);

  it("mostra as regras antes da primeira letra, ligadas ao campo, e um olho por campo", () => {
    renderForm();

    expect(screen.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeInTheDocument();
    const field = screen.getByLabelText("New password");
    const rules = screen.getByText("Your password must include:").closest("[id]")!;
    expect(field).toHaveAttribute("aria-describedby", rules.id);
    expect(rules.closest("label")).toBeNull();

    const eyes = screen.getAllByRole("button", { name: "Show password" });
    expect(eyes).toHaveLength(2);
    fireEvent.click(eyes[0]);
    expect(field).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
    // Um nome so, estado no aria-pressed; e o nome do campo e so o rotulo
    // (com o olho dentro do <label> ele virava "New password Show password").
    expect(eyes[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "New password" })).toBe(field);
    fireEvent.click(eyes[1]);
    expect(screen.getByRole("textbox", { name: "Confirm new password" })).toHaveAttribute("autocomplete", "new-password");
  });

  it("senhas diferentes: o aviso fica fora do rotulo e descreve o campo", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: newSecret } });
    const confirm = screen.getByLabelText("Confirm new password");
    fireEvent.change(confirm, { target: { value: "different" } });

    const warning = screen.getByText("The two passwords do not match.");
    expect(warning.closest("label")).toBeNull();
    expect(confirm).toHaveAttribute("aria-describedby", warning.id);
  });

  // F-12: o botao apagado diz por que, ligado a ele, e a frase some quando
  // a trava sai. Senhas diferentes: aponta para o aviso que ja existe.
  it("o botao apagado diz o que falta, ligado a ele", () => {
    renderForm();
    const update = screen.getByRole("button", { name: "Update password" });
    expect(update).toBeDisabled();
    // Antes de digitar, um convite, nao a frase de erro.
    expect(update).toHaveAccessibleDescription("Choose a password that meets the rules above.");

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: newSecret } });
    expect(update).toHaveAccessibleDescription("Type the password again to confirm it.");

    const confirm = screen.getByLabelText("Confirm new password");
    fireEvent.change(confirm, { target: { value: "different" } });
    expect(update).toHaveAccessibleDescription("The two passwords do not match.");
    expect(screen.getAllByText("The two passwords do not match.")).toHaveLength(1);

    fireEvent.change(confirm, { target: { value: newSecret } });
    expect(update).toBeEnabled();
    expect(update).not.toHaveAttribute("aria-describedby");
  });

  it("link vencido: o titulo diz isso, e o formulario nao aparece", () => {
    renderForm(false);

    expect(screen.getByRole("heading", { level: 1, name: "This link has expired" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("senha trocada: o titulo diz que deu certo", async () => {
    mocks.completePasswordRecovery.mockResolvedValue(undefined);
    renderForm();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: newSecret } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: newSecret } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Your password has been updated." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You're signed in and can use it next time.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(mocks.completePasswordRecovery).toHaveBeenCalledExactlyOnceWith(newSecret);
  });
});
