import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CreatorVerificationPanel } from "@/components/teacher/creator-verification-panel";
import type { CreatorVerificationCase } from "@/domain/creator-verification";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({
  user: { uid: "badge-creator" },
  subscribe: vi.fn(),
  flag: vi.fn(),
  submit: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/creator-verification", () => ({
  subscribeToMyVerificationCase: mocks.subscribe,
  fetchRequireCreatorVerification: mocks.flag,
  submitCreatorVerification: mocks.submit,
  uploadVerificationEvidence: mocks.upload,
  removeVerificationEvidence: mocks.remove,
}));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}

function renderPanel() {
  return render(<I18nProvider initialLocale="es"><ChangeLanguage /><CreatorVerificationPanel /></I18nProvider>);
}

function receiveCase(value: CreatorVerificationCase | null) {
  mocks.subscribe.mockImplementation((_uid: string, callback: (next: CreatorVerificationCase | null) => void) => {
    callback(value);
    return () => {};
  });
}

function application(overrides: Partial<CreatorVerificationCase> = {}): CreatorVerificationCase {
  return {
    id: "badge-case", creatorId: mocks.user.uid, status: "pending", verificationKind: "holistic",
    profession: "Holistic practitioner", registrationType: "Private association", registrationId: "REG-123",
    registrationRegion: "My region", evidenceLinks: ["https://example.test/evidence"],
    documentPath: "badge-creator/evidence.pdf", reviewNote: "Original review $& text",
    createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z", ...overrides,
  };
}

async function openForm(kind = "coach") {
  const view = renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: "Solicitar insignia profesional" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Profesión" }), { target: { value: kind } });
  return view;
}

function changeField(name: string, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
}

function submitForm() {
  // Exercise domain validation directly, independently of native HTML constraints.
  fireEvent.submit(screen.getByRole("combobox").closest("form")!);
}

