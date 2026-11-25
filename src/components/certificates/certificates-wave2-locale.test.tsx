import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { LearnCredentialsHub } from "@/components/learn/learn-credentials-hub";
import { CertificatePrintView } from "@/components/certificates/certificate-print-view";
import { CertificateVerificationPanel } from "@/components/certificates/certificate-verification-panel";
import type { Certificate } from "@/domain/certificate";
import type { Enrollment } from "@/domain/enrollment";

const mocks = vi.hoisted(() => ({
  user: { uid: "student-es" }, params: new URLSearchParams(), router: { refresh: vi.fn() },
  enrollments: vi.fn(), certificates: vi.fn(), issue: vi.fn(), get: vi.fn(), verify: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, useSearchParams: () => mocks.params }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/enrollments", () => ({ subscribeToUserEnrollments: mocks.enrollments }));
vi.mock("@/lib/data/certificates", () => ({
  subscribeToUserCertificates: mocks.certificates, issueSkillsetCertificate: mocks.issue,
  getCertificate: mocks.get, verifySkillsetCertificatePublic: mocks.verify,
}));

const enrollment: Enrollment = {
  id: "enrollment-es", userId: "student-es", courseId: "course-es", courseSlug: "course-es",
  courseTitle: "Original course $&", courseCategory: "Original category", courseImage: "",
  status: "completed", source: "payment", progressPercent: 100, lastLessonId: null,
};
const certificate: Certificate = {
  id: "certificate-es", enrollmentId: enrollment.id, userId: "student-es", courseId: "course-es",
  courseSlug: "course-es", courseTitle: enrollment.courseTitle, courseCategory: enrollment.courseCategory,
  authorityLabel: "SkillsetMind Verified", status: "issued", verificationCode: "SK-Original-$&",
  studentFullName: "Original student $&", teacherName: "Original teacher $&", issuedAt: "2026-09-10T12:00:00Z",
};
function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}
function show(children: ReactNode) {
  return render(<I18nProvider initialLocale="es"><ChangeLanguage />{children}</I18nProvider>);
}
function changeLanguage() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.params = new URLSearchParams();
  mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment]); return () => {}; });
  mocks.certificates.mockImplementation((_uid, next) => { next([]); return () => {}; });
  mocks.get.mockResolvedValue(certificate);
});
afterEach(cleanup);

