import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePlaylist } from "@/components/learn/course-playlist";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { LessonUnlockState } from "@/domain/drip-policy";
import type { CourseModule } from "@/domain/learning";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

// A lista de aulas existia tres vezes na sala e nenhuma ficava visivel com o
// video tocando. Agora e UMA playlist ao lado do video: modulos em acordeao,
// aula atual em destaque, check e cadeado por aula, busca no topo.

const modules = [
  {
    id: "m1",
    title: "Basics",
    lessons: [
      { id: "l1", title: "Welcome", type: "video", duration: "3 min", isPreview: true },
      { id: "l2", title: "Setup", type: "video", duration: "5 min", isPreview: false },
    ],
  },
  {
    id: "m2",
    title: "Advanced",
    lessons: [
      { id: "l3", title: "Deep dive", type: "video", duration: "9 min", isPreview: false },
    ],
  },
] as unknown as CourseModule[];

const unlockStateById = new Map<string, LessonUnlockState>([
  ["l3", { unlocked: false, unlocksAt: null, reason: "drip" } as unknown as LessonUnlockState],
]);

function renderPlaylist(overrides: Partial<Parameters<typeof CoursePlaylist>[0]> = {}) {
  return render(
    <CoursePlaylist
      modules={modules}
      selectedLessonId="l2"
      completedLessonIds={["l1"]}
      unlockStateById={unlockStateById}
      onSelect={() => {}}
      {...overrides}
    />,
  );
}

describe("CoursePlaylist", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("keeps the search, focus and selected lesson while localizing literal results", () => {
    const title = "Practice $$50 $&";
    const localizedModules = [{ ...modules[0], lessons: [{ ...modules[0].lessons[0], title }] }];
    const onSelect = vi.fn();
    const onUncomplete = vi.fn();
    render(<I18nProvider initialLocale="en">
      <ChangeLanguage />
      <CoursePlaylist modules={localizedModules} selectedLessonId="l1" completedLessonIds={["l1"]}
        unlockStateById={unlockStateById} onSelect={onSelect} onUncomplete={onUncomplete} />
    </I18nProvider>);
    const search = screen.getByRole("searchbox", { name: "Search lessons" });
    fireEvent.change(search, { target: { value: "$$50 $&" } });
    search.focus();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("navigation", { name: "Lecciones" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Buscar lecciones" })).toBe(search);
    expect(search).toHaveValue("$$50 $&");
    expect(search).toHaveFocus();
    expect(screen.getByText('1 lección coincide con "$$50 $&"')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Marcar "${title}" como incompleta` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Practice/ })).toHaveAttribute("aria-current", "true");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onUncomplete).not.toHaveBeenCalled();
  });

  it("keeps collapsed modules and locked navigation when the locale changes", () => {
    const onSelect = vi.fn();
    render(<I18nProvider initialLocale="en"><ChangeLanguage />
      <CoursePlaylist modules={modules} selectedLessonId="l2" completedLessonIds={["l1"]}
        unlockStateById={unlockStateById} onSelect={onSelect} />
    </I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Basics/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("button", { name: /Módulo 1 Basics/ })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    const locked = screen.getByRole("button", { name: /Deep dive/ });
    expect(locked).toHaveTextContent("Bloqueada");
    fireEvent.click(locked);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("l3");
  });

  it("shows a decorative thumbnail without changing locked lesson navigation", () => {
    const onSelect = vi.fn();
    const { container } = renderPlaylist({ onSelect, thumbnailUrlByLessonId: new Map([["l3", "/lesson-three.png"]]) });
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(container.querySelector('img[src="/lesson-three.png"]')).toHaveAttribute("alt", "");
    const lesson = screen.getByRole("button", { name: /Deep dive/ });
    expect(lesson).toHaveTextContent("Locked");
    fireEvent.click(lesson);
    expect(onSelect).toHaveBeenCalledWith("l3");
  });

  it("destaca a aula atual, abre so o modulo dela e fecha os outros", () => {
    renderPlaylist();

    expect(screen.getByRole("button", { name: /Setup/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Welcome/ })).not.toHaveAttribute("aria-current");

    // Modulo 2 comeca fechado: a aula dele nao esta na tela.
    const advanced = screen.getByRole("button", { name: /Advanced/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Deep dive")).not.toBeInTheDocument();

    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "true");
    // Aula travada pelo gotejamento: cadeado + "Locked" na linha.
    expect(screen.getByRole("button", { name: /Deep dive/ })).toHaveTextContent(/Locked/);
  });

  it("escolher uma aula chama onSelect com o id dela", () => {
    const onSelect = vi.fn();
    renderPlaylist({ onSelect });

    fireEvent.click(screen.getByRole("button", { name: /Welcome/ }));

    expect(onSelect).toHaveBeenCalledWith("l1");
  });

  it("na lista so o check da aula concluida e clicavel — para desfazer; nao ha 'Mark complete'", () => {
    const onUncomplete = vi.fn();
    renderPlaylist({ onUncomplete });

    fireEvent.click(screen.getByRole("button", { name: 'Mark "Welcome" incomplete' }));
    expect(onUncomplete).toHaveBeenCalledWith("l1");

    expect(
      screen.queryByRole("button", { name: /Mark "Setup" incomplete/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mark complete/ })).not.toBeInTheDocument();
  });

  it("sem onUncomplete (preview do professor) o check e so um icone", () => {
    renderPlaylist({ onUncomplete: undefined });

    expect(
      screen.queryByRole("button", { name: /Mark "Welcome" incomplete/ }),
    ).not.toBeInTheDocument();
  });

  it("a busca filtra, abre os modulos com resultado e NAO renumera", () => {
    const { container } = renderPlaylist();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search lessons" }), {
      target: { value: "deep" },
    });

    expect(screen.getByText(/1 lesson match/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deep dive/ })).toBeInTheDocument();
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search lessons" }), {
      target: { value: "setup" },
    });
    // "Setup" e a 2a aula do curso — continua "2" mesmo sendo a unica na tela.
    // (Aula atual mostra o icone de play; forcamos outra selecao no proximo teste.)
    expect(container.querySelectorAll(".member-playlist__lesson")).toHaveLength(1);
  });

  it("trocar de aula rola a lista ate a aula atual — a pessoa nao perde o lugar", () => {
    // A aula atual era destacada, mas a lista ficava onde estava: o destaque
    // caia fora da area visivel e a pessoa tinha que cacar onde parou.
    const scrolled: Array<{ element: Element; options: unknown }> = [];
    Element.prototype.scrollIntoView = function scrollIntoView(
      this: Element,
      options?: unknown,
    ) {
      scrolled.push({ element: this, options });
    } as Element["scrollIntoView"];

    const { rerender } = renderPlaylist({ selectedLessonId: "l1" });
    scrolled.length = 0;

    rerender(
      <CoursePlaylist
        modules={modules}
        selectedLessonId="l2"
        completedLessonIds={["l1"]}
        unlockStateById={unlockStateById}
        onSelect={() => {}}
      />,
    );

    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].element).toHaveClass("is-current");
    expect(scrolled[0].element).toHaveTextContent("Setup");
    // "nearest": rola o minimo, e nao mexe se a linha ja estiver a vista.
    expect(scrolled[0].options).toMatchObject({ block: "nearest" });
  });

  it("a numeracao e do curso inteiro (a 2a aula e '2' mesmo filtrada)", () => {
    const { container } = renderPlaylist({ selectedLessonId: "l1", completedLessonIds: [] });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search lessons" }), {
      target: { value: "setup" },
    });

    expect(container.querySelector(".member-playlist__status")?.textContent).toBe("2");
  });
});
