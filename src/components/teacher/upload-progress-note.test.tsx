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
  });
});
