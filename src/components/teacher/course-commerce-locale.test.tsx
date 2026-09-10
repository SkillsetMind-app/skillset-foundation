import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { CouponsPanel, TaxPanel } from "./course-commerce-panels";
import type { CourseCoupon } from "@/domain/course-commerce";

const mocks = vi.hoisted(() => ({ coupons: vi.fn(), settings: vi.fn(), create: vi.fn(), toggle: vi.fn(), remove: vi.fn(), save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/data/course-commerce", () => ({
  subscribeToCourseCoupons: mocks.coupons, subscribeToCourseCommerceSettings: mocks.settings,
  createCourseCoupon: mocks.create, setCourseCouponActive: mocks.toggle, deleteCourseCoupon: mocks.remove,
  upsertCourseCommerceSettings: mocks.save,
}));
const coupon: CourseCoupon = { id: "coupon-1", courseId: "course-1", ownerId: "teacher-1", code: "ORIGINAL-25", percentOff: 25, maxRedemptions: 7, redeemedCount: 2, expiresAt: "2099-01-05T23:59:59Z", active: false, createdAt: "2026-09-10", updatedAt: "2026-09-10" };
function Language() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}
function mount(tax = false, blocked = false) {
  return render(<I18nProvider initialLocale="es"><Language />{tax ? <TaxPanel courseId="course-1" /> : <CouponsPanel courseId="course-1" activationBlocked={blocked} />}</I18nProvider>);
}
function switchLanguage() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
function submitCoupon() { fireEvent.submit(screen.getByLabelText(/Código/).closest("form")!); }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.coupons.mockImplementation((_id, callback) => { callback([]); return () => {}; });
  mocks.settings.mockImplementation((_id, callback) => { callback(null); return () => {}; });
  for (const mock of [mocks.create, mocks.toggle, mocks.remove, mocks.save]) mock.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("commerce with real EN/ES dictionaries", () => {
  it("requires integrated keys and translates the first-payment rule, gate and form", () => {
    expect(translate(getDictionary("es"), "courseCommerce.coupons")).toBe("Cupones");
    expect(translate(getDictionary("en"), "courseCommerce.coupons")).toBe("Coupons");
    const view = mount(false, true);
    expect(screen.getByText(/el descuento se aplica solo al primer pago/)).toBeVisible();
    expect(screen.getByText(/La verificación profesional debe estar aprobada/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Abrir verificación" })).toHaveAttribute("href", "/teach/verification");
    expect(screen.getByLabelText("Límite de usos (opcional)")).toHaveAttribute("max", "100000");
    expect(screen.getByRole("option", { name: "25% de descuento" })).toHaveValue("25");
    expect(screen.getByText("Todavía no hay cupones.")).toBeVisible();
    expect(view.container.textContent).not.toContain("courseCommerce.");
  });

  it("preserves coupon values and UTC expiry through a pending locale change", async () => {
    let finish!: () => void;
    mocks.create.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    mount();
    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: "original-25" } });
    fireEvent.change(screen.getByLabelText("Descuento"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Vence (opcional)"), { target: { value: "2099-01-05" } });
    submitCoupon();
    expect(screen.getByRole("button", { name: "Creando..." })).toBeDisabled();
    switchLanguage();
    expect(screen.getByLabelText(/Code/)).toHaveValue("ORIGINAL-25");
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledWith({ courseId: "course-1", code: "ORIGINAL-25", percentOff: 25, maxRedemptions: null, expiresAt: "2099-01-05T23:59:59.000Z" });
    await act(async () => finish());
    expect(screen.getByRole("status")).toHaveTextContent("Coupon created");
    switchLanguage();
    expect(screen.getByRole("status")).toHaveTextContent("Cupón creado.");
  });

  it.each([
    ["Coupon codes use 3-24 letters, numbers, or dashes.", "invalidCode"],
    ["That coupon code already exists for this course.", "duplicateCode"],
    ["The expiry date must be in the future.", "expiryPast"],
    ["Pay the one-time activation fee before creating coupons.", "activationError"],
    ["Pay the one-time activation fee before a coupon can be activated.", "activationError"],
    ["raw database detail", "createError"], ["toString", "createError"],
  ])("localizes %s from Error and RPC objects", async (message, key) => {
    mocks.create.mockRejectedValue({ message });
    mount();
    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: "ORIGINAL-25" } });
    submitCoupon();
    expect(await screen.findByRole("alert")).toHaveTextContent(translate(getDictionary("es"), `courseCommerce.${key}`));
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent(translate(getDictionary("en"), `courseCommerce.${key}`));
    expect(screen.getByLabelText(/Code/)).toHaveValue("ORIGINAL-25");
  });

  it("localizes client validation and keeps numeric boundaries", () => {
    mount(); submitCoupon();
    expect(screen.getByRole("alert")).toHaveTextContent("entre 3 y 24");
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: "VALID" } });
    fireEvent.change(screen.getByLabelText("Límite de usos (opcional)"), { target: { value: "100001" } });
    submitCoupon();
    expect(screen.getByRole("alert")).toHaveTextContent("entre 1 y 100000");
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("Redemption limit must be between 1 and 100000");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("translates coupon dates, paused/active/expired states and confirmation", async () => {
    mocks.coupons.mockImplementation((_id, callback) => { callback([coupon, { ...coupon, id: "expired", code: "EXPIRED", active: true, maxRedemptions: null, expiresAt: "2000-01-01T23:59:59Z" }]); return () => {}; });
    mocks.toggle.mockRejectedValue(new Error("Professional verification must be approved before a coupon can be activated."));
    mount();
    const row = screen.getByText("ORIGINAL-25").closest("li")!;
    expect(row).toHaveTextContent("Límite de 7 usos");
    expect(row).toHaveTextContent(new Date(coupon.expiresAt!).toLocaleDateString("es", { timeZone: "UTC" }));
    expect(row).toHaveTextContent("Pausado");
    expect(screen.getByText("EXPIRED").closest("li")).toHaveTextContent("Usos ilimitados");
    expect(screen.getByText("EXPIRED").closest("li")).toHaveTextContent("Vencido");
    fireEvent.click(within(row).getByRole("button", { name: "Activar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La verificación profesional debe estar aprobada");
    expect(mocks.toggle).toHaveBeenCalledWith(coupon.id, true);
    fireEvent.click(within(row).getByRole("button", { name: "Eliminar" }));
    switchLanguage();
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.remove.mockRejectedValue(new Error("internal"));
    fireEvent.click(within(row).getByRole("button", { name: "Confirm remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove the coupon.");
    expect(mocks.remove).toHaveBeenCalledWith(coupon.id);
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos eliminar el cupón.");
  });

  it("localizes tax regions while preserving canonical values, identifiers and saved feedback", async () => {
    mount(true);
    expect(screen.getByRole("heading", { name: "Recaudación de impuestos" })).toBeVisible();
    for (const name of ["Estados Unidos", "Brasil", "Unión Europea", "Reino Unido", "Otra"]) expect(screen.getByRole("checkbox", { name })).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "Estados Unidos" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Recaudo impuestos sobre las ventas de este curso" }));
    fireEvent.change(screen.getByLabelText("Identificación de registro fiscal (opcional)"), { target: { value: "EIN-$&-123" } });
    switchLanguage();
    expect(screen.getByRole("checkbox", { name: "United States" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save tax settings" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ courseId: "course-1", taxCollection: true, taxRegions: ["United States"], taxRegistrationId: "EIN-$&-123" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Tax settings saved.");
    switchLanguage();
    expect(screen.getByRole("status")).toHaveTextContent("Configuración fiscal guardada.");
    expect(mocks.settings).toHaveBeenCalledTimes(1);
  });

  it("does not save before the tax snapshot and relocalizes save errors", async () => {
    mocks.settings.mockImplementation(() => () => {});
    mount(true);
    expect(screen.getByRole("button", { name: "Guardar configuración fiscal" })).toBeDisabled();
    await act(async () => mocks.settings.mock.calls[0][1](null));
    mocks.save.mockRejectedValue({ message: "Keep the tax registration under 80 characters." });
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración fiscal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El registro fiscal no puede superar los 80 caracteres.");
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("Keep the tax registration under 80 characters.");
  });
});
