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
  expect(await screen.findByRole("link", { name: "Open Launch payment page" })).toHaveAttribute("href", "/courses/course-1/checkout?offer=LAUNCH");
  expect(screen.getByRole("link", { name: "Open Standard payment page" })).toHaveAttribute("href", "/courses/course-1/checkout?offerId=o2");
  expect(screen.queryByRole("link", { name: /Expired/ })).not.toBeInTheDocument();
  const section = screen.getByRole("heading", { level: 2 }).parentElement;
  expect(section?.tagName).toBe("SECTION");
  expect(section?.className).not.toMatch(/border|shadow|rounded/);
});
it("publishes offer links on pay.skillsetmind.com in production, code and ID preserved", async () => {
  stubOffers();
  vi.stubGlobal("location", { ...window.location, hostname: "www.skillsetmind.com" });
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  expect(await screen.findByRole("link", { name: "Open Launch payment page" })).toHaveAttribute("href", "https://pay.skillsetmind.com/courses/course-1/checkout?offer=LAUNCH");
  expect(screen.getByRole("link", { name: "Open Standard payment page" })).toHaveAttribute("href", "https://pay.skillsetmind.com/courses/course-1/checkout?offerId=o2");
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
  expect(screen.getByLabelText("How often they pay")).toHaveValue("subscription_monthly");
  expect(screen.getByLabelText("Currency")).toHaveValue("BRL");
});

// "Adicionar outro preco" fica dentro da forma de pagar da etapa de preco:
// nunca um segundo "Payment type" com as quatro respostas.
function pricing(paymentType: "one_time" | "subscription_monthly" | "subscription_yearly" | null, amountMinor: number) {
  return { free: paymentType === null, paymentType, amountMinor, currency: "USD", installmentsMax: null };
}

it("mensalidade: o outro preco e mensal ou o plano anual, nada de pagamento unico ou gratis", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" coursePricing={pricing("subscription_monthly", 2900)} />);

  const often = await screen.findByLabelText("How often they pay");
  expect(Array.from(often.querySelectorAll("option")).map((option) => option.textContent)).toEqual([
    "Monthly membership",
    "Yearly plan",
  ]);
});

it("pagamento unico: o outro preco e outro valor unico, sem escolher forma de pagar", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" coursePricing={pricing("one_time", 9900)} />);

  expect(await screen.findByLabelText("Amount")).toHaveValue(99);
  expect(screen.queryByLabelText("How often they pay")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add price" })).toBeInTheDocument();
});

it("curso gratuito: nao tem outro preco, e a tela diz onde mudar", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" coursePricing={pricing(null, 0)} />);

  expect(await screen.findByText(/This product is free, so it has no other prices/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add another price" })).not.toBeInTheDocument();
});

// "Add the yearly plan" na etapa de preco abre o formulario ja pronto. O anual
// e um preco a mais: nao vira o principal, e sem principal a tela avisa que a
// pagina mostra o primeiro preco.
it("plano anual vindo da etapa de preco: formulario aberto, anual e nao principal", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(
    <CourseOffersPanel
      courseId="course-1"
      courseTitle="Launch course"
      coursePricing={pricing("subscription_monthly", 2900)}
      prefill={{ paymentType: "subscription_yearly", amountMinor: 29000 }}
    />,
  );

  expect(await screen.findByLabelText("Amount")).toHaveValue(290);
  expect(screen.getByLabelText("Name of this price")).toHaveValue("Yearly plan");
  expect(screen.getByLabelText("How often they pay")).toHaveValue("subscription_yearly");
  expect(screen.getByLabelText("Make this the main price on your page")).not.toBeChecked();
  expect(screen.getByText("Until one price is the main price, your page shows the first price added here.")).toBeInTheDocument();
});

it("plano anual num produto de pagamento unico: o pedido e ignorado", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(
    <CourseOffersPanel
      courseId="course-1"
      courseTitle="Launch course"
      coursePricing={pricing("one_time", 9900)}
      prefill={{ paymentType: "subscription_yearly", amountMinor: 29000 }}
    />,
  );

  expect(await screen.findByLabelText("Amount")).toHaveValue(99);
  expect(screen.getByLabelText("Make this the main price on your page")).toBeChecked();
});

// Com oferta criada, o formulario empurrava a lista real para baixo.
it("com ofertas, a lista vem antes e o formulario fica atras de Add another price", async () => {
  stubOffers();
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);

  await screen.findByText("Launch");
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();

  const toggle = screen.getByRole("button", { name: "Add another price" });
  const list = screen.getByRole("list");
  // compareDocumentPosition: 4 = o segundo no vem DEPOIS do primeiro.
  expect(list.compareDocumentPosition(toggle)).toBe(Node.DOCUMENT_POSITION_PRECEDING);

  fireEvent.click(toggle);
  const amount = screen.getByLabelText("Amount");
  expect(amount).toBeInTheDocument();
  expect(list.compareDocumentPosition(amount)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it("sem nenhuma oferta, o formulario continua aberto e nao ha botao Add another price", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);

  expect(await screen.findByLabelText("Amount")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add another price" })).not.toBeInTheDocument();
});
