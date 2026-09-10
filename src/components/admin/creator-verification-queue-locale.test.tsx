import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorVerificationQueue } from "@/components/admin/creator-verification-queue";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { CreatorVerificationCase } from "@/domain/creator-verification";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), review: vi.fn(), download: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/data/creator-verification", () => ({
  subscribeToVerificationQueue: mocks.subscribe,
  reviewCreatorVerification: mocks.review,
  getVerificationEvidenceDownload: mocks.download,
}));

const base: CreatorVerificationCase = {
  id: "case-1", creatorId: "creator-1", applicantName: "Applicant $&", status: "pending",
  verificationKind: "holistic", profession: "Holistic practitioner", registrationType: "Registry $&",
  registrationId: "REG-123", registrationRegion: "Region $&", evidenceLinks: [], note: "Original note $&",
  createdAt: "2026-08-20T13:00:00Z", updatedAt: "2026-08-20T13:00:00Z",
};
function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}
function queue(query = "", locale: "en" | "es" = "en") {
  return <I18nProvider initialLocale={locale}><ChangeLanguage /><CreatorVerificationQueue query={query} /></I18nProvider>;
}
function deliver(row: CreatorVerificationCase) { act(() => mocks.subscribe.mock.calls[0][0]([row])); }
beforeEach(() => { vi.clearAllMocks(); mocks.subscribe.mockImplementation(() => vi.fn()); });
afterEach(cleanup);

describe("verification profession labels with real dictionaries", () => {
  it.each([
    ["psychologist", "Psychologist", "Psic\u00f3logo"],
    ["coach", "Coach", "Coach"],
    ["holistic", "Holistic practitioner", "Profesional hol\u00edstico"],
  ] as const)("localizes canonical %s without rewriting the application", (kind, profession, spanish) => {
    render(queue());
    const row = { ...base, verificationKind: kind, profession };
    deliver(row);
    expect(screen.getByText(profession)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText(spanish)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: base.applicantName })).toBeInTheDocument();
    expect(screen.getByText(/Original note \$&/)).toBeInTheDocument();
    expect(screen.getByText(/Registry \$&/)).toHaveTextContent("REG-123 (Region $&)");
    expect(row.profession).toBe(profession);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    { verificationKind: "other", profession: "Holistic practitioner" },
    { verificationKind: "legacy", profession: "Psychologist" },
    { verificationKind: undefined, profession: "Holistic practitioner" },
    { verificationKind: "holistic", profession: "Custom profession $&" },
    { verificationKind: "coach", profession: "Psychologist" },
  ] satisfies Partial<CreatorVerificationCase>[])("preserves authored or legacy $verificationKind / $profession", fields => {
    render(queue("", "es"));
    deliver({ ...base, ...fields });
    expect(screen.getByText(fields.profession)).toBeInTheDocument();
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("searches the displayed Spanish profession and the original value without another subscription", () => {
    const { rerender } = render(queue("Profesional hol\u00edstico"));
    deliver(base);
    expect(screen.queryByRole("article")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("heading", { name: base.applicantName })).toBeInTheDocument();
    rerender(queue("Holistic practitioner"));
    expect(screen.getByRole("heading", { name: base.applicantName })).toBeInTheDocument();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });
});
