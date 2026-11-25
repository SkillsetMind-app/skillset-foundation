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
// The bot check returns the token right away, like a passed challenge.
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

function renderForm(props: { withdrawalConsentRequired?: boolean } = {}) {
  return render(
    <GuestCheckoutForm
      {...props}
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

// EU, EEA and United Kingdom: the immediate-access box appears unticked and the
// purchase only continues with it ticked.
describe("GuestCheckoutForm: immediate access (EU, EEA and United Kingdom)", () => {
  const consentLabel = "I want access now and I understand I lose my 14-day withdrawal right once access starts.";

  it("without the requirement, the box does not exist", () => {
    renderForm();
    expect(screen.queryByRole("checkbox", { name: consentLabel })).not.toBeInTheDocument();
  });

  it("with the requirement, the box starts unticked and holds the purchase until it is ticked", async () => {
    vi.mocked(startGuestCourseCheckout).mockResolvedValue("redirected");
    renderForm({ withdrawalConsentRequired: true });

    const consent = screen.getByRole("checkbox", { name: consentLabel });
    expect(consent).not.toBeChecked();

    fireEvent.change(nameField(), { target: { value: "Ana Prado" } });
    fireEvent.change(emailField(), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I agree to the SkillsetMind/ }));
    fireEvent.submit(nameField().closest("form") as HTMLFormElement);

    expect(await screen.findByRole("alert")).toHaveTextContent("Tick the box to confirm you want access now.");
    expect(startGuestCourseCheckout).not.toHaveBeenCalled();

    fireEvent.click(consent);
    fireEvent.submit(nameField().closest("form") as HTMLFormElement);

    await waitFor(() => expect(startGuestCourseCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "course-1", withdrawalConsent: true }),
    ));
  });
});

describe("GuestCheckoutForm: the house fields", () => {
  it("name and email use the house field, with a sentence-case label and the same attributes as before", () => {
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

    // A sentence-case label (no longer the 12px uppercase eyebrow), linked
    // by for/id; the required "*" is only visual.
    for (const [field, text] of [[name, "Full name"], [email, "Email"]] as const) {
      const label = container.querySelector(`label[for="${field.id}"]`) as HTMLElement;
      expect(label.firstChild?.textContent).toBe(text);
      expect(label).not.toHaveClass("uppercase");
      expect(label.querySelector('[aria-hidden="true"]')).toHaveTextContent("*");
      expect(field).toHaveAttribute("aria-invalid", "false");
      expect(field).not.toHaveAttribute("aria-describedby");
    }

    // The consent box and its sentence stay as they were.
    const consent = screen.getByRole("checkbox");
    expect(consent).toBeRequired();
    expect(consent).not.toHaveClass("field-input");
    expect(screen.getByRole("link", { name: "Terms of service" })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/legal/privacy");
    // The same box confirms adulthood (Terms §1): no new sentence and no extra box.
    expect(consent).toHaveAccessibleName(/^I am 18 or older and I agree to the SkillsetMind Terms of service and Privacy policy\.$/);
  });

  it("a valid form sends exactly the same request as before", async () => {
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

  it("a rejected name or email: the sentence stays on the pair of fields and both point to it", async () => {
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
    // Right under the email, before the button; and no longer repeated at the end.
    expect(emailField().nextElementSibling).toBe(message);
    const submit = screen.getByRole("button", { name: "Enroll — $49.00" });
    expect(message.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(invalidMessage)).toHaveLength(1);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("other errors stay in the notice at the end, without marking the fields", async () => {
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

  it("without the consent, the notice stays at the end and nothing is sent", async () => {
    renderForm();

    fireEvent.change(nameField(), { target: { value: "Ana" } });
    fireEvent.change(emailField(), { target: { value: "ana@example.com" } });
    fireEvent.submit(nameField().closest("form") as HTMLFormElement);

    expect(await screen.findByRole("alert")).toHaveTextContent("Accept the Terms of Service and Privacy Policy to continue.");
    expect(nameField()).toHaveAttribute("aria-invalid", "false");
    expect(startGuestCourseCheckout).not.toHaveBeenCalled();
  });

  it("the pay button says the same as before, at rest and while waiting", async () => {
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
