import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";

import { CourseShareLink } from "./course-share-link";

// O I18nProvider pede o router para dar refresh quando o idioma troca. Aqui
// ninguem troca, mas o hook precisa existir fora do Next.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const title = "Coaching & Sales 101";
// Literais, nao encodeURIComponent: a prova e que o "&" e os espacos do titulo
// nao quebram a query string de nenhuma rede.
const encodedTitle = "Coaching%20%26%20Sales%20101";
const encodedUrl = "https%3A%2F%2Fwww.skillsetmind.com%2Fcourses%2Fcourse-1";

describe("CourseShareLink", () => {
  it("shows and copies the permanent public URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout?offer=LAUNCH" title={title} />);
    const url = "https://www.skillsetmind.com/courses/course-1/checkout?offer=LAUNCH";
    expect(screen.getByText(url)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveAttribute("href", url);
    fireEvent.click(screen.getByRole("button", { name: "Copy Checkout link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied.");
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("announces denied clipboard permission and keeps the URL available", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Checkout link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Copy the link above manually.");
    expect(screen.queryByText("Link copied.")).not.toBeInTheDocument();
    expect(screen.getByText("https://www.skillsetmind.com/courses/course-1/checkout")).toBeInTheDocument();
  });

  it("keeps the English labels byte for byte outside the provider", () => {
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    expect(screen.getByRole("button", { name: "Copy Checkout link" })).toHaveTextContent("Copy link");
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveTextContent("Open page");
    expect(screen.getByRole("button", { name: "Share Checkout" })).toHaveTextContent("Share");
  });

  it("speaks Spanish inside the provider, share menu included", () => {
    render(
      <I18nProvider initialLocale="es">
        <CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Copiar enlace de Checkout" })).toHaveTextContent("Copiar enlace");
    expect(screen.getByRole("link", { name: "Abrir Checkout" })).toHaveTextContent("Abrir página");
    fireEvent.click(screen.getByRole("button", { name: "Compartir Checkout" }));
    const menu = screen.getByRole("menu", { name: "Opciones para compartir Checkout" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "WhatsApp",
      "X",
      "LinkedIn",
      "Correo",
    ]);
  });

  it("opens a Share menu with WhatsApp, X, LinkedIn and email intents for title + URL", () => {
    render(<CourseShareLink label="Product page" path="/courses/course-1" title={title} />);
    const share = screen.getByRole("button", { name: "Share Product page" });
    expect(share).toHaveAttribute("aria-haspopup", "menu");
    expect(share).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(share);
    expect(share).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Product page share options" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "WhatsApp",
      "X",
      "LinkedIn",
      "Email",
    ]);
    expect(within(menu).getByRole("menuitem", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodedTitle}%20${encodedUrl}`,
    );
    expect(within(menu).getByRole("menuitem", { name: "X" })).toHaveAttribute(
      "href",
      `https://x.com/intent/post?text=${encodedTitle}&url=${encodedUrl}`,
    );
    expect(within(menu).getByRole("menuitem", { name: "LinkedIn" })).toHaveAttribute(
      "href",
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    );
    expect(within(menu).getByRole("menuitem", { name: "Email" })).toHaveAttribute(
      "href",
      `mailto:?subject=${encodedTitle}&body=${encodedTitle}%20${encodedUrl}`,
    );

    for (const name of ["WhatsApp", "X", "LinkedIn"]) {
      const item = within(menu).getByRole("menuitem", { name });
      expect(item).toHaveAttribute("target", "_blank");
      expect(item).toHaveAttribute("rel", "noopener noreferrer");
    }
    // O mailto abre o app de e-mail; nova aba seria uma aba em branco.
    expect(within(menu).getByRole("menuitem", { name: "Email" })).not.toHaveAttribute("target");
  });

  it("closes on Escape and hands focus back to the Share button", () => {
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    const share = screen.getByRole("button", { name: "Share Checkout" });
    fireEvent.click(share);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(share).toHaveAttribute("aria-expanded", "false");
    expect(share).toHaveFocus();
  });

  it("closes when the pointer goes down outside the button row", () => {
    render(<CourseShareLink label="Checkout" path="/courses/course-1/checkout" title={title} />);
    fireEvent.click(screen.getByRole("button", { name: "Share Checkout" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