describe("professional badge uses the real interface locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flag.mockReset().mockResolvedValue(false);
    mocks.submit.mockReset().mockResolvedValue(undefined);
    mocks.upload.mockReset().mockResolvedValue("badge-creator/uploaded.pdf");
    mocks.remove.mockReset().mockResolvedValue(undefined);
    receiveCase(null);
  });
  afterEach(cleanup);

  it("ships the badge namespace in both real dictionaries", () => {
    expect(translate(getDictionary("es"), "professionalBadge.title")).toBe("Verificación profesional");
    expect(translate(getDictionary("en"), "professionalBadge.title")).toBe("Professional verification");
  });

  it("localizes loading and optional instructions, accessible fields and profession options", async () => {
    mocks.subscribe.mockImplementation(() => () => {});
    const view = renderPanel();
    expect(screen.getByText("Cargando el estado de tu verificación...")).toBeVisible();
    await act(async () => { mocks.subscribe.mock.calls[0][1](null); });
    expect(screen.getByText(/La verificación es opcional\./)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Solicitar insignia profesional" }));
    expect(screen.getByRole("group", { name: "Evidencia profesional" })).toBeVisible();
    for (const [label, value] of [["Psicólogo", "psychologist"], ["Coach", "coach"], ["Profesional holístico", "holistic"], ["Otra", "other"]]) {
      expect(screen.getByRole("option", { name: label })).toHaveValue(value);
    }
    expect(screen.getByRole("textbox", { name: "Enlaces de evidencia" })).toHaveAccessibleDescription(/hasta 6/);
    expect(screen.getByLabelText("Documento o diploma")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,application/pdf");
    expect(screen.getByLabelText("Tomar foto")).toHaveAttribute("capture", "environment");
    expect(screen.getByPlaceholderText("Información que nos ayude a verificarte más rápido.")).toBeVisible();
    expect(view.container.textContent).not.toContain("professionalBadge.");
  });

  it.each([
    ["", "", "", "", "Elige tu profesión."],
    ["other", "x", "", "", "Describe tu profesión (entre 2 y 120 caracteres)."],
    ["psychologist", "", "", "", "Añade tu número de licencia y el país o estado emisor."],
    ["coach", "", "", "x".repeat(2001), "Acorta los datos de registro o la nota."],
    ["coach", "", "", "", "Añade un enlace profesional o un certificado para solicitar una insignia."],
    ["coach", "", Array.from({ length: 7 }, (_, i) => `https://example.test/${i}`).join("\n"), "", "Adjunta un máximo de 6 enlaces de evidencia."],
    ["coach", "", "https://", "", "Utiliza un enlace profesional https:// válido."],
    ["coach", "", "http://example.test", "", "Utiliza un enlace profesional https:// válido (máximo 300 caracteres)."],
  ])("localizes domain validation for %s without uploading", async (kind, profession, links, note, expected) => {
    await openForm(kind);
    if (kind === "other") changeField("Tu profesión", profession);
    changeField("Enlaces de evidencia", links);
    changeField("Nota para el equipo de revisión (opcional)", note);
    submitForm();
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("relocalizes an existing validation error without losing edits or resubscribing", async () => {
    await openForm("other");
    changeField("Tu profesión", "Custom profession $&");
    changeField("Nota para el equipo de revisión (opcional)", "Original note $&");
    submitForm();
    expect(await screen.findByRole("alert")).toHaveTextContent("Añade un enlace profesional");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a professional link or a certificate to request a badge.");
    expect(screen.getByRole("textbox", { name: "Your profession" })).toHaveValue("Custom profession $&");
    expect(screen.getByRole("textbox", { name: "Note to the review team (optional)" })).toHaveValue("Original note $&");
    expect(screen.getByRole("combobox", { name: "Profession" })).toHaveValue("other");
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["psychologist", "Psychologist"], ["coach", "Coach"],
    ["holistic", "Holistic practitioner"], ["other", "Custom profession $&"],
  ])("keeps the canonical or authored %s profession in the payload", async (kind, profession) => {
    await openForm(kind);
    if (kind === "other") changeField("Tu profesión", profession);
    if (kind === "psychologist") {
      changeField("Número de registro", "REG-123");
      changeField("País o estado emisor", "My region");
    }
    changeField("Enlaces de evidencia", "https://example.test/evidence");
    submitForm();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      verificationKind: kind, profession, evidenceLinks: ["https://example.test/evidence"],
    })));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it.each([false, true])("localizes pending guidance with required=%s and displays canonical labels only", async (required) => {
    receiveCase(application());
    mocks.flag.mockResolvedValue(required);
    renderPanel();
    expect(await screen.findByText(required ? /antes de continuar con la activación/ : /Puedes continuar sin insignia/)).toBeVisible();
    expect(screen.getByText("Pendiente")).toBeVisible();
    expect(screen.getByText("Profesional holístico")).toBeVisible();
    expect(screen.getByText("Private association")).toBeVisible();
    expect(screen.getByText("Documento privado enviado")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each(["legacy", "other", "holistic"] as const)("preserves authored profession text for %s records", async (kind) => {
    receiveCase(application({ verificationKind: kind, profession: "Custom profession $&" }));
    renderPanel();
    expect(await screen.findByText("Custom profession $&")).toBeVisible();
  });

  it.each([
    ["psychologist", "Credencial profesional verificada"],
    ["holistic", "Evidencia profesional revisada"],
    ["legacy", "Verificación profesional aprobada"],
  ] as const)("localizes the approved %s badge instead of leaking raw approved", async (kind, heading) => {
    receiveCase(application({ status: "approved", verificationKind: kind }));
    const view = renderPanel();
    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    expect(view.container.querySelector('[data-status="approved"]')).toHaveTextContent("Aprobada");
    expect(screen.getByRole("link", { name: "Volver al estudio" })).toHaveAttribute("href", "/teach");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it.each(["needs_changes", "rejected"] as const)("preserves reviewer content and prefilled edits for %s", async (status) => {
    receiveCase(application({ status, verificationKind: "other", profession: "Original profession $&" }));
    renderPanel();
    expect(await screen.findByText("Original review $& text")).toBeVisible();
    expect(screen.getByText(status === "needs_changes" ? "Requiere cambios" : "Rechazada")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Editar solicitud" }));
    expect(screen.getByRole("textbox", { name: "Tu profesión" })).toHaveValue("Original profession $&");
    expect(screen.getByText("Documento privado adjunto")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("textbox", { name: "Your profession" })).toHaveValue("Original profession $&");
    expect(screen.getByRole("button", { name: status === "needs_changes" ? "Resubmit for review" : "Submit for review" })).toBeVisible();
  });

  it("localizes invalid upload guidance without starting an upload", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText("Tomar foto"), { target: { files: [new File(["photo"], "photo.heic", { type: "image/heic" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Convierte las fotos HEIC a JPG o PNG.");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Convert HEIC photos to JPG or PNG.");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("relocalizes in-flight submission and cleanup errors while retaining the private upload for retry", async () => {
    let rejectSubmission!: (error: Error) => void;
    mocks.submit.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectSubmission = reject; }));
    await openForm("holistic");
    fireEvent.change(screen.getByLabelText("Documento o diploma"), { target: { files: [new File(["evidence"], "Original diploma.pdf", { type: "application/pdf" })] } });
    submitForm();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Enviando..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
    await act(async () => { rejectSubmission(new Error("Transport detail must stay hidden")); });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not submit verification. Please try again.");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo enviar la verificación. Inténtalo de nuevo.");
    let rejectRemoval!: (error: Error) => void;
    mocks.remove.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectRemoval = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar documento" }));
    expect(screen.getByRole("button", { name: "Quitando documento..." })).toBeDisabled();
    await act(async () => { rejectRemoval(new Error("Transport detail must stay hidden")); });
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo quitar el documento subido.");
    expect(screen.getByText("Original diploma.pdf")).toBeVisible();
    expect(screen.queryByText("Transport detail must stay hidden")).not.toBeInTheDocument();
    submitForm();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenLastCalledWith(expect.objectContaining({ profession: "Holistic practitioner", documentPath: "badge-creator/uploaded.pdf" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar para revisión" })).toBeEnabled());
  });
});
