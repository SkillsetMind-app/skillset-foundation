import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { UploadProgressNote } from "./upload-progress-note";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

describe("upload progress locale", () => {
  it.each([
    { percent: null, state: "running" as const, en: "Sending...", es: "Enviando..." },
    { percent: 50, state: "running" as const, en: "Uploading", es: "Subiendo" },
    { percent: 100, state: "success" as const, en: "Upload complete", es: "Subida completada" },
  ])("translates the $state state at $percent without inventing progress", ({ percent, state, en, es }) => {
    const progress = { percent, state, bytesTransferred: percent === 100 ? 1024 : 512, totalBytes: 1024 };
    render(
      <I18nProvider initialLocale="en"><ChangeLanguage /><UploadProgressNote progress={progress} /></I18nProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(en);
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("status")).toHaveTextContent(es);
    if (percent === null) expect(screen.getByRole("status")).not.toHaveTextContent("%");
    else expect(screen.getByRole("status")).toHaveTextContent(`${percent}%`);
    if (percent === 50) expect(screen.getByRole("status")).toHaveTextContent("512 B de 1.0 KB");
    // F-20: só o envio sem porcentagem ganha a barra que desliza (decorativa).
    const sliding = screen.getByRole("status").querySelector(".upload-indeterminate-fill");
    if (percent === null) expect(sliding?.parentElement).toHaveAttribute("aria-hidden", "true");
    else expect(sliding).toBeNull();
  });

  // F-09: a nota usa a barra da casa (a mesma cara do <progress> de envio), e
  // a largura não anima mais para quem pediu menos movimento.
  it("com porcentagem, desenha a barra da casa", () => {
    render(
      <I18nProvider initialLocale="en">
        <UploadProgressNote progress={{ percent: 40, state: "running", bytesTransferred: 4, totalBytes: 10 }} />
      </I18nProvider>,
    );
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveClass("h-1.5", "bg-[var(--color-line)]");
    expect(bar.firstElementChild).toHaveClass("bg-[var(--color-accent-fg)]", "motion-safe:transition-transform");
    expect(bar.firstElementChild?.className).not.toContain("transition-[width]");
  });

  // Um trecho parcial parado se leria como "30% feito": sem movimento, o trilho
  // inteiro fica preenchido e apagado; o trecho de 30% só existe deslizando.
  it("parada, a barra sem porcentagem enche o trilho; o trecho de 30% só desliza com movimento", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const rule = (from: number) => css.slice(from, css.indexOf("}", from));
    const base = css.indexOf(".upload-indeterminate-fill {");
    expect(rule(base)).toMatch(/width: 100%;\s*opacity: 0\.35;/);
    const media = css.indexOf("@media (prefers-reduced-motion: no-preference) {", base);
    expect(css.slice(base, media)).not.toContain("@media");
    const moving = css.indexOf(".upload-indeterminate-fill {", media);
    expect(rule(moving)).toMatch(/width: 30%;[\s\S]*animation: motion-track-slide/);
  });
});
