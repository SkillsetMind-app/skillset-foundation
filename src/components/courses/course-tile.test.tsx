import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourseTile, courseCardBadge } from "@/components/courses/course-tile";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { CourseCard } from "@/lib/data/catalog";

const language = vi.hoisted(() => ({ locale: "en" as "en" | "es" }));
vi.mock("@/components/i18n/i18n-provider", () => ({ useTranslation: () => ({ locale: language.locale, t: (key: string) => translate(getDictionary(language.locale), key) }) }));
beforeEach(() => { language.locale = "en"; });

afterEach(cleanup);

function renderTile(overrides: Partial<Parameters<typeof CourseTile>[0]> = {}) {
  return render(
    <CourseTile
      href="/courses/focus"
      title="Deep Focus Systems"
      image="/brand/logo-mark.png"
      summary="Build a repeatable focus practice."
      category="Performance"
      meta="8 lessons"
      priceLabel="$149.00"
      {...overrides}
    />,
  );
}

describe("CourseTile", () => {
  it("faz o cartao inteiro virar link, e nao so o botao", () => {
    const { container } = renderTile();

    const link = screen.getByRole("link", { name: "Deep Focus Systems" });
    // Link esticado: o ::after cobre o cartao, entao clicar em qualquer canto
    // navega. Antes so o botao "View course" levava a algum lugar.
    expect(link).toHaveClass("marketplace-card__link");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    // "View course" virou rotulo do rodape, nao um segundo destino.
    expect(
      screen.queryByRole("link", { name: /view course/i }),
    ).not.toBeInTheDocument();
  });

  it("mostra o preco uma vez so", () => {
    renderTile();

    expect(screen.getAllByText("$149.00")).toHaveLength(1);
  });

  it("mostra no maximo um selo", () => {
    const { container } = renderTile({ badge: "Free preview" });

    const badges = container.querySelectorAll(".marketplace-card__tag");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("Free preview");
  });

  it("sem selo quando nao ha o que dizer", () => {
    const { container } = renderTile({ badge: null });

    expect(container.querySelectorAll(".marketplace-card__tag")).toHaveLength(0);
  });

  it("salvar nao navega: o botao fica fora do link, nao dentro dele", () => {
    const onSave = vi.fn();
    const { container } = renderTile({
      overlay: (
        <button type="button" onClick={onSave} aria-label="Save to wishlist">
          save
        </button>
      ),
    });

    const save = screen.getByRole("button", { name: "Save to wishlist" });
    expect(save.closest("a")).toBeNull();

    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    // O clique no botao nao pode ter acionado o link do cartao.
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/courses/focus",
    );
  });

  it("mostra quem ensina e a nota", () => {
    renderTile({
      instructor: { name: "Ana Prado", photoURL: null },
      rating: { average: 4.8, count: 12 },
    });

    expect(screen.getByText("Ana Prado")).toBeInTheDocument();
    expect(screen.getByText("4.8")).toBeInTheDocument();
    expect(screen.getByText("(12)")).toBeInTheDocument();
  });

  it("nao inventa nota quando ninguem avaliou", () => {
    renderTile({ rating: { average: 0, count: 0 } });

    expect(screen.queryByText(/^\(\d+\)$/)).not.toBeInTheDocument();
  });
});

describe("courseCardBadge", () => {
  const base = { ratingCount: 3 } as CourseCard;

  it("prefere a amostra gratuita", () => {
    expect(
      courseCardBadge({ ...base, freePreviewHref: "/courses/x#free-preview" }),
    ).toBe("Free preview");
  });

  it("chama de novo o curso sem avaliacao", () => {
    expect(courseCardBadge({ ...base, ratingCount: 0 })).toBe("New");
  });

  it("nao usa Published como selo: e vocabulario interno", () => {
    expect(courseCardBadge(base)).toBeNull();
  });
});

describe("um cartao de curso, nao tres", () => {
  // As tres telas que listam curso desenhavam o cartao cada uma do seu jeito.
  // Este teste falha se alguma delas voltar a montar o proprio.
  it.each([
    ["home", "src/components/site/featured-courses.tsx"],
    ["catalogo", "src/components/courses/course-marketplace.tsx"],
    ["vitrine do professor", "src/components/instructors/instructor-profile-view.tsx"],
  ])("%s usa o CourseTile", (_surface, path) => {
    const source = readFileSync(path, "utf8");

    expect(source).toContain("course-tile");
    expect(source).toContain("<CourseTile");
    // Nenhuma delas monta o corpo do cartao por conta propria.
    expect(source).not.toContain("marketplace-card__title");
    expect(source).not.toContain("marketplace-card__body");
  });
});

it("updates derived card copy after a language switch while preserving authored content and URL", () => {
  const props = { href: "/courses/focus?offer=SPRING", title: "Deep Focus Systems", summary: "A lesson author's own summary", image: "/brand/logo-mark.png", courseData: { lessonCount: 2, priceAmountMinor: 14900, currency: "USD", freePreviewHref: "/courses/focus#free-preview" } };
  const { rerender } = render(<CourseTile {...props} />);
  expect(screen.getByText("2 lessons")).toBeInTheDocument();
  language.locale = "es";
  rerender(<CourseTile {...props} />);
  expect(screen.getByText("2 lecciones")).toBeInTheDocument();
  expect(screen.getByText("Vista previa gratuita")).toBeInTheDocument();
  expect(screen.getByText("Ver curso")).toBeInTheDocument();
  expect(screen.getByText("A lesson author's own summary")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: props.title })).toHaveAttribute("href", props.href);
});
