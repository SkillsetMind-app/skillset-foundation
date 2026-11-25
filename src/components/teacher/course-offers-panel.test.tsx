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
// Each price row only carries the "Copy link" (the whole box stays in Promo
// links): the link it copies is the proof of the offer's code / id.
async function copiedUrl(name: string) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  fireEvent.click(await screen.findByRole("button", { name: `Copy ${name} payment page link` }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  return writeText.mock.calls[0][0];
}
// jsdom serves on localhost: outside production the offer link stays relative,
// so a preview never publishes a host that only resolves in production.
it("shares checkout by public code or offer ID, never inactive offers", async () => {
  stubOffers();
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  expect(await copiedUrl("Launch")).toBe("/courses/course-1/checkout?offer=LAUNCH");
  expect(await copiedUrl("Standard")).toBe("/courses/course-1/checkout?offerId=o2");
  expect(screen.queryByRole("button", { name: /Expired/ })).not.toBeInTheDocument();
    // No link box per row: neither Open nor Share.
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

// The form always started with a one-time 97 USD: in a course on a
// R$29 subscription the screen asked to confirm a price that was not the course's.
it("the offer form starts with the course's own price", async () => {
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

// "Add another price" stays inside the payment type chosen in the pricing step:
// never a second "Payment type" with the four answers.
function pricing(paymentType: "one_time" | "subscription_monthly" | "subscription_yearly" | null, amountMinor: number) {
  return { free: paymentType === null, paymentType, amountMinor, currency: "USD", installmentsMax: null };
}

it("monthly: the other price is monthly or the yearly plan, never one-time payment or free", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" coursePricing={pricing("subscription_monthly", 2900)} />);

  const often = await screen.findByLabelText("How often they pay");
  expect(Array.from(often.querySelectorAll("option")).map((option) => option.textContent)).toEqual([
    "Monthly membership",
    "Yearly plan",
  ]);
});

it("one-time payment: the other price is another one-time amount, with no way to pick how to pay", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" coursePricing={pricing("one_time", 9900)} />);

  expect(await screen.findByLabelText("Amount")).toHaveValue(99);
  expect(screen.queryByLabelText("How often they pay")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add price" })).toBeInTheDocument();
});

it("free course: has no other price, and the screen says where to change it", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" coursePricing={pricing(null, 0)} />);

  expect(await screen.findByText(/This product is free, so it has no other prices/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add another price" })).not.toBeInTheDocument();
});

// "Add the yearly plan" at the pricing step opens the form already filled in. The yearly one
// is an extra price: it does not become the main one, and without a main one the screen warns that the
// current price becomes the main one first.
it("annual plan coming from the price step: form open, annual and not primary", async () => {
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
    // With prefill the form is already born open, so the findBy above resolves before
    // the offers load; the warning only appears afterwards (!loading). getBy here
    // depended on the race with the fetch and failed in CI.
  expect(await screen.findByText(/^Your page keeps charging \D*29[.,]00 \(Monthly membership\): that price becomes the main price first/)).toBeInTheDocument();
});

// The yearly one alone became the page price: the checkout charges the main one or,
// without a main one, the first active price (resolveCoursePrice). Submitting the
// ready form on a product with no price at all here first saves the current monthly
// one as the main one, and the page keeps charging the monthly one.
it("yearly plan without a main price: the monthly one becomes the main one first and the checkout stays on the monthly one", async () => {
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

it("annual plan on a one-time payment product: the request is ignored", async () => {
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

// With an offer created, the form pushed the real list down.
it("with offers, the list comes first and the form sits behind Add another price", async () => {
  stubOffers();
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);

  await screen.findByText("Launch");
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();

  const toggle = screen.getByRole("button", { name: "Add another price" });
  const list = screen.getByRole("list");
  // compareDocumentPosition: 4 = the second node comes AFTER the first.
  expect(list.compareDocumentPosition(toggle)).toBe(Node.DOCUMENT_POSITION_PRECEDING);

  fireEvent.click(toggle);
  const amount = screen.getByLabelText("Amount");
  expect(amount).toBeInTheDocument();
  expect(list.compareDocumentPosition(amount)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it("with no offer at all, the form stays open and there is no Add another price button", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);

  expect(await screen.findByLabelText("Amount")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add another price" })).not.toBeInTheDocument();
});

// The raw route message (English, sometimes technical) went straight to the screen and
// was not announced. Now the house phrase comes out, in an alert.
it.each([
  ["Pay the one-time activation fee to activate your creator account.", "Pay the one-time activation fee before adding a price."],
  ["A paid offer must have a positive price.", "Enter a valid price."],
    // The attempts limit says to wait, not "it did not work".
  ["Too many attempts. Please wait before trying again.", "Too many attempts in a row. Wait a moment and try again."],
  ["duplicate key value violates unique constraint", "Could not add this price."],
])("create fails with %s: house phrase, announced", async (raw, shown) => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? { ok: false, json: async () => ({ error: raw }) }
      : { ok: true, json: async () => ({ offers: [] }) }));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  fireEvent.click(await screen.findByRole("button", { name: "Add price" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(shown);
  if (raw !== shown) expect(screen.queryByText(raw)).not.toBeInTheDocument();
});

it("a list the route did not read becomes a read error, not 'no price'", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [], warning: "Offers are unavailable." }) })));
  render(<CourseOffersPanel courseId="course-1" courseTitle="Launch course" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your prices.");
  expect(screen.queryByText("Offers are unavailable.")).not.toBeInTheDocument();
});

// F-11: without the list, the screen does not know whether there is a price. It does not open the
// create form (it would save another main price) and "Try again" reads again.
it("list that did not load: no create form, and Try again reads it again", async () => {
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
