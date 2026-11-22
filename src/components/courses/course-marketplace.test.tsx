import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { TeacherCourse } from "@/domain/teacher-course";
import { CourseMarketplace } from "./course-marketplace";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "es", query: new URLSearchParams("cat=Performance&q=focus&offer=SPRING"), replace: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/components/i18n/i18n-provider", () => ({ useTranslation: () => ({ locale: state.locale, t: (key: string) => translate(getDictionary(state.locale), key) }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ status: "unauthenticated", user: null }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/courses", useSearchParams: () => state.query, useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseClientConfig: () => ({}) }));
vi.mock("@/components/courses/use-instructor-names", () => ({ useInstructorNames: () => new Map() }));
vi.mock("@/lib/data/published-courses", async (original) => ({ ...(await original<typeof import("@/lib/data/published-courses")>()), subscribeToPublishedTeacherCourses: state.subscribe }));

beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "en";
  state.query = new URLSearchParams("cat=Performance&q=focus&offer=SPRING");
});
afterEach(cleanup);

it("keeps loaded courses, filter IDs, search and URL offer when switching to Spanish", async () => {
  state.subscribe.mockImplementation((next: (courses: TeacherCourse[]) => void) => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep focus", summary: "Author's own words", category: "Performance", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    return () => {};
  });
  const { rerender } = render(<CourseMarketplace />);
  await screen.findByRole("link", { name: "Deep focus" });
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "price-asc" } });
  state.locale = "es";
  rerender(<CourseMarketplace />);
  expect(screen.getByPlaceholderText("Busca una habilidad, categoría o resultado")).toHaveValue("focus");
  expect(screen.getByLabelText("Ordenar por")).toHaveValue("price-asc");
  expect(screen.getByRole("button", { name: /Performance/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Performance · 3 lecciones")).toBeInTheDocument();
  expect(screen.getByText("Author's own words")).toBeInTheDocument();
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /Todos los cursos/ }));
  const destination = new URL(state.replace.mock.lastCall![0], "https://skillset.test");
  expect(destination.searchParams.get("cat")).toBeNull();
  expect(destination.searchParams.get("q")).toBe("focus");
  expect(destination.searchParams.get("offer")).toBe("SPRING");
});

it("keeps a category search result across EN to ES and also searches its translated label", async () => {
  state.query = new URLSearchParams("q=Personal+Development&offer=SPRING");
  state.subscribe.mockImplementation((next: (courses: TeacherCourse[]) => void) => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep focus", summary: "Author's own words", category: "Personal Development", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    return () => {};
  });
  const { rerender } = render(<CourseMarketplace />);
  await screen.findByRole("link", { name: "Deep focus" });

  state.locale = "es";
  rerender(<CourseMarketplace />);

  const search = screen.getByPlaceholderText("Busca una habilidad, categoría o resultado");
  expect(search).toHaveValue("Personal Development");
  expect(screen.getByRole("link", { name: "Deep focus" })).toBeInTheDocument();
  expect(screen.getByText("Desarrollo personal · 3 lecciones")).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "desarrollo personal" } });
  expect(await screen.findByRole("link", { name: "Deep focus" })).toBeInTheDocument();
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  const destination = new URL(state.replace.mock.lastCall![0], "https://skillset.test");
  expect(destination.searchParams.get("q")).toBe("desarrollo personal");
  expect(destination.searchParams.get("offer")).toBe("SPRING");
});

