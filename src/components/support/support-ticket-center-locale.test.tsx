import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { SupportTicketCenter } from "@/components/support/support-ticket-center";
import type { SupportTicket } from "@/domain/support-ticket";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({
  user: { uid: "support-user", email: "user@example.test", displayName: "User $&" },
  subscribe: vi.fn(), create: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/support-tickets", () => ({
  subscribeToUserSupportTickets: mocks.subscribe,
  createSupportTicket: mocks.create,
}));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function center(locale: "en" | "es" = "en") {
  return <I18nProvider initialLocale={locale}><ChangeLanguage /><SupportTicketCenter /></I18nProvider>;
}
function changeLanguage() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
function deliver(rows: SupportTicket[] = []) { act(() => mocks.subscribe.mock.calls[0][1](rows)); }
function fillDraft() {
  fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "  Subject $&  " } });
  fireEvent.change(screen.getByRole("textbox", { name: "Details" }), { target: { value: "  My original question $$ $&  " } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "payment" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscribe.mockImplementation(() => vi.fn());
  mocks.create.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("support with the shipped dictionaries", () => {
  it("requires the separate fragment to be integrated in both real dictionaries", () => {
    expect(translate(getDictionary("en"), "supportCenter.create")).toBe("Create ticket");
    expect(translate(getDictionary("es"), "supportCenter.create")).toBe("Crear ticket");
    for (const key of ["eyebrow", "pageTitle", "pageDescription", "title", "description", "category", "subject", "subjectPlaceholder", "details", "detailsPlaceholder", "loadError", "validationError", "createError", "created", "creating", "create", "yourTickets", "loading", "empty", "replied"]) {
      const path = `supportCenter.${key}`;
      const english = translate(getDictionary("en"), path);
      const spanish = translate(getDictionary("es"), path);
      expect(english).not.toBe(path);
      expect(spanish).not.toBe(path);
      expect(spanish).not.toBe(english);
    }
  });

  it("localizes loading, accessible fields, placeholders and every category without resubscribing", () => {
    render(center());
    expect(screen.getByRole("status")).toHaveTextContent("Loading tickets...");
    changeLanguage();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tickets...");
    expect(screen.getByRole("heading", { name: "Crea un ticket de soporte." })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Asunto" })).toHaveAttribute("placeholder", "Resumen breve");
    expect(screen.getByRole("textbox", { name: "Detalles" })).toHaveAttribute("placeholder", "Explica qu\u00e9 ocurri\u00f3 y en qu\u00e9 necesitas ayuda.");
    const select = screen.getByRole("combobox", { name: "Categor\u00eda" });
    expect(within(select).getAllByRole("option").map(option => option.textContent)).toEqual(["Cuenta", "Curso", "Pago", "T\u00e9cnico", "Otro"]);
    expect(within(select).getAllByRole("option").map(option => (option as HTMLOptionElement).value)).toEqual(["account", "course", "payment", "technical", "other"]);
    deliver();
    expect(screen.getByText("Todav\u00eda no hay tickets de soporte.")).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each(["open", "in_review", "resolved"] as const)("localizes status %s and leaves the entire conversation literal", status => {
    render(center());
    deliver([{
      id: "ticket-1", userId: mocks.user.uid, userEmail: mocks.user.email, userName: mocks.user.displayName,
      category: "technical", status, subject: "Authorship $&", message: "Original question $$ $&", adminResponse: "Original reply $&",
    }]);
    changeLanguage();
    const ticket = screen.getByRole("article");
    expect(within(ticket).getByText("T\u00e9cnico")).toBeInTheDocument();
    expect(within(ticket).getByText({ open: "Abierto", in_review: "En revisi\u00f3n", resolved: "Resuelto" }[status])).toHaveAttribute("data-status", status);
    for (const text of ["Authorship $&", "Original question $$ $&", "Original reply $&", "SkillsetMind respondi\u00f3"]) {
      expect(within(ticket).getByText(text)).toBeInTheDocument();
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("relocalizes validation without discarding the draft or sending invalid input", () => {
    render(center());
    deliver();
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), { target: { value: "$&" } });
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a clear subject and enough detail before sending.");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("A\u00f1ade un asunto claro y suficientes detalles antes de enviar.");
    expect(screen.getByRole("textbox", { name: "Asunto" })).toHaveValue("$&");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("localizes read errors without exposing provider details", () => {
    render(center());
    act(() => mocks.subscribe.mock.calls[0][2](new Error("Private transport detail")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your support tickets.");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus tickets de soporte.");
    expect(screen.queryByText("Private transport detail")).toBeNull();
  });

  it("retains the draft and localizes an existing creation failure", async () => {
    mocks.create.mockRejectedValue(new Error("Private transport detail"));
    render(center());
    deliver();
    fillDraft();
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not create this support ticket.");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos crear este ticket de soporte.");
    expect(screen.getByRole("textbox", { name: "Asunto" })).toHaveValue("  Subject $&  ");
    expect(screen.getByRole("textbox", { name: "Detalles" })).toHaveValue("  My original question $$ $&  ");
    expect(screen.getByRole("combobox")).toHaveValue("payment");
    expect(screen.queryByText("Private transport detail")).toBeNull();
  });

  it("switches language during submission and after success, preserving the wire payload", async () => {
    let finish!: () => void;
    mocks.create.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(center());
    deliver();
    fillDraft();
    fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
    expect(screen.getByRole("button", { name: "Creating ticket..." })).toBeDisabled();
    changeLanguage();
    expect(screen.getByRole("button", { name: "Creando ticket..." })).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      userId: mocks.user.uid, userEmail: mocks.user.email, userName: mocks.user.displayName,
      category: "payment", subject: "  Subject $&  ", message: "  My original question $$ $&  ",
    });
    await act(async () => finish());
    expect(screen.getByRole("status")).toHaveTextContent("Ticket de soporte creado.");
    expect(screen.getByRole("textbox", { name: "Asunto" })).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveValue("course");
    changeLanguage();
    expect(screen.getByRole("status")).toHaveTextContent("Support ticket created.");
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });
});
