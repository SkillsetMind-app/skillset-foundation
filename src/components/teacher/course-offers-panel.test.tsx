import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CourseOffersPanel } from "./course-offers-panel";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function stubOffers() {
  const price = { id: "price-1", amountMinor: 4900, currency: "USD", paymentType: "one_time", active: true };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [
    { id: "o1", name: "Launch", active: true, publicCode: "LAUNCH", prices: [price] },
    { id: "o2", name: "Standard", active: true, prices: [price] },
    { id: "o3", name: "Expired", active: false, prices: [price] },
  ] }) })));
}
// jsdom serve em localhost: fora de produção o link de oferta fica relativo,
// para que um preview nunca publique um host que só resolve em produção.
it("shares checkout by public code or offer ID, never inactive offers", async () => {
  stubOffers();
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  expect(await screen.findByRole("link", { name: "Open Launch checkout" })).toHaveAttribute("href", "/courses/course-1/checkout?offer=LAUNCH");
  expect(screen.getByRole("link", { name: "Open Standard checkout" })).toHaveAttribute("href", "/courses/course-1/checkout?offerId=o2");
  expect(screen.queryByRole("link", { name: /Expired/ })).not.toBeInTheDocument();
});
it("publishes offer links on pay.skillsetmind.com in production, code and ID preserved", async () => {
  stubOffers();
  vi.stubGlobal("location", { ...window.location, hostname: "www.skillsetmind.com" });
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  expect(await screen.findByRole("link", { name: "Open Launch checkout" })).toHaveAttribute("href", "https://pay.skillsetmind.com/courses/course-1/checkout?offer=LAUNCH");
  expect(screen.getByRole("link", { name: "Open Standard checkout" })).toHaveAttribute("href", "https://pay.skillsetmind.com/courses/course-1/checkout?offerId=o2");
  expect(screen.queryByRole("link", { name: /Expired/ })).not.toBeInTheDocument();
});

// O formulario nascia sempre com 97 USD avulso: num curso por assinatura de
// R$29 a tela pedia para confirmar um preco que nao era o do curso.
it("o formulario de oferta nasce com o preco do proprio curso", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(
    <CourseOffersPanel
      courseId="course-1"
      courseTitle="Launch course"
      coursePricing={{
        free: false,
        paymentType: "subscription_monthly",
        amountMinor: 2900,
        currency: "BRL",
        installmentsMax: null,
      }}
    />,
  );

  expect(await screen.findByLabelText("Amount")).toHaveValue(29);
  expect(screen.getByLabelText("Payment type")).toHaveValue("subscription_monthly");
  expect(screen.getByLabelText("Currency")).toHaveValue("BRL");
});

it("curso gratuito: a oferta nasce zerada e gratuita, nunca 97 USD", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(
    <CourseOffersPanel
      courseId="course-1"
      courseTitle="Launch course"
      coursePricing={{
        free: true,
        paymentType: null,
        amountMinor: 0,
        currency: "USD",
        installmentsMax: null,
      }}
    />,
  );

  expect(await screen.findByLabelText("Amount")).toHaveValue(0);
  expect(screen.getByLabelText("Payment type")).toHaveValue("free");
});

// Com oferta criada, o formulario empurrava a lista real para baixo.
it("com ofertas, a lista vem antes e o formulario fica atras de New offer", async () => {
  stubOffers();
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);

  await screen.findByText("Launch");
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();

  const toggle = screen.getByRole("button", { name: "New offer" });
  const list = screen.getByRole("list");
  // compareDocumentPosition: 4 = o segundo no vem DEPOIS do primeiro.
  expect(list.compareDocumentPosition(toggle)).toBe(Node.DOCUMENT_POSITION_PRECEDING);

  fireEvent.click(toggle);
  const amount = screen.getByLabelText("Amount");
  expect(amount).toBeInTheDocument();
  expect(list.compareDocumentPosition(amount)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it("sem nenhuma oferta, o formulario continua aberto e nao ha botao New offer", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);

  expect(await screen.findByLabelText("Amount")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "New offer" })).not.toBeInTheDocument();
});
