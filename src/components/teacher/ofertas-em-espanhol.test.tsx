import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseOffersPanel } from "@/components/teacher/course-offers-panel";

// O que a pessoa sofria: com a interface em espanhol, o painel de ofertas do
// curso seguia inteiro em ingles — titulo, formulario, estado vazio, tipos de
// pagamento e as marcas da linha de cada oferta. Estas provas renderizam o
// painel dentro do I18nProvider em "es" e conferem, literal por literal, que
// nenhum dos textos antigos sobrou e que os novos em espanhol aparecem.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Os literais que a tela mostrava antes deste PR. Se algum voltar, a prova cai.
const INGLES_ANTIGO_LISTA = [
  "Other prices",
  "Offers & prices",
  "Create one-time or subscription packages. The default drives the main page; every active offer has an exact buyer link.",
  "default",
  "No price",
  "Launch checkout",
];

const INGLES_ANTIGO_FORMULARIO = [
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

function semIngles(literais: string[]) {
  for (const literal of literais) {
    expect(screen.queryByText(literal), `texto antigo: ${literal}`).toBeNull();
    expect(
      screen.queryByLabelText(literal),
      `rotulo antigo: ${literal}`,
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

describe("painel de ofertas em espanhol", () => {
  it("a lista de ofertas nao tem mais nenhum texto em ingles", async () => {
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

    // O titulo identifica a secao sem repetir um paragrafo de instrucoes.
    expect(await screen.findByText("Otros precios")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Crea paquetes de pago único o por suscripción. La oferta predeterminada rige la página principal; cada oferta activa tiene su propio enlace de compra exacto.",
      ),
    ).not.toBeInTheDocument();

    // Marca da oferta padrao e o botao que abre o formulario. A lista chega
    // depois do fetch: esperar, senao a asserção corre na frente do carregamento
    // (falhava quando dois arquivos dividiam o mesmo fork).
    expect(await screen.findByText("precio principal")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Agregar otro precio" }),
    ).toBeInTheDocument();

    // Linha da oferta ativa: preco, tipo de pagamento e codigo publico.
    const ativa = screen.getByText("precio principal").closest("li");
    expect(ativa?.textContent).toContain("Pago único");
    expect(ativa?.textContent).toContain("código LAUNCH");

    // Linha da oferta sem preco e inativa.
    const inativa = screen.getByText("Sin precio", { exact: false });
    expect(inativa.textContent).toContain("inactivo");

    // Rotulo do link de checkout da oferta.
    expect(screen.getByText("página de pago de Launch")).toBeInTheDocument();

    semIngles(INGLES_ANTIGO_LISTA);
  });

  it("o formulario de nova oferta nao tem mais nenhum texto em ingles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })),
    );

    renderEs();

    // Sem oferta nenhuma o formulario ja vem aberto, junto do estado vazio.
    const nome = await screen.findByLabelText("Nombre de este precio");
    expect(nome).toHaveValue("Otro precio");
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

    const cadaCuanto = screen.getByLabelText("Cada cuánto pagan");
    expect(
      Array.from(cadaCuanto.querySelectorAll("option")).map(
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

    // O nome inicial em ingles tambem sumiu do campo.
    expect(nome).not.toHaveValue("Standard offer");
    semIngles(INGLES_ANTIGO_FORMULARIO);
  });
});
