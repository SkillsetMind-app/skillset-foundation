import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupportTicketQueue } from "@/components/admin/support-ticket-queue";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { SupportTicket } from "@/domain/support-ticket";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), update: vi.fn(), reply: vi.fn(), exportRows: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: { uid: "operator", roles: ["admin"] } }) }));
vi.mock("@/lib/data/support-tickets", () => ({
  subscribeToAdminSupportTickets: mocks.subscribe,
  updateSupportTicketStatus: mocks.update,
  respondToSupportTicket: mocks.reply,
}));
vi.mock("@/components/shared/export-table-button", () => ({
  ExportTableButton: ({ rows }: { rows: unknown[] }) => { mocks.exportRows(rows); return null; },
}));

const tickets: SupportTicket[] = [
  { id: "ticket-a", userId: "learner-a", userName: "Ana Rivera", userEmail: "ana@example.test", subject: "Alpha course", message: "The first video is unavailable.", category: "course", status: "open" },
  { id: "ticket-b", userId: "learner-b", userName: "Bruno Silva", userEmail: "bruno@example.test", subject: "Beta payment", message: "Question about an invoice.", category: "payment", status: "resolved", adminResponse: "Your original reply." },
];

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function queue(query = "") {
  return <I18nProvider initialLocale="en"><ChangeLanguage /><SupportTicketQueue query={query} /></I18nProvider>;
}
function deliver(rows = tickets) {
  act(() => mocks.subscribe.mock.calls[0][0](rows));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscribe.mockImplementation(() => vi.fn());
  mocks.update.mockResolvedValue(undefined);
  mocks.reply.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("support queue search, states and language", () => {
  it.each(["ALPHA", " ana@example.test ", "first video"])("filters loaded records by %s without another subscription", query => {
    const { rerender } = render(queue());
    deliver();
    rerender(queue(query));
    expect(screen.getByRole("heading", { name: "Alpha course" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Beta payment" })).toBeNull();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(mocks.exportRows).toHaveBeenLastCalledWith([expect.objectContaining({ id: "ticket-a", category: "Course", status: "Open" })]);
  });

  it("distinguishes loading, failed read, empty queue and no search results", () => {
    const { rerender } = render(queue());
    expect(screen.getByRole("status")).toHaveTextContent("Loading support tickets");
    act(() => mocks.subscribe.mock.calls[0][1](new Error("Private provider detail")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load support tickets.");
    expect(screen.queryByText(/No support tickets/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los tickets de soporte.");
    expect(screen.queryByText("Private provider detail")).toBeNull();
    deliver([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Todavía no hay tickets de soporte.")).toBeInTheDocument();
    deliver();
    rerender(queue("missing"));
    expect(screen.getByText("Ningún ticket coincide con esta búsqueda.")).toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay tickets de soporte.")).toBeNull();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps the labelled reply draft through filtering, language and failure, then confirms success", async () => {
    const { rerender } = render(queue("Alpha"));
    deliver();
    fireEvent.change(screen.getByRole("textbox", { name: "Reply to user" }), { target: { value: "  Resposta autoral preservada.  " } });
    rerender(queue("Beta"));
    rerender(queue("Alpha"));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("textbox", { name: "Respuesta al usuario" })).toHaveValue("  Resposta autoral preservada.  ");
    expect(screen.getByText("Curso")).toBeInTheDocument();
    expect(screen.getAllByText("Abierto")).toHaveLength(2);
    mocks.reply.mockRejectedValueOnce(new Error("Internal operation detail"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar respuesta y resolver" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos enviar esta respuesta.");
    expect(screen.getByRole("textbox", { name: "Respuesta al usuario" })).toHaveValue("  Resposta autoral preservada.  ");
    expect(screen.queryByText("Respuesta enviada y ticket resuelto.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not send this reply.");
    fireEvent.click(screen.getByRole("button", { name: "Send reply and resolve" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Reply sent and ticket resolved.");
    expect(mocks.reply).toHaveBeenLastCalledWith("ticket-a", "Resposta autoral preservada.", "operator");
    expect(screen.getByRole("textbox", { name: "Reply to user" })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("status")).toHaveTextContent("Respuesta enviada y ticket resuelto.");
    expect(mocks.reply).toHaveBeenCalledTimes(2);
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps status writes canonical and localizes their failure and success", async () => {
    render(queue("Alpha"));
    deliver();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    mocks.update.mockRejectedValueOnce(new Error("Private detail"));
    fireEvent.click(screen.getByRole("button", { name: "En revisión" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos actualizar este ticket de soporte.");
    expect(mocks.update).toHaveBeenLastCalledWith("ticket-a", "in_review");
    fireEvent.click(screen.getByRole("button", { name: "En revisión" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Estado del ticket actualizado."));
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it("announces success only after a pending reply has completed", async () => {
    let finishReply!: () => void;
    mocks.reply.mockReturnValue(new Promise<void>(resolve => { finishReply = resolve; }));
    render(queue("Alpha"));
    deliver();
    fireEvent.change(screen.getByRole("textbox", { name: "Reply to user" }), { target: { value: "This is the original reply." } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply and resolve" }));
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Enviando..." })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Respuesta al usuario" })).toHaveValue("This is the original reply.");
    await act(async () => finishReply());
    expect(screen.getByRole("status")).toHaveTextContent("Respuesta enviada y ticket resuelto.");
  });
});
