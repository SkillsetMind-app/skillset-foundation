import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorVerificationQueue } from "@/components/admin/creator-verification-queue";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { CreatorVerificationCase } from "@/domain/creator-verification";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), review: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/data/creator-verification", () => ({
  subscribeToVerificationQueue: mocks.subscribe,
  reviewCreatorVerification: mocks.review,
}));

const cases: CreatorVerificationCase[] = [
  { id: "case-a", creatorId: "creator-a", applicantName: "Ana Rivera", applicantEmail: "ana@example.test", status: "pending", profession: "Facilitadora autoral", registrationType: "Registry", registrationId: "REG-100", registrationRegion: "Florida", evidenceLinks: [], note: "Nota original da candidata.", createdAt: "2026-08-20T13:00:00.000Z", updatedAt: "2026-08-20T13:00:00.000Z" },
  { id: "case-b", creatorId: "creator-b", applicantName: "Bruno Silva", applicantEmail: "bruno@example.test", status: "pending", profession: "Mentor", registrationType: "Registry", registrationId: "REG-200", registrationRegion: "Texas", evidenceLinks: [], createdAt: "2026-08-21T13:00:00.000Z", updatedAt: "2026-08-21T13:00:00.000Z" },
];

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function queue(query = "") {
  return <I18nProvider initialLocale="en"><ChangeLanguage /><CreatorVerificationQueue query={query} /></I18nProvider>;
}
function deliver(rows = cases) { act(() => mocks.subscribe.mock.calls[0][0](rows)); }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscribe.mockImplementation(() => vi.fn());
  mocks.review.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("verification queue search, states and language", () => {
  it.each(["en", "es"] as const)("preserves literal dollar sequences in the applicant note in %s", locale => {
    const note = "Certificado custa $$50; código literal $&.";
    render(queue());
    if (locale === "es") fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    deliver([{ ...cases[0], note }]);
    const prefix = locale === "es" ? "Nota del solicitante: " : "Applicant note: ";
    expect(screen.getByText(`${prefix}${note}`)).toBeInTheDocument();
  });

  it.each(["ANA RIVERA", " ana@example.test ", "REG-100", "Florida"])("filters existing applications by %s without another subscription", query => {
    const { rerender } = render(queue());
    deliver();
    rerender(queue(query));
    expect(screen.getByRole("heading", { name: "Ana Rivera" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bruno Silva" })).toBeNull();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it("does not turn a read failure into an empty queue and recovers in the active language", () => {
    const { rerender } = render(queue());
    expect(screen.getByRole("status")).toHaveTextContent("Loading verification queue");
    act(() => mocks.subscribe.mock.calls[0][1](new Error("Private provider detail")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load the verification queue.");
    expect(screen.queryByText(/No verification applications/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar la cola de verificación.");
    deliver([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("No hay solicitudes de verificación pendientes.")).toBeInTheDocument();
    deliver();
    rerender(queue("missing"));
    expect(screen.getByText("Ninguna solicitud coincide con esta búsqueda.")).toBeInTheDocument();
    expect(screen.queryByText("No hay solicitudes de verificación pendientes.")).toBeNull();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it("retains the review note and validation while changing language and localizes the date", () => {
    const { rerender } = render(queue("REG-100"));
    deliver();
    fireEvent.change(screen.getByRole("textbox", { name: "Review note to creator" }), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 12 characters");
    expect(mocks.review).not.toHaveBeenCalled();
    rerender(queue("REG-200"));
    rerender(queue("REG-100"));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("textbox", { name: "Nota de revisión para el creador" })).toHaveValue("short");
    expect(screen.getByRole("alert")).toHaveTextContent("al menos 12 caracteres");
    expect(screen.getByText("Facilitadora autoral")).toBeInTheDocument();
    expect(screen.getByText(/Nota original da candidata\./)).toBeInTheDocument();
    expect(screen.getByText(new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(cases[0].createdAt)))).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each(["approved", "needs_changes", "rejected"] as const)("sends canonical decision %s and preserves the creator's note", async decision => {
    render(queue("REG-100"));
    deliver();
    fireEvent.change(screen.getByRole("textbox", { name: "Review note to creator" }), { target: { value: "  Nota autoral da revisão.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    const label = { approved: "Aprobar", needs_changes: "Solicitar cambios", rejected: "Rechazar" }[decision];
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("status")).toHaveTextContent(/creador|solicitud/i);
    expect(mocks.review).toHaveBeenCalledWith("case-a", decision, "Nota autoral da revisão.");
    expect(screen.queryByRole("heading", { name: "Ana Rivera" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Creator approved|Application returned|Application rejected/);
    expect(mocks.review).toHaveBeenCalledTimes(1);
  });

  it("retains the application and draft when recording the review fails", async () => {
    mocks.review.mockRejectedValue(new Error("Private RPC details"));
    render(queue("REG-100"));
    deliver();
    fireEvent.change(screen.getByRole("textbox", { name: "Review note to creator" }), { target: { value: "A nota precisa continuar aqui." } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not record this decision.");
    expect(screen.queryByText("Private RPC details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos registrar esta decisión.");
    expect(screen.getByRole("textbox", { name: "Nota de revisión para el creador" })).toHaveValue("A nota precisa continuar aqui.");
    expect(screen.getByRole("heading", { name: "Ana Rivera" })).toBeInTheDocument();
  });

  it("keeps an application visible until the pending decision is confirmed", async () => {
    let finishReview!: () => void;
    mocks.review.mockReturnValue(new Promise<void>(resolve => { finishReview = resolve; }));
    render(queue("REG-100"));
    deliver();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByRole("heading", { name: "Ana Rivera" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getAllByRole("button", { name: "Actualizando..." })).toHaveLength(3);
    for (const button of screen.getAllByRole("button", { name: "Actualizando..." })) expect(button).toBeDisabled();
    await act(async () => finishReview());
    expect(screen.queryByRole("heading", { name: "Ana Rivera" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Creador aprobado");
    expect(mocks.review).toHaveBeenCalledWith("case-a", "approved", null);
  });
});
