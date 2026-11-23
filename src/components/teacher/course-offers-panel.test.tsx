import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { resolveCoursePrice, type ProductOffer } from "@/domain/product-pricing";
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
// Cada linha de preco leva so o "Copy link" (a caixa inteira fica em Promo
// links): o link que ele copia e a prova do codigo / id da oferta.
async function copiedUrl(name: string) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  fireEvent.click(await screen.findByRole("button", { name: `Copy ${name} payment page link` }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  return writeText.mock.calls[0][0];
}
// jsdom serve em localhost: fora de produção o link de oferta fica relativo,
// para que um preview nunca publique um host que só resolve em produção.
it("shares checkout by public code or offer ID, never inactive offers", async () => {
  stubOffers();
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  expect(await copiedUrl("Launch")).toBe("/courses/course-1/checkout?offer=LAUNCH");
  expect(await copiedUrl("Standard")).toBe("/courses/course-1/checkout?offerId=o2");
  expect(screen.queryByRole("button", { name: /Expired/ })).not.toBeInTheDocument();
  // Sem caixa de link por linha: nem Abrir nem Compartilhar.
  expect(screen.queryByRole("link", { name: /payment page/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Share / })).not.toBeInTheDocument();
  const section = screen.getByRole("heading", { level: 2 }).parentElement;
  expect(section?.tagName).toBe("SECTION");
  expect(section?.className).not.toMatch(/border|shadow|rounded/);
});
it("publishes offer links on pay.skillsetmind.com in production, code and ID preserved", async () => {
  stubOffers();
  vi.stubGlobal("location", { ...window.location, hostname: "www.skillsetmind.com" });
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  expect(await copiedUrl("Launch")).toBe("https://pay.skillsetmind.com/courses/course-1/checkout?offer=LAUNCH");
  expect(await copiedUrl("Standard")).toBe("https://pay.skillsetmind.com/courses/course-1/checkout?offerId=o2");
  expect(screen.queryByRole("button", { name: /Expired/ })).not.toBeInTheDocument();
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
// e um preco a mais: nao vira o principal, e sem principal a tela avisa que o
// preco atual vira o principal antes.
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
  // Com prefill o formulario ja nasce aberto, entao o findBy acima resolve antes
  // de as ofertas carregarem; o aviso so aparece depois (!loading). getBy aqui
  // dependia da corrida com o fetch e falhava no CI.
  expect(await screen.findByText(/^Your page keeps charging \D*29[.,]00 \(Monthly membership\): that price becomes the main price first/)).toBeInTheDocument();
});

// O anual sozinho virava o preco da pagina: o checkout cobra o principal ou,
// sem principal, o primeiro preco ativo (resolveCoursePrice). Enviar o
// formulario pronto num produto sem preco nenhum aqui grava antes o mensal
// atual como principal, e a pagina continua cobrando o mensal.
it("plano anual sem preco principal: o mensal vira o principal antes e o checkout segue no mensal", async () => {
  const saved: ProductOffer[] = [];
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push(body);
      if (body.isDefault) saved.forEach((offer) => { offer.isDefault = false; });
      const id = `o${saved.length + 1}`;
      saved.push({
        id, courseId: "course-1", name: String(body.name), isDefault: Boolean(body.isDefault), active: true,
        prices: [{ id: `p-${id}`, offerId: id, amountMinor: Number(body.amountMinor), currency: String(body.currency),
          paymentType: body.paymentType as ProductOffer["prices"][number]["paymentType"], active: true }],
      });
      return { ok: true, json: async () => ({ offerId: id }) };
    }
    return { ok: true, json: async () => ({ offers: saved.map((offer) => ({ ...offer })) }) };
  }));
  render(
    <CourseOffersPanel
      courseId="course-1"
      courseTitle="Launch course"
      coursePricing={pricing("subscription_monthly", 2900)}
      prefill={{ paymentType: "subscription_yearly", amountMinor: 29000 }}
    />,
  );

  const submit = await screen.findByRole("button", { name: "Add price" });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await screen.findByText("Price added. Its link charges exactly this price.");

  expect(posts).toHaveLength(2);
  expect(posts[0]).toMatchObject({ isDefault: true, paymentType: "subscription_monthly", amountMinor: 2900, currency: "USD" });
  expect(posts[1]).toMatchObject({ isDefault: false, paymentType: "subscription_yearly", amountMinor: 29000 });
  const course = { id: "course-1", priceAmountMinor: 2900, currency: "USD", paymentType: "subscription_monthly" as const };
  expect(resolveCoursePrice(course, saved)).toMatchObject({ amountMinor: 2900, paymentType: "subscription_monthly" });
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

// A mensagem crua da rota (ingles, as vezes tecnica) ia direto para a tela e
// nao era anunciada. Agora sai a frase da casa, num alerta.
it.each([
  ["Pay the one-time activation fee to activate your creator account.", "Pay the one-time activation fee before adding a price."],
  ["A paid offer must have a positive price.", "Enter a valid price."],
  // O limite de tentativas diz para esperar, nao "nao deu".
  ["Too many attempts. Please wait before trying again.", "Too many attempts in a row. Wait a moment and try again."],
  ["duplicate key value violates unique constraint", "Could not add this price."],
])("criar falha com %s: frase da casa, anunciada", async (raw, shown) => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? { ok: false, json: async () => ({ error: raw }) }
      : { ok: true, json: async () => ({ offers: [] }) }));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Add price" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(shown);
  if (raw !== shown) expect(screen.queryByText(raw)).not.toBeInTheDocument();
});

it("a lista que a rota nao leu vira erro de leitura, nao 'nenhum preco'", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [], warning: "Offers are unavailable." }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your prices.");
  expect(screen.queryByText("Offers are unavailable.")).not.toBeInTheDocument();
});

// F-11: sem a lista, a tela não sabe se há preço. Não abre o formulário de
// criar (gravaria outro preço principal) e "Try again" lê de novo.
it("lista que nao carregou: sem formulario de criar, e Try again le de novo", async () => {
  const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: "boom" }) }));
  vi.stubGlobal("fetch", fetchMock);
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your prices.");
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();

  stubOffers();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Launch")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
