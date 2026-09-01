import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomDomainsPanel } from "@/components/teacher/custom-domains-panel";

const domains = [
  {
    id: "dom-1",
    hostname: "aulas.exemplo.com",
    status: "pending_dns",
    verification_name: null,
    verification_value: null,
    error_reason: null,
  },
  {
    id: "dom-2",
    hostname: "live.exemplo.com",
    status: "active",
    verification_name: null,
    verification_value: null,
    error_reason: null,
  },
  {
    id: "dom-3",
    hostname: "erro.exemplo.com",
    status: "error",
    verification_name: null,
    verification_value: null,
    error_reason: "The record points somewhere else.",
  },
];

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

describe("CustomDomainsPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ domains, quota: { used: 3, limit: 3 }, configured: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // P-26: o painel pintava o status com bg-amber-100/bg-emerald-100/bg-red-100 —
  // paleta crua que não acompanha o tema escuro e usa um vocabulário que
  // nenhuma outra tela do estúdio usa. O chip da casa já resolvia tudo isso.
  it("usa o StatusChip da casa para o status de cada domínio", async () => {
    const { container } = render(<CustomDomainsPanel />);

    await screen.findByText("aulas.exemplo.com");

    const pending = container.querySelector('[data-status="pending_dns"]');
    expect(pending).toHaveClass("status-chip", "status-chip--warning");
    expect(pending).toHaveTextContent("Waiting for DNS");
    expect(container.querySelector('[data-status="active"]')).toHaveClass(
      "status-chip--success",
    );
    expect(container.querySelector('[data-status="error"]')).toHaveClass(
      "status-chip--danger",
    );
    expect(container.innerHTML).not.toMatch(/bg-(amber|emerald|red)-\d{2,3}/);
  });

  // P-07: "Disconnect" derrubava o domínio em um clique, sem confirmação, a
  // 8px do "Check again" que o professor martela enquanto o DNS propaga.
  it("pede confirmação antes de desconectar o domínio", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<CustomDomainsPanel />);
    await screen.findByText("aulas.exemplo.com");

    const [disconnect] = screen.getAllByRole("button", { name: /Disconnect/ });
    fireEvent.click(disconnect);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("aulas.exemplo.com"));
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "DELETE" }),
    );

    confirmSpy.mockReturnValue(true);
    fireEvent.click(disconnect);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/teach/domains/dom-1", {
        method: "DELETE",
      });
    });
  });

  it("veste Disconnect como ação de perigo, não como gêmeo do Check again", async () => {
    render(<CustomDomainsPanel />);
    await screen.findByText("aulas.exemplo.com");

    const [disconnect] = screen.getAllByRole("button", { name: /Disconnect/ });
    const [recheck] = screen.getAllByRole("button", { name: /Check again/ });
    expect(disconnect).toHaveClass("button-danger");
    expect(recheck).toHaveClass("button-outline");
  });
});
