import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Page, { generateMetadata } from "./page";
const state = vi.hoisted(() => ({
  course: { title: "Focus", summary: "Build focus", coverImageUrl: null as string | null, urlSlug: "focus", lessonCount: 17 as number | null } as Record<string, unknown> | null,
}));
vi.mock("@/lib/data/server/public-course", () => ({ getPublicCourseByRef: async () => state.course }));
vi.mock("@/components/site/checkout-header", () => ({ CheckoutHeader: ({ secureLabel }: { secureLabel: string }) => <header data-testid="checkout-header">{secureLabel}</header> }));
vi.mock("@/components/courses/creator-course-detail", () => ({ CreatorCourseDetail: (props: { checkoutOnly?: boolean; courseIdOverride?: string; hideHeader?: boolean }) => <div data-testid="checkout" data-compact={props.checkoutOnly} data-course={props.courseIdOverride} data-hide-header={props.hideHeader} /> }));
afterEach(cleanup);
const focus = () => ({ title: "Focus", summary: "Build focus", coverImageUrl: null, urlSlug: "focus", lessonCount: 17 });
it("renders public title and compact checkout with the route reference", async () => {
  render(await Page({ params: Promise.resolve({ slug: "focus" }) }));
  expect(screen.getByRole("heading", { name: "Focus" })).toBeInTheDocument();
  expect(screen.getByTestId("checkout")).toHaveAttribute("data-compact", "true");
  expect(screen.getByTestId("checkout")).toHaveAttribute("data-course", "focus");
  expect(screen.getByTestId("checkout")).toHaveAttribute("data-hide-header", "true");
});
it("shows the order summary next to the form, with a way to the full course page", async () => {
  const { container } = render(await Page({ params: Promise.resolve({ slug: "focus" }) }));
  const summary = container.querySelector("[data-checkout-summary]") as HTMLElement;
  expect(within(summary).getByText("Tu pedido")).toBeInTheDocument();
  expect(within(summary).getByText("17 lecciones")).toBeInTheDocument();
  expect(within(summary).getByRole("link", { name: "Ver todos los detalles del curso" })).toHaveAttribute("href", "/courses/focus");
  // Sem capa, sem imagem: não se inventa arte.
  expect(summary.querySelector("img")).toBeNull();
});
it("shows the cover in the summary when the course has one", async () => {
  state.course = { ...focus(), coverImageUrl: "https://ijtikldtjvsbtwszokvs.supabase.co/storage/v1/object/public/c.png" };
  try {
    const { container } = render(await Page({ params: Promise.resolve({ slug: "focus" }) }));
    expect(container.querySelector("[data-checkout-summary] img")).not.toBeNull();
  } finally {
    state.course = focus();
  }
});
it("has the checkout header and no site menu to leave by", async () => {
  render(await Page({ params: Promise.resolve({ slug: "focus" }) }));
  expect(screen.getByTestId("checkout-header")).toHaveTextContent("Compra segura");
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
it("without a public course there is no summary, and the checkout draws its own state", async () => {
  state.course = null;
  try {
    const { container } = render(await Page({ params: Promise.resolve({ slug: "missing" }) }));
    expect(container.querySelector("[data-checkout-summary]")).toBeNull();
    expect(screen.getByTestId("checkout")).toHaveAttribute("data-hide-header", "false");
  } finally {
    state.course = focus();
  }
});
it("uses public course metadata and the permanent checkout canonical", async () => {
  const metadata = await generateMetadata({ params: Promise.resolve({ slug: "focus" }) });
  expect(metadata.title).toContain("Focus");
  expect(metadata.title).toContain("Pago");
  expect(metadata.description).toBe("Build focus");
  expect(metadata.alternates?.canonical).toBe("https://www.skillsetmind.com/courses/focus/checkout");
});
it("um título com $& no <title> do checkout aparece literal, sem virar '{title}'", async () => {
  // Num replace sem callback, "$&" vira o trecho casado ("{title}"). O título é
  // texto do professor, não nosso.
  state.course = { ...focus(), title: "Focus $&" };
  try {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "focus" }) });
    expect(metadata.title).toContain("Focus $& — Pago");
  } finally {
    state.course = focus();
  }
});

vi.mock("@/lib/i18n/server", () => ({ getServerTranslation: async () => ({ locale: "es", t: (key: string) => translate(getDictionary("es"), key) }) }));
