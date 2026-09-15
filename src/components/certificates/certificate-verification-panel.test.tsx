import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { Locale } from "@/lib/i18n/config";
import { CertificateVerificationPanel } from "./certificate-verification-panel";

const mocks = vi.hoisted(() => ({ verify: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/data/certificates", () => ({ verifySkillsetCertificatePublic: mocks.verify }));

afterEach(cleanup);

function check(locale: Locale, verifyLabel: string) {
  render(
    <I18nProvider initialLocale={locale}>
      <CertificateVerificationPanel />
    </I18nProvider>,
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "SK-ABC-123" } });
  fireEvent.click(screen.getByRole("button", { name: verifyLabel }));
}

describe("certificate verification panel", () => {
  it.each([
    ["en", "Verify", "Certificate revoked", "Certificate not found"],
    ["es", "Verificar", "Certificado revocado", "Certificado no encontrado"],
  ] as const)("shows a revoked certificate as revoked, not as missing (%s)", async (locale, verifyLabel, revoked, missing) => {
    mocks.verify.mockResolvedValue({ valid: false, revoked: true });

    check(locale, verifyLabel);

    expect(await screen.findByRole("heading", { name: revoked })).toBeVisible();
    expect(screen.queryByRole("heading", { name: missing })).toBeNull();
  });

  it("still says not found for a code that matches nothing", async () => {
    mocks.verify.mockResolvedValue({ valid: false });

    check("en", "Verify");

    expect(await screen.findByRole("heading", { name: "Certificate not found" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Certificate revoked" })).toBeNull();
  });
});
