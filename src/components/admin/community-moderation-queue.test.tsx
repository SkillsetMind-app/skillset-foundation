import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommunityModerationQueue } from "@/components/admin/community-moderation-queue";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { CommunityReport } from "@/domain/community-report";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), update: vi.fn(), configured: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseClientConfig: () => mocks.configured ? { url: "https://example.test" } : null }));
vi.mock("@/lib/data/community-posts", () => ({ subscribeToCommunityReports: mocks.subscribe, updateCommunityReportStatus: mocks.update }));
const report: CommunityReport = { id: "report-$$-$&", courseSlug: "course-$$-$&", postId: "post-a", commentId: null, targetType: "post", targetAuthorId: "author-a", targetAuthorName: "Álvarez $$ $&", reporterId: "reporter-a", reporterName: "Ana $$ $&", reporterEmail: null, reason: "spam", detail: 'Contexto original $$50 $& "áéí"', status: "open" };
function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function panel() { return <I18nProvider initialLocale="en"><ChangeLanguage /><CommunityModerationQueue /></I18nProvider>; }
function language() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
function deliver(rows = [report]) { act(() => mocks.subscribe.mock.calls[0][0](rows)); }
beforeEach(() => { vi.clearAllMocks(); mocks.configured = true; mocks.subscribe.mockImplementation(() => vi.fn()); mocks.update.mockResolvedValue(undefined); });
afterEach(cleanup);

describe("community report presentation", () => {
  it.each([
    ["spam", "Spam o promoción"], ["harassment", "Acoso o abuso"], ["unsafe_content", "Contenido peligroso"], ["off_topic", "Fuera de tema o de baja calidad"], ["other", "Otro problema de confianza"],
  ] as const)("translates reason %s without changing author content", (reason, label) => {
    render(panel());
    deliver([{ ...report, reason }]);
    language();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Abierto")).toHaveAttribute("data-status", "open");
    expect(screen.getByText(`Publicación en ${report.courseSlug}`)).toBeInTheDocument();
    expect(screen.getByText(report.targetAuthorName)).toBeInTheDocument();
    expect(screen.getByText(report.reporterName)).toBeInTheDocument();
    expect(screen.getByText(`Contexto: ${report.detail}`)).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2])("shows %i confirmed open reports in Spanish", count => {
    render(panel());
    expect(screen.queryByText("0 open")).toBeNull();
    language();
    deliver(Array.from({ length: count }, (_, index) => ({ ...report, id: `report-${index}`, targetType: "comment" as const, commentId: `comment-${index}` })));
    expect(screen.getByText(count === 1 ? "1 abierta" : `${count} abiertas`)).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(count);
    if (count) expect(screen.getAllByText(`Comentario en ${report.courseSlug}`)).toHaveLength(count);
    else expect(screen.getByText("Todavía no hay denuncias de la comunidad.")).toBeInTheDocument();
  });

  it.each([
    ["reviewed", "Revisado"], ["resolved", "Resuelto"], ["dismissed", "Descartado"],
  ] as const)("sends canonical %s and keeps the current status while the write is pending", async (status, label) => {
    let finish!: () => void;
    mocks.update.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(panel());
    deliver();
    language();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(mocks.update).toHaveBeenCalledWith(report, status);
    expect(screen.getByText("Abierto")).toBeInTheDocument();
    // Só o botão apertado gira; os três travam e mantêm o nome (I-08).
    expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-busy", "true");
    for (const name of ["Revisado", "Resuelto", "Descartado"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getAllByRole("button").filter((button) => button.getAttribute("aria-busy") === "true")).toHaveLength(1);
    language();
    await act(async () => finish());
    expect(screen.getByText("Open")).toBeInTheDocument();
    deliver([{ ...report, status }]);
    language();
    expect(screen.getByText(label, { selector: "span[data-status]" })).toHaveAttribute("data-status", status);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it("lists open reports first, twelve at a time, and offers only the other statuses (I-09)", () => {
    render(panel());
    const closed = [0, 1].map((index): CommunityReport => ({ ...report, id: `closed-${index}`, status: "reviewed", reporterName: `Fechada ${index}` }));
    const open = Array.from({ length: 12 }, (_, index): CommunityReport => ({ ...report, id: `open-${index}`, reporterName: `Aberta ${index}` }));
    deliver([...closed, ...open]);
    const reporters = () => screen.getAllByRole("article").map((card) => within(card).getByText(/^(Aberta|Fechada) \d+$/).textContent);
    expect(reporters()).toEqual(open.map((entry) => entry.reporterName));
    const moves = (card: HTMLElement) => within(within(card).getByRole("group", { name: "Move to" })).getAllByRole("button").map((button) => button.textContent);
    expect(moves(screen.getAllByRole("article")[0])).toEqual(["Reviewed", "Resolved", "Dismissed"]);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(reporters()).toEqual([...open, ...closed].map((entry) => entry.reporterName));
    expect(moves(screen.getAllByRole("article")[13])).toEqual(["Resolved", "Dismissed"]);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
    language();
    expect(screen.getAllByRole("group", { name: "Mover a" })).toHaveLength(14);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not show a rejected action as resolved or expose provider details", async () => {
    mocks.update.mockRejectedValue(new Error("Private update detail"));
    render(panel());
    deliver();
    fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
    await screen.findByRole("alert");
    language();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos actualizar el estado de esta denuncia.");
    expect(screen.getByText("Abierto")).toBeInTheDocument();
    expect(screen.queryByText("Private update detail")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("distinguishes missing configuration from empty reports", () => {
    mocks.configured = false;
    render(panel());
    language();
    expect(screen.getByText("Es necesario configurar el servicio para cargar las denuncias de la comunidad.")).toBeInTheDocument();
    expect(screen.queryByText("0 abiertas")).toBeNull();
    expect(screen.queryByText("Todavía no hay denuncias de la comunidad.")).toBeNull();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("distinguishes failed loading from empty and recovers in the active locale", () => {
    render(panel());
    expect(screen.getByRole("status")).toHaveTextContent("Loading community reports");
    act(() => mocks.subscribe.mock.calls[0][1](new Error("Private read detail")));
    language();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar las denuncias de la comunidad.");
    expect(screen.queryByText("Todavía no hay denuncias de la comunidad.")).toBeNull();
    deliver([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Todavía no hay denuncias de la comunidad.")).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });
});
