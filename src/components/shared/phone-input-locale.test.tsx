import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { isValidE164Phone, PhoneInput } from "@/components/shared/phone-input";

const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() }, onChange: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}

function ControlledPhone({ initialValue, label }: { initialValue: string; label?: string }) {
  const [value, setValue] = useState(initialValue);
  return <PhoneInput value={value} label={label} onChange={(next) => { mocks.onChange(next); setValue(next); }} />;
}

// The parent merges phoneInput into the shipped dictionaries before running this file.
function renderPhone(initialValue = "+15551234567", label?: string) {
  return render(
    <I18nProvider initialLocale="es">
      <ChangeLanguage />
      <ControlledPhone initialValue={initialValue} label={label} />
    </I18nProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("PhoneInput locale", () => {
  it("keeps the draft while an outside language click closes the menu, then reopens translated options", () => {
    renderPhone();
    expect(screen.getByText("Tel\u00e9fono")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Tel\u00e9fono" });
    expect(screen.getByLabelText("Tel\u00e9fono")).toBe(input);
    expect(input).toHaveAttribute("placeholder", "N\u00famero de tel\u00e9fono");
    expect(input).toHaveAccessibleDescription("Se guarda en formato internacional E.164, por ejemplo +15551234567.");
    expect(input).toHaveValue("5551234567");
    expect(screen.getByText("Se guarda en formato internacional E.164, por ejemplo +15551234567.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "(212) 555-1234" } });
    expect(mocks.onChange).toHaveBeenCalledExactlyOnceWith("+12125551234");
    const toggle = screen.getByRole("button", { name: "C\u00f3digo de pa\u00eds: US +1 (Estados Unidos)" });
    expect(toggle).toHaveTextContent("US +1");
    fireEvent.click(toggle);
    for (const name of ["Estados Unidos +1", "Brasil +55", "Reino Unido +44", "Guyana +592", "M\u00e9xico +52"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }

    const languageButton = screen.getByRole("button", { name: "Change language" });
    fireEvent.mouseDown(languageButton);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Estados Unidos +1" })).not.toBeInTheDocument();
    fireEvent.click(languageButton);
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Phone number")).toBe(input);
    expect(screen.getByRole("textbox", { name: "Phone" })).toBe(input);
    expect(screen.getByRole("button", { name: "Country code: US +1 (United States)" })).toBe(toggle);
    expect(input).toHaveAccessibleDescription("Stored in international E.164 format, such as +15551234567.");
    expect(input).toHaveValue("2125551234");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "United States +1" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Stored in international E.164 format, such as +15551234567.")).toBeInTheDocument();
    for (const name of ["United States +1", "Brazil +55", "United Kingdom +44", "Guyana +592", "Mexico +52"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(mocks.onChange).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Brazil +55" })).not.toBeInTheDocument();
  });

  it("keeps explicit labels untouched across a locale switch", () => {
    renderPhone("+15551234567", "My contact $&");
    const input = screen.getByRole("textbox", { name: "My contact $&" });
    expect(screen.getByLabelText("My contact $&")).toBe(input);
    expect(screen.queryByText("Tel\u00e9fono")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("textbox", { name: "My contact $&" })).toBe(input);
    expect(screen.getByPlaceholderText("Phone number")).toHaveValue("5551234567");
    expect(mocks.onChange).not.toHaveBeenCalled();
  });

  it("preserves country codes, national digit truncation and blank-value behavior", () => {
    renderPhone("+5511987654321");
    fireEvent.click(screen.getByRole("button", { name: "C\u00f3digo de pa\u00eds: BR +55 (Brasil)" }));
    fireEvent.click(screen.getByRole("button", { name: "Reino Unido +44" }));
    expect(mocks.onChange).toHaveBeenLastCalledWith("+441198765432");
    expect(screen.getByRole("button", { name: "C\u00f3digo de pa\u00eds: GB +44 (Reino Unido)" })).toHaveAttribute("aria-expanded", "false");
    const input = screen.getByRole("textbox", { name: "Tel\u00e9fono" });
    expect(input).toHaveValue("1198765432");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(mocks.onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Country code: GB +44 (United Kingdom)" }));
    fireEvent.click(screen.getByRole("button", { name: "Guyana +592" }));
    expect(mocks.onChange).toHaveBeenLastCalledWith("+5921198765");
    fireEvent.change(input, { target: { value: "abc 123-45678" } });
    expect(mocks.onChange).toHaveBeenLastCalledWith("+5921234567");
    fireEvent.change(input, { target: { value: "" } });
    expect(mocks.onChange).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("button", { name: "Country code: US +1 (United States)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Country code: US +1 (United States)" }));
    fireEvent.click(screen.getByRole("button", { name: "Mexico +52" }));
    expect(mocks.onChange).toHaveBeenLastCalledWith("");
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Country code: US +1 (United States)" })).toHaveAttribute("aria-expanded", "false");
  });

  it("retains the English fallback without a provider", () => {
    render(<PhoneInput value="+15551234567" onChange={mocks.onChange} />);
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("5551234567");
    fireEvent.click(screen.getByRole("button", { name: "Country code: US +1 (United States)" }));
    expect(screen.getByRole("button", { name: "United States +1" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.getByRole("button", { name: "Country code: US +1 (United States)" })).toHaveAttribute("aria-expanded", "false");
    expect(mocks.onChange).not.toHaveBeenCalled();
  });

  it("associates each explicit label with its own textbox", () => {
    render(
      <I18nProvider initialLocale="es">
        <PhoneInput label="Personal" value="+15551234567" onChange={mocks.onChange} />
        <PhoneInput label="Work" value="+5511987654321" onChange={mocks.onChange} />
      </I18nProvider>,
    );
    const personal = screen.getByRole("textbox", { name: "Personal" });
    const work = screen.getByRole("textbox", { name: "Work" });
    expect(screen.getByLabelText("Personal")).toBe(personal);
    expect(screen.getByLabelText("Work")).toBe(work);
    expect(personal.id).not.toBe(work.id);
    expect(personal.closest("label")).toBeNull();
    expect(work.closest("label")).toBeNull();
    expect(personal).toHaveValue("5551234567");
    expect(work).toHaveValue("11987654321");
    expect(screen.getByRole("button", { name: "C\u00f3digo de pa\u00eds: US +1 (Estados Unidos)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "C\u00f3digo de pa\u00eds: BR +55 (Brasil)" })).toBeInTheDocument();
  });

  it("preserves E.164 validation boundaries for every supported country", () => {
    expect(isValidE164Phone("")).toBe(true);
    expect(isValidE164Phone("15551234567")).toBe(false);
    expect(isValidE164Phone("+33123456789")).toBe(false);
    for (const [dialCode, min, max] of [["+1", 10, 10], ["+55", 10, 11], ["+44", 10, 10], ["+592", 7, 7], ["+52", 10, 10]] as const) {
      expect(isValidE164Phone(dialCode + "2".repeat(min - 1))).toBe(false);
      expect(isValidE164Phone(dialCode + "2".repeat(min))).toBe(true);
      expect(isValidE164Phone(dialCode + "2".repeat(max))).toBe(true);
      expect(isValidE164Phone(dialCode + "2".repeat(max + 1))).toBe(false);
    }
  });
});
