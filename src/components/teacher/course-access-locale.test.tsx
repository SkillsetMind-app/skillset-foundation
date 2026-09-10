import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { CourseAccessPanel } from "./course-access-panel";

const mocks = vi.hoisted(() => ({ list: vi.fn(), change: vi.fn(), refresh: vi.fn(), onChange: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/data/course-access", () => ({ listCourseAccess: mocks.list, changeCourseAccess: mocks.change }));
const grant = { id: "grant-1", learner_email: "literal$&@example.test", access_status: "pending", revoked_at: null };
function Language() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}
function mount() {
  return render(<I18nProvider initialLocale="es"><Language /><CourseAccessPanel courseId="course-1" onChange={mocks.onChange} /></I18nProvider>);
}
function switchLanguage() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
async function submit() {
  fireEvent.change(screen.getByLabelText("Correo del estudiante"), { target: { value: grant.learner_email } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Conceder acceso y enviar enlace" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Conceder acceso y enviar enlace" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReset().mockResolvedValue([]);
  mocks.change.mockReset().mockResolvedValue({ grant, accessStatus: "pending", emailStatus: "sent" });
});
afterEach(cleanup);

describe("course access with real EN/ES dictionaries", () => {
  it("requires integrated keys and translates loaded states without changing emails", async () => {
    expect(translate(getDictionary("es"), "courseAccess.title")).toBe("Conceder acceso al curso");
    expect(translate(getDictionary("en"), "courseAccess.title")).toBe("Grant course access");
    mocks.list.mockResolvedValue(["pending", "granted", "preserved", "revoked", "conflict"].map((status) => ({ ...grant, id: status, access_status: status, revoked_at: status === "revoked" ? "2026-09-10" : null })));
    const view = mount();
    expect(await screen.findByText("Esperando confirmación del correo")).toBeVisible();
    for (const label of ["Acceso concedido", "Acceso existente conservado", "Acceso del creador revocado", "El acceso existente requiere revisión de soporte"]) expect(screen.getByText(label)).toBeVisible();
    expect(screen.getAllByText(grant.learner_email)).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: `Reenviar enlace a ${grant.learner_email}` })).toHaveLength(3);
    switchLanguage();
    expect(screen.getByText("Existing access preserved")).toBeVisible();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).not.toContain("courseAccess.");
  });

  it.each([
    ["pending", "sent", "sent"], ["granted", "sent", "sent"], ["preserved", "sent", "sent"],
    ["pending", "failed", "emailFailed"], ["conflict", "failed", "conflictNotice"],
  ])("relocalizes %s/%s feedback and preserves the request", async (accessStatus, emailStatus, key) => {
    mocks.change.mockResolvedValue({ grant: { ...grant, access_status: accessStatus }, accessStatus, emailStatus });
    mount(); await submit();
    await waitFor(() => expect(mocks.onChange).toHaveBeenCalledTimes(1));
    const expected = (locale: "es" | "en") => translate(getDictionary(locale), `courseAccess.${key}`).replace("{status}", () => translate(getDictionary(locale), `courseAccess.${accessStatus}`));
    expect(screen.getByRole("status")).toHaveTextContent(expected("es"));
    expect(mocks.change).toHaveBeenCalledWith({ courseId: "course-1", email: grant.learner_email });
    switchLanguage();
    expect(screen.getByRole("status")).toHaveTextContent(expected("en"));
    expect(screen.getByLabelText("Learner email")).toHaveValue("");
    if (accessStatus === "conflict") expect(screen.queryByRole("button", { name: /Resend link to/ })).toBeNull();
  });

  it("keeps confirmation, focus and revoke payload across locale changes", async () => {
    mocks.list.mockResolvedValue([grant]);
    mocks.change.mockResolvedValue({ grant: { ...grant, access_status: "revoked", revoked_at: "2026-09-10" }, accessStatus: "revoked" });
    mount();
    const trigger = await screen.findByRole("button", { name: `Revocar acceso de ${grant.learner_email}` });
    fireEvent.click(trigger);
    expect(screen.getByText(/Se conservarán el acceso comprado/)).toBeVisible();
    switchLanguage();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(mocks.change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm revocation" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveFocus());
    expect(mocks.change).toHaveBeenCalledWith({ action: "revoke", grantId: grant.id });
    switchLanguage();
    expect(screen.getByRole("status")).toHaveTextContent("Se conservan el progreso, los certificados y el acceso comprado.");
  });

  it.each([
    ["Too many attempts. Please wait before trying again.", "rateError"],
    ["Only the course owner can manage access to a published course.", "ownerError"],
    ["Enter a valid email address.", "emailError"],
    ["raw provider failure", "updateError"], ["toString", "updateError"],
  ])("localizes %s and retains the typed email", async (message, key) => {
    mocks.change.mockRejectedValue(new Error(message));
    mount(); await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(translate(getDictionary("es"), `courseAccess.${key}`));
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent(translate(getDictionary("en"), `courseAccess.${key}`));
    expect(screen.getByLabelText("Learner email")).toHaveValue(grant.learner_email);
  });

  it("translates an existing load failure", async () => {
    mocks.list.mockRejectedValue(new Error("internal"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los registros de acceso.");
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load access records.");
  });

  it("relocalizes an in-flight resend without sending twice", async () => {
    mocks.list.mockResolvedValue([grant]);
    let finish!: (value: unknown) => void;
    mocks.change.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: `Reenviar enlace a ${grant.learner_email}` }));
    switchLanguage();
    expect(screen.getByRole("button", { name: `Resend link to ${grant.learner_email}` })).toBeDisabled();
    await act(async () => finish({ grant, accessStatus: "pending", emailStatus: "sent" }));
    expect(screen.getByRole("status")).toHaveTextContent("Sign-in link sent.");
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ action: "resend", grantId: grant.id });
  });
});
