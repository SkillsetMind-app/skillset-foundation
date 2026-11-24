import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GuestCheckoutForm } from "@/components/courses/guest-checkout-form";
import { startGuestCourseCheckout } from "@/lib/payments/checkout";
import { PaymentRequestError } from "@/lib/payments/client-fetch";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ locale: "en", t: (key: string) => translate(getDictionary("en"), key) }),
}));
vi.mock("@/lib/payments/checkout", () => ({ startGuestCourseCheckout: vi.fn() }));
// A verificação contra robô devolve o token na hora, como um desafio aprovado.
vi.mock("@/components/auth/turnstile-widget", async () => {
  const { useEffect } = await import("react");
  return {
    TurnstileWidget: ({ onToken }: { onToken: (token: string) => void }) => {
      useEffect(() => onToken("turnstile-token"), [onToken]);
      return null;
    },
  };
});
vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: true }));
vi.mock("@/lib/auth/supabase-auth", () => ({ signInWithGoogle: vi.fn(() => new Promise(() => {})) }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const invalidMessage = "Enter your name and a valid email, and accept the terms.";

function renderForm() {
  return render(
    <GuestCheckoutForm
      courseId="course-1"
      offerId="offer-1"
      offerCode="LAUNCH"
      priceId="price-1"
      returnTo="/courses/course-1/checkout"
      submitLabel="Enroll — $49.00"
      disabled={false}
      errorKeyFor={() => "publicCourses.enrollError"}
    />,
  );
}

const nameField = () => screen.getByRole("textbox", { name: "Full name" });
const emailField = () => screen.getByRole("textbox", { name: "Email" });

function fillAndSubmit() {
  fireEvent.change(nameField(), { target: { value: " Ana Prado " } });
  fireEvent.change(emailField(), { target: { value: " ana@example.com " } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(nameField().closest("form") as HTMLFormElement);
}

describe("GuestCheckoutForm: os campos da casa", () => {
  it("nome e e-mail usam o campo da casa, com rótulo em frase e os mesmos atributos de antes", () => {
    const { container } = renderForm();

    const name = nameField();
    expect(name).toHaveClass("field-input");
    expect(name).toHaveAttribute("autocomplete", "name");
    expect(name).toHaveAttribute("maxlength", "80");
    expect(name).toBeRequired();
    expect(name).toHaveAttribute("data-cta-focus");
    expect(name).not.toHaveAttribute("type");
    expect(name).not.toHaveAttribute("name");

    const email = emailField();
    expect(email).toHaveClass("field-input");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("inputmode", "email");
    expect(email).toHaveAttribute("maxlength", "254");
    expect(email).toBeRequired();
    expect(email).not.toHaveAttribute("name");

    // Rótulo em frase (não mais a sobrelinha de 12px em caixa alta), ligado
    // pelo for/id; o "*" de obrigatório é só visual.
    for (const [field, text] of [[name, "Full name"], [email, "Email"]] as const) {
      const label = container.querySelector(`label[for="${field.id}"]`) as HTMLElement;
      expect(label.firstChild?.textContent).toBe(text);
      expect(label).not.toHaveClass("uppercase");
      expect(label.querySelector('[aria-hidden="true"]')).toHaveTextContent("*");
      expect(field).toHaveAttribute("aria-invalid", "false");
      expect(field).not.toHaveAttribute("aria-describedby");
    }

    // A caixa de aceite e a frase dela seguem como eram.
    const consent = screen.getByRole("checkbox");
    expect(consent).toBeRequired();
    expect(consent).not.toHaveClass("field-input");
    expect(screen.getByRole("link", { name: "Terms of service" })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/legal/privacy");
    // A mesma caixa confirma a maioridade (Termos §1): sem frase nova nem caixa a mais.
    expect(consent).toHaveAccessibleName(/^I am 18 or older and I agree to the SkillsetMind Terms of service and Privacy policy\.$/);
  });

  it("um formulário válido manda exatamente o mesmo pedido de antes", async () => {
    vi.mocked(startGuestCourseCheckout).mockResolvedValue("redirected");
    renderForm();

    fillAndSubmit();

    await waitFor(() => expect(startGuestCourseCheckout).toHaveBeenCalledTimes(1));
    expect(vi.mocked(startGuestCourseCheckout).mock.calls[0][0]).toStrictEqual({
      courseId: "course-1",
      name: "Ana Prado",
      email: "ana@example.com",
      captchaToken: "turnstile-token",
      offerId: "offer-1",
      offerCode: "LAUNCH",
      priceId: "price-1",
    });
  });

  it("nome ou e-mail recusados: a frase fica no par de campos e os dois apontam para ela", async () => {
    vi.mocked(startGuestCourseCheckout).mockRejectedValue(new PaymentRequestError("x", 400, "invalid_request"));
    const { container } = renderForm();

    fillAndSubmit();

    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent(invalidMessage);
    expect(emailField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(emailField()).toHaveAttribute("aria-describedby", message.id);
    expect(nameField()).toHaveAttribute("aria-describedby", message.id);
    expect(emailField()).toHaveAccessibleDescription(invalidMessage);
    expect(nameField()).toHaveAccessibleDescription(invalidMessage);
    // Logo embaixo do e-mail, antes do botão; e não mais repetida no fim.
    expect(emailField().nextElementSibling).toBe(message);
    const submit = screen.getByRole("button", { name: "Enroll — $49.00" });
    expect(message.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(invalidMessage)).toHaveLength(1);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("os outros erros seguem no aviso do fim, sem marcar os campos", async () => {
    vi.mocked(startGuestCourseCheckout).mockRejectedValue(new PaymentRequestError("x", 502, "send_failed"));
    renderForm();

    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't send the email right now. Please try again in a moment.");
    expect(nameField()).toHaveAttribute("aria-invalid", "false");
    expect(emailField()).toHaveAttribute("aria-invalid", "false");
    expect(emailField()).not.toHaveAttribute("aria-describedby");
    const submit = screen.getByRole("button", { name: "Enroll — $49.00" });
    expect(submit.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sem o aceite, o aviso segue no fim e nada é enviado", async () => {
    renderForm();

    fireEvent.change(nameField(), { target: { value: "Ana" } });
    fireEvent.change(emailField(), { target: { value: "ana@example.com" } });
    fireEvent.submit(nameField().closest("form") as HTMLFormElement);

    expect(await screen.findByRole("alert")).toHaveTextContent("Accept the Terms of Service and Privacy Policy to continue.");
    expect(nameField()).toHaveAttribute("aria-invalid", "false");
    expect(startGuestCourseCheckout).not.toHaveBeenCalled();
  });

  it("o botão de pagar diz o mesmo de antes, em repouso e esperando", async () => {
    vi.mocked(startGuestCourseCheckout).mockReturnValue(new Promise<never>(() => {}));
    renderForm();

    const submit = screen.getByRole("button", { name: "Enroll — $49.00" });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit).toBeEnabled();

    fillAndSubmit();

    const waiting = await screen.findByRole("button", { name: "Opening secure checkout..." });
    expect(waiting).toBe(submit);
    expect(waiting).toBeDisabled();
  });
});