describe("certificate interface locale does not rewrite issued documents", () => {
  it("localizes eligibility, filters and immutable-name validation without losing the entered name", () => {
    show(<LearnCredentialsHub />);
    expect(screen.getByRole("group", { name: "Filtros de credenciales" })).toBeVisible();
    expect(screen.getByRole("heading", { name: enrollment.courseTitle })).toBeVisible();
    expect(screen.getByText("Lista para revisión")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Emitir certificado" }));
    expect(screen.getByText("Este nombre se imprimirá en tu certificado y no se podrá cambiar después de emitirlo.")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre completo en el certificado" }), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y emitir" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Introduce tu nombre completo (entre 2 y 120 caracteres)");
    expect(mocks.issue).not.toHaveBeenCalled();
    changeLanguage();
    expect(screen.getByRole("textbox", { name: "Full name on certificate" })).toHaveValue("X");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your full name (2-120 characters)");
    expect(mocks.enrollments).toHaveBeenCalledTimes(1);
    expect(mocks.certificates).toHaveBeenCalledTimes(1);
  });

  it("preserves issuance payload, localizes pending and error states, then shows the streamed certificate", async () => {
    let reject!: (error: Error) => void;
    mocks.issue.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    show(<LearnCredentialsHub />);
    fireEvent.click(screen.getByRole("button", { name: "Emitir certificado" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre completo en el certificado" }), { target: { value: "  Original   student $&  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y emitir" }));
    expect(mocks.issue).toHaveBeenCalledWith(enrollment.id, "Original student $&");
    expect(screen.getByRole("button", { name: "Emitiendo..." })).toBeDisabled();
    changeLanguage();
    expect(screen.getByRole("button", { name: "Issuing..." })).toBeDisabled();
    await act(async () => { reject(new Error("Internal transport detail")); });
    expect(screen.getByRole("alert")).toHaveTextContent("We could not issue this certificate yet. Please try again.");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos emitir este certificado. Inténtalo de nuevo.");
    expect(screen.getByRole("textbox", { name: "Nombre completo en el certificado" })).toHaveValue("  Original   student $&  ");
    act(() => { mocks.certificates.mock.calls[0][1]([certificate]); });
    expect(screen.getByRole("link", { name: "Ver certificado" })).toHaveAttribute("href", "/learn/credentials/certificate-es");
    expect(screen.getByRole("link", { name: "Verificar credencial" })).toHaveAttribute("href", `/verify?code=${encodeURIComponent(certificate.verificationCode)}`);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each(["enrollments", "certificates"] as const)("localizes %s read errors", (source) => {
    mocks[source].mockImplementation((_uid, _next, fail) => { fail(new Error("Internal detail")); return () => {}; });
    show(<LearnCredentialsHub />);
    expect(screen.getByRole("alert")).toHaveTextContent(source === "enrollments" ? "No pudimos cargar tus registros de credenciales." : "No pudimos cargar los registros de tus certificados emitidos.");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent(source === "enrollments" ? "We could not load your credential records." : "We could not load your issued certificate records.");
  });

  it("keeps CertificateDocument HTML identical across locale changes while translating controls", async () => {
    const view = show(<CertificatePrintView certificateId={certificate.id} />);
    expect(await screen.findByRole("button", { name: "Imprimir o guardar como PDF" })).toBeVisible();
    const document = view.container.querySelector(".cert-doc")!;
    const originalHtml = document.outerHTML;
    expect(document).toHaveTextContent("Certificate of Completion");
    expect(document).toHaveTextContent(certificate.studentFullName!);
    expect(document).toHaveTextContent(certificate.teacherName!);
    expect(document).toHaveTextContent(certificate.verificationCode);
    const linkedIn = screen.getByRole("link", { name: "Añadir a LinkedIn" }).getAttribute("href")!;
    expect(new URL(linkedIn).searchParams.get("name")).toBe(certificate.courseTitle);
    expect(new URL(linkedIn).searchParams.get("certId")).toBe(certificate.verificationCode);
    changeLanguage();
    expect(screen.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
    expect(view.container.querySelector(".cert-doc")!.outerHTML).toBe(originalHtml);
    expect(screen.getByRole("link", { name: "Add to LinkedIn" })).toHaveAttribute("href", linkedIn);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("copies the public verification link with a visible confirmation, and reserves the document's space while loading", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    let resolve!: (value: Certificate) => void;
    mocks.get.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = show(<CertificatePrintView certificateId={certificate.id} />);
    // Loading: the certificate paper is already there (same box), no jump when it arrives.
    expect(screen.getByText("Preparando tu certificado...")).toBeInTheDocument();
    expect(view.container.querySelector(".cert-doc .cert-doc-content")).not.toBeNull();
    await act(async () => { resolve(certificate); });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar enlace de verificación" })); });
    expect(writeText.mock.calls[0][0].endsWith(`/verify?code=${encodeURIComponent(certificate.verificationCode)}`)).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Enlace copiado");
  });

  it("when the clipboard is refused, shows the verification link in a field to copy by hand", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    show(<CertificatePrintView certificateId={certificate.id} />);
    const copy = await screen.findByRole("button", { name: "Copiar enlace de verificación" });
    await act(async () => { fireEvent.click(copy); });
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo copiar el enlace.");
    const field = screen.getByRole("textbox", { name: "Enlace de verificación" }) as HTMLInputElement;
    expect(field).toHaveAttribute("readonly");
    expect(field.value.endsWith(`/verify?code=${encodeURIComponent(certificate.verificationCode)}`)).toBe(true);
  });

  it.each(["missing", "revoked", "foreign", "error"])("localizes %s print state and does not show a document", async (state) => {
    if (state === "error") mocks.get.mockRejectedValue(new Error("Internal detail"));
    else mocks.get.mockResolvedValue(state === "missing" ? null : { ...certificate, ...(state === "revoked" ? { status: "revoked" } : { userId: "someone-else" }) });
    const view = show(<CertificatePrintView certificateId={certificate.id} />);
    expect(await screen.findByRole("heading", { name: state === "error" ? "No pudimos cargar este certificado." : "Certificado no disponible." })).toBeVisible();
    expect(view.container.querySelector(".cert-doc")).toBeNull();
    expect(screen.queryByRole("button", { name: "Imprimir o guardar como PDF" })).not.toBeInTheDocument();
  });

  it("print error offers 'Try again', which reads the certificate once more and shows it", async () => {
    let resolve!: (value: Certificate) => void;
    mocks.get
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(new Promise<Certificate>((done) => { resolve = done; }));
    const view = show(<CertificatePrintView certificateId={certificate.id} />);
    expect(await screen.findByText("Ocurrió un error al cargar la credencial. Inténtalo de nuevo o ábrela desde tu lista de credenciales.")).toBeVisible();
    expect(screen.queryByText(/Actualiza la página/)).toBeNull();
    const retry = screen.getByRole("button", { name: "Intentar de nuevo" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    // Reading: the usual certificate paper in place of the notice.
    expect(screen.getByText("Preparando tu certificado...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Intentar de nuevo" })).toBeNull();
    await act(async () => resolve(certificate));
    expect(view.container.querySelector(".cert-doc")).not.toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("a missing certificate (not a read failure) has no 'Try again'", async () => {
    mocks.get.mockResolvedValue(null);
    show(<CertificatePrintView certificateId={certificate.id} />);
    expect(await screen.findByRole("heading", { name: "Certificado no disponible." })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Intentar de nuevo" })).toBeNull();
  });

  it("localizes public verification validation and preserves typed codes", async () => {
    mocks.verify.mockRejectedValue(new Error("Internal detail"));
    show(<CertificateVerificationPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Introduce un código de verificación de SkillsetMind.");
    expect(mocks.verify).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Código de verificación" }), { target: { value: " SK-Original-$& " } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos verificar este certificado en este momento.");
    expect(mocks.verify).toHaveBeenCalledWith("SK-Original-$&");
    changeLanguage();
    expect(screen.getByRole("textbox", { name: "Verification code" })).toHaveValue(" SK-Original-$& ");
    expect(screen.getByRole("alert")).toHaveTextContent("We could not verify this certificate right now.");
  });

  it("localizes public verification result dates and controls, retaining course, category and verification code", async () => {
    mocks.params = new URLSearchParams({ code: certificate.verificationCode });
    let resolve!: (value: unknown) => void;
    mocks.verify.mockReturnValue(new Promise((done) => { resolve = done; }));
    show(<CertificateVerificationPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(screen.getByRole("button", { name: "Verificando..." })).toBeDisabled();
    changeLanguage();
    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled();
    // Same shape as CertificateVerificationResult: no student or teacher name leaves the API.
    const verified = {
      courseTitle: certificate.courseTitle, courseCategory: certificate.courseCategory,
      authorityLabel: "Skillset Verified", verificationCode: certificate.verificationCode, issuedAt: certificate.issuedAt,
    };
    await act(async () => { resolve({ valid: true, certificate: verified }); });
    expect(screen.getByText(`Code: ${certificate.verificationCode}`)).toBeVisible();
    // The issuer shown is the stored record value, never a translated brand.
    expect(screen.getByText("Skillset Verified")).toBeVisible();
    changeLanguage();
    expect(screen.getByRole("heading", { name: certificate.courseTitle })).toBeVisible();
    expect(screen.getByText(certificate.courseCategory)).toBeVisible();
    expect(screen.getByText(`Código: ${certificate.verificationCode}`)).toBeVisible();
    expect(screen.getByText("Skillset Verified")).toBeVisible();
    expect(screen.queryByText(certificate.studentFullName!)).toBeNull();
    expect(screen.getByText(new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date("2026-09-10T12:00:00Z")))).toBeVisible();
    expect(screen.getByRole("button", { name: "Imprimir / Guardar como PDF" })).toBeVisible();
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });
});
