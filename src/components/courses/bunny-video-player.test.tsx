import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { BunnyVideoPlayer } from "./bunny-video-player";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

describe("Bunny playback locale", () => {
  beforeEach(() => { mocks.fetch.mockReset(); vi.stubGlobal("fetch", mocks.fetch); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it.each(["success", "failure"])("changes language around a pending %s without requesting playback again", async (outcome) => {
    let finish!: (response: Response) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    render(
      <I18nProvider initialLocale="en"><ChangeLanguage /><BunnyVideoPlayer assetId="asset-1" title="Aula $& íntegra" /></I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "Loading video..." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("heading", { name: "Cargando video..." })).toBeInTheDocument();
    expect(screen.getByText("Preparando la reproducción.")).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(new Response(JSON.stringify({ embedUrl: "https://iframe.mediadelivery.net/embed/library/video" }), {
        status: outcome === "success" ? 200 : 403,
      }));
    });
    const iframe = outcome === "success" ? screen.getByTitle("Aula $& íntegra") : null;
    if (outcome === "failure") {
      expect(screen.getByRole("heading", { name: "Video no disponible" })).toBeInTheDocument();
      expect(screen.getByText("No pudimos cargar este video. Actualiza la página e inténtalo de nuevo.")).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    if (iframe) expect(screen.getByTitle("Aula $& íntegra")).toBe(iframe);
    else expect(screen.getByText("We could not load this video. Refresh and try again.")).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/courses/video-token", expect.objectContaining({
      body: JSON.stringify({ assetId: "asset-1" }),
    }));
  });
});
