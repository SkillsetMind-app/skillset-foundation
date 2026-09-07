import { cleanup, render, screen } from "@testing-library/react";
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