it("keeps a Spanish category search result when switching back to English", async () => {
  state.locale = "es";
  state.query = new URLSearchParams("cat=Personal+Development&q=Desarrollo+personal&offer=SPRING");
  state.subscribe.mockImplementation((next: (courses: TeacherCourse[]) => void) => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep focus", summary: "Author's own words", category: "Personal Development", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    return () => {};
  });
  const { rerender } = render(<CourseMarketplace />);
  await screen.findByRole("link", { name: "Deep focus" });

  state.locale = "en";
  rerender(<CourseMarketplace />);

  expect(screen.getByPlaceholderText("Search skill, category, or outcome")).toHaveValue("Desarrollo personal");
  expect(screen.getByRole("link", { name: "Deep focus" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Personal Development/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Personal Development · 3 lessons")).toBeInTheDocument();
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  expect(state.replace).not.toHaveBeenCalled();
  expect(state.query.get("cat")).toBe("Personal Development");
  expect(state.query.get("q")).toBe("Desarrollo personal");
  expect(state.query.get("offer")).toBe("SPRING");
});

it("um título com $& na etiqueta da lista de desejos aparece literal, sem virar '{title}'", async () => {
  // Num replace sem callback, "$&" vira o trecho casado ("{title}"). O título é
  // texto do professor, não nosso.
  state.subscribe.mockImplementation((next: (courses: TeacherCourse[]) => void) => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep $& focus", summary: "Author's own words", category: "Performance", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    return () => {};
  });
  render(<CourseMarketplace />);
  expect(await screen.findByRole("button", { name: "Save Deep $& focus to wishlist" })).toBeInTheDocument();
});

// "All courses 0" enquanto a lista carregava lia como loja vazia; e os cartões
// de espera não tinham a linha de preço, então a página pulava ao carregar.
it("enquanto carrega, a categoria fica sem número e os cartões de espera têm o rodapé do cartão real", () => {
  state.query = new URLSearchParams("");
  state.subscribe.mockImplementation(() => () => {});
  const { container } = render(<CourseMarketplace />);

  expect(screen.getByRole("button", { name: "All courses" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading courses...");
  expect(container.querySelectorAll(".marketplace-card")).toHaveLength(6);
  expect(container.querySelectorAll(".marketplace-card .marketplace-card__footer")).toHaveLength(6);
});

it("a falha ao carregar a lista é anunciada ao leitor de tela", () => {
  state.subscribe.mockImplementation((_next: unknown, onError: () => void) => {
    onError();
    return () => {};
  });
  render(<CourseMarketplace />);

  expect(screen.getByRole("alert")).toHaveTextContent(translate(getDictionary("en"), "publicCourses.loadCoursesError"));
});

// A falha era um beco ("Refresh the page"): agora "Try again" relê pela mesma
// inscrição, e o vazio "Marketplace opening soon" não aparece junto do erro.
it("a falha da lista oferece Try again, que relê sem reinscrever e só tira o aviso quando os cursos chegam", async () => {
  state.query = new URLSearchParams("");
  let next: (courses: TeacherCourse[]) => void = () => {};
  let finish: () => void = () => {};
  const reload = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  state.subscribe.mockImplementation((onData: (courses: TeacherCourse[]) => void, onError: () => void) => {
    next = onData;
    onError();
    return Object.assign(() => {}, { reload });
  });
  render(<CourseMarketplace />);

  expect(screen.getByRole("alert")).toHaveTextContent("Courses could not load right now.");
  expect(screen.queryByText("Marketplace opening soon")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  // Travado enquanto lê; o aviso fica até a resposta.
  const busy = screen.getByRole("button", { name: "Trying again..." });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("alert")).toBeInTheDocument();

  await act(async () => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep focus", summary: "", category: "Performance", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    finish();
  });
  expect(await screen.findByRole("link", { name: "Deep focus" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  // O botão sumiu: o foco ficou na seção do catálogo, não no <body>.
  expect(document.activeElement).toHaveClass("marketplace-section");
});

// No celular, cabeçalho e filtros abertos davam uns 800px antes do primeiro
// curso. Os filtros ficam atrás de um botão (o CSS só os esconde abaixo de
// 640px) e o botão diz quantos estão valendo; cada filtro segue funcionando.
it("os filtros ficam atrás de um botão que abre e fecha e diz quantos estão valendo", () => {
  state.subscribe.mockImplementation(() => () => {});
  render(<CourseMarketplace />);

  const toggle = screen.getByRole("button", { name: /^Filters/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveAccessibleName("Filters Active filters: 2");
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(panel).not.toHaveClass("is-open");

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(panel).toHaveClass("is-open");

  fireEvent.click(within(panel).getByRole("button", { name: "All courses" }));
  expect(toggle).toHaveAccessibleName("Filters Active filters: 1");
  fireEvent.change(within(panel).getByPlaceholderText("Search skill, category, or outcome"), { target: { value: "" } });
  expect(toggle).toHaveAccessibleName("Filters");
});
