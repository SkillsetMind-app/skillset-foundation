import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseOffersPanel } from "@/components/teacher/course-offers-panel";

// What the person suffered: with the interface in Spanish, the course offers
// panel was still entirely in English — title, form, empty state, payment
// types and the marks on each offer's row. These tests render the
// panel inside the I18nProvider in "es" and check, literal by literal, that
// none of the old texts is left and that the new Spanish ones appear.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The literals the screen showed before this PR. If any comes back, the test fails.
const OLD_ENGLISH_LIST = [
  "Other prices",
  "Offers & prices",
  "Create one-time or subscription packages. The default drives the main page; every active offer has an exact buyer link.",
  "default",
  "No price",
  "Launch checkout",
];

const OLD_ENGLISH_FORM = [
  "Other prices",
  "Name of this price",
  "How often they pay",
  "Make this the main price on your page",
  "Add price",
  "Offers & prices",
  "No offers yet — checkout uses the legacy course price until you create one.",
  "Offer name",
  "Public code (optional)",
  "Amount",
  "Currency",
  "Payment type",
  "Default offer (drives checkout + syncs legacy price)",
  "Create offer",
  "One-time",
  "Subscription monthly",
  "Subscription yearly",
  "Free",
];

function withoutEnglish(literais: string[]) {
  for (const literal of literais) {
    expect(screen.queryByText(literal), `old text: ${literal}`).toBeNull();
    expect(
      screen.queryByLabelText(literal),
      `old label: ${literal}`,
    ).toBeNull();
  }
}

function renderEs(courseId = "course-1") {
  return render(
    <I18nProvider initialLocale="es">
      <CourseOffersPanel courseId={courseId} courseTitle="Curso de lanzamiento" />
    </I18nProvider>,
  );
}

describe("offers panel in Spanish", () => {
  it("the offers list no longer has any English text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          offers: [
            {
              id: "o1",
              name: "Launch",
              isDefault: true,
              active: true,
              publicCode: "LAUNCH",
              prices: [
                {
                  id: "p1",
                  amountMinor: 4900,
                  currency: "USD",
                  paymentType: "one_time",
                  active: true,
                },
              ],
            },
            {
              id: "o2",
              name: "Antigua",
              isDefault: false,
              active: false,
              publicCode: null,
              prices: [],
            },
          ],
        }),
      })),
    );

    renderEs();

    // The title identifies the section without repeating an instructions paragraph.
    expect(await screen.findByText("Otros precios")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Crea paquetes de pago único o por suscripción. La oferta predeterminada rige la página principal; cada oferta activa tiene su propio enlace de compra exacto.",
      ),
    ).not.toBeInTheDocument();

    // Mark of the default offer and the button that opens the form. The list arrives
    // after the fetch: wait, otherwise the assertion runs ahead of loading
    // (it failed when two files shared the same fork).
    expect(await screen.findByText("precio principal")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Agregar otro precio" }),
    ).toBeInTheDocument();

    // Row of the active offer: price, payment type and public code.
    const ativa = screen.getByText("precio principal").closest("li");
    expect(ativa?.textContent).toContain("Pago único");
    expect(ativa?.textContent).toContain("código LAUNCH");

    // Row of the offer with no price and inactive.
    const inativa = screen.getByText("Sin precio", { exact: false });
    expect(inativa.textContent).toContain("inactivo");

    // Label of the offer's checkout link: the row carries only "Copiar enlace",
    // with the offer name in the button name.
    expect(screen.getByRole("button", { name: "Copiar enlace de página de pago de Launch" })).toHaveTextContent("Copiar enlace");

    withoutEnglish(OLD_ENGLISH_LIST);
  });

  it("the new offer form no longer has any English text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })),
    );

    renderEs();

    // With no offer at all the form already comes open, next to the empty state.
    const nameField = await screen.findByLabelText("Nombre de este precio");
    expect(nameField).toHaveValue("Otro precio");
    expect(
      screen.getByText(
        "Todavía no hay otros precios. Se paga el precio que definiste en Precios.",
      ),
    ).toBeInTheDocument();

    expect(screen.getByLabelText("Código para el enlace (opcional)")).toHaveAttribute(
      "placeholder",
      "p. ej. LAUNCH",
    );
    expect(screen.getByLabelText("Importe")).toBeInTheDocument();
    expect(screen.getByLabelText("Moneda")).toBeInTheDocument();

    const howOften = screen.getByLabelText("Cada cuánto pagan");
    expect(
      Array.from(howOften.querySelectorAll("option")).map(
        (option) => option.textContent,
      ),
    ).toEqual([
      "Pago único",
      "Mensualidad",
      "Plan anual",
      "Gratis",
    ]);

    expect(
      screen.getByText("Usar como precio principal de tu página"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Agregar precio" }),
    ).toBeInTheDocument();

    // The initial English name also disappeared from the field.
    expect(nameField).not.toHaveValue("Standard offer");
    withoutEnglish(OLD_ENGLISH_FORM);
  });
});
