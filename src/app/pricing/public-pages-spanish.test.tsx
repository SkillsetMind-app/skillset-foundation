import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PricingPage, { generateMetadata as pricingMetadata } from "./page";
import CreatorsPage, { generateMetadata as creatorsMetadata } from "@/app/for-creators/page";
import PromisePage, { generateMetadata as promiseMetadata } from "@/app/promise/page";
import AboutPage, { generateMetadata as aboutMetadata } from "@/app/about/page";
import ContactPage, { generateMetadata as contactMetadata } from "@/app/contact/page";
import InstructorsPage, { generateMetadata as instructorsMetadata } from "@/app/instructors/page";
import { generateMetadata as profileMetadata } from "@/app/instructors/[slug]/page";

const state = vi.hoisted(() => ({ locale: "es" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.locale }) }) }));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/instructors/instructors-directory", () => ({ InstructorsDirectory: () => null }));
afterEach(() => { cleanup(); state.locale = "es"; });

it("localizes profile metadata without changing its canonical reference", async () => {
  const metadata = await profileMetadata({ params: Promise.resolve({ slug: "original-author" }) });
  expect(metadata.title).toContain("Instructor");
  expect(metadata.description).toBe("Un experto independiente que publica cursos profesionales revisados en SkillsetMind.");
  expect(metadata.alternates?.canonical).toBe("https://www.skillsetmind.com/instructors/original-author");
});

it.each([
  [PricingPage, pricingMetadata, "Precios que bajan a medida que creces.", "Precios"],
  [CreatorsPage, creatorsMetadata, "Enseña con un sistema completo para gestionar cursos.", "Enseña en SkillsetMind"],
  [PromisePage, promiseMetadata, "Seis compromisos. Por escrito. Públicos.", "La promesa de SkillsetMind"],
  [AboutPage, aboutMetadata, "SkillsetMind es un espacio público para aprender, enseñar y crecer con confianza.", "Acerca de nosotros"],
  [ContactPage, contactMetadata, "Contacta con el equipo adecuado para soporte, enseñanza y colaboraciones.", "Contacto"],
  [InstructorsPage, instructorsMetadata, "Aprende de expertos evaluados.", "Instructores"],
] as const)("renders Spanish page and metadata", async (Page, metadata, heading, title) => {
  const { container } = render(await Page());
  expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  expect((await metadata()).title).toContain(title);
  expect(container.textContent).not.toContain("publicPages.");
});

it("refreshes pricing language without resetting the selected cycle or expanded FAQ", async () => {
  state.locale = "en";
  const view = render(await PricingPage());
  fireEvent.click(screen.getByLabelText(/Yearly/));
  const question = screen.getByText("What happens when I downgrade or cancel?").closest("details")!;
  question.open = true;
  state.locale = "es";
  view.rerender(await PricingPage());
  expect(screen.getByLabelText(/Anual/)).toBeChecked();
  expect(screen.getByText("¿Qué ocurre si cambio a un plan inferior o cancelo?").closest("details")).toHaveAttribute("open");
  expect(screen.getByRole("region", { name: "Comparación de planes" })).toHaveTextContent("$19/mes");
  expect(screen.getByRole("columnheader", { name: "Comisión de la plataforma" })).toBeInTheDocument();
  expect(screen.getByText("La comisión baja del 10% al 5%")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Empieza con Pro" })).toBeInTheDocument();
});
