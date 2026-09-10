import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import VerifyPage from "@/app/verify/page";
import { generateMetadata } from "@/app/learn/credentials/[certificateId]/page";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

const state = vi.hoisted(() => ({ locale: "es" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === LOCALE_COOKIE ? { value: state.locale } : undefined }),
}));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
// The real panel reads the query string and suspends; the page shows its fallback meanwhile.
vi.mock("@/components/certificates/certificate-verification-panel", () => ({
  CertificateVerificationPanel: () => { throw new Promise(() => {}); },
}));
vi.mock("@/components/certificates/certificate-print-view", () => ({ CertificatePrintView: () => null }));
vi.mock("@/components/auth/protected-surface", () => ({ ProtectedSurface: () => null }));
afterEach(cleanup);

it.each([
  ["en", "Loading verification..."],
  ["es", "Cargando verificación..."],
])("shows the public verification fallback in the cookie language (%s)", async (locale, text) => {
  state.locale = locale;
  render(await VerifyPage());
  expect(screen.getByText(text)).toBeInTheDocument();
});

it.each([
  ["en", "Certificate | SkillsetMind", "View and print your SkillsetMind Verified certificate."],
  ["es", "Certificado | SkillsetMind", "Consulta e imprime tu certificado SkillsetMind Verified."],
])("localizes the certificate page title and description (%s)", async (locale, title, description) => {
  state.locale = locale;
  expect(await generateMetadata()).toMatchObject({ title, description });
});
