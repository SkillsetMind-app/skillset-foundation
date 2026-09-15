import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";
import { subscribeToCourseAssets } from "@/lib/data/course-assets";

/**
 * A aula selecionada nao estava no endereco: recarregar a pagina ou voltar no
 * navegador abria a "primeira aula nao concluida", nao a que a pessoa estava
 * vendo; um link compartilhado nunca abria a mesma aula. E a troca de aula
 * podia acontecer fora da tela (o aluno rolava ate a discussao, o video
 * acabava, a proxima entrava la em cima).
 *
 * Contrato: ?lesson=<id> abre aquela aula; toda selecao grava o endereco e
 * rola ate o player; mudar o endereco por fora (voltar/avancar) muda a aula.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "teacher@example.com", roles: ["teacher"] },
  }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn(() => vi.fn()),
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: vi.fn((_courseId, onNext) => {
    onNext(new Map());
    return vi.fn();
  }),
  resolveLessonContent: vi.fn(() => ({})),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn(() => vi.fn()),
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: true, contentText: "One" },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false, contentText: "Two" },
      ],
    },
  ],
} as unknown as Course;

// O titulo da aula aberta e o h4 do cabecalho do painel da aula, dentro do
// player (a secao tem outros h4: o cartao "continuar", a lista de aulas).
function playerHeading() {
  return document
    .getElementById("member-lesson-player")
    ?.querySelector(".member-lesson-panel__head h4")?.textContent;
}

describe("a aula atual vive no endereco", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    mocks.replace.mockReset();
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
    // jsdom sem requestAnimationFrame em alguns ambientes: roda na hora.
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("abre a aula do ?lesson= em vez da primeira", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(playerHeading()).toBe("Lesson two");
  });

  it("ao escolher uma aula, grava o endereco e rola ate o player", () => {
    mocks.searchParams = new URLSearchParams();
    render(<EnrolledCourseWorkspace course={course} previewMode />);
    expect(playerHeading()).toBe("Lesson one");

    fireEvent.click(screen.getByRole("button", { name: /Lesson two/ }));

    expect(playerHeading()).toBe("Lesson two");
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.stringMatching(/\/learn\/courses\/demo-course\?.*lesson=l2/),
      { scroll: false },
    );
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("voltar no navegador (endereco muda por fora) muda a aula", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    const { rerender } = render(
      <EnrolledCourseWorkspace course={course} previewMode />,
    );
    expect(playerHeading()).toBe("Lesson two");

    mocks.searchParams = new URLSearchParams("lesson=l1");
    rerender(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(playerHeading()).toBe("Lesson one");
  });
});

// A duracao nao se digita mais (decisao de 14/09): a maioria das aulas chega
// com o fallback "Self-paced" de published-courses. O relogio so aparece com
// duracao de verdade.
describe("relogio da aula so com duracao", () => {
  function lessonClock() {
    return document
      .getElementById("member-lesson-player")
      ?.querySelector(".member-lesson-panel__head .member-meta-chip") ?? null;
  }

  beforeEach(() => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
  });

  it("aula sem duracao nao mostra o relogio", () => {
    const [aula] = course.modules[0].lessons;
    const semDuracao = {
      ...course,
      modules: [{ ...course.modules[0], lessons: [{ ...aula, duration: "Self-paced" }] }],
    } as Course;
    render(<EnrolledCourseWorkspace course={semDuracao} previewMode />);

    expect(playerHeading()).toBe("Lesson one");
    expect(lessonClock()).toBeNull();
  });

  it("aula com duracao mostra o relogio", () => {
    render(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(lessonClock()).toHaveTextContent("5 min");
  });
});

// Aula nova nasce "video" e o tipo nao se troca mais (decisao de 14/09). Sem
// video, o aviso do player sai do conteudo: aula de leitura nao pode dizer
// "Media not attached yet".
// Decisao de 14/09: o texto da aula e simples, e os links viram clicaveis na
// area de membros sem HTML cru. A quebra de linha do professor continua.
describe("texto da aula com links", () => {
  it("vira link clicavel e mantem a quebra de linha", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    const comLink = {
      ...course,
      modules: [
        {
          ...course.modules[0],
          lessons: [
            { id: "l1", title: "Leitura", type: "video", duration: "Self-paced", isPreview: true, contentText: "linha 1\nveja https://a.com/x.", description: "" },
          ],
        },
      ],
    } as unknown as Course;
    render(<EnrolledCourseWorkspace course={comLink} previewMode />);

    const body = document.getElementById("member-lesson-content") as HTMLElement;
    const link = body.querySelector('a[href="https://a.com/x"]');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent("https://a.com/x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    expect(body.textContent).toContain("linha 1\nveja https://a.com/x.");
  });
});

describe("aviso do player sem video segue o conteudo, nao o tipo", () => {
  function playerNotice() {
    return document
      .getElementById("member-lesson-player")
      ?.querySelector(".member-video-empty h5")?.textContent;
  }

  const semVideo = {
    ...course,
    modules: [
      {
        ...course.modules[0],
        lessons: [
          { id: "l1", title: "Leitura", type: "video", duration: "Self-paced", isPreview: true, contentText: "leia isto", description: "" },
          { id: "l2", title: "Vazia", type: "video", duration: "Self-paced", isPreview: false, contentText: null, description: "" },
          { id: "l3", title: "Video pendente", type: "video", duration: "Self-paced", isPreview: false, contentText: null, description: "Resumo curto" },
        ],
      },
    ],
  } as unknown as Course;

  it("aula tipo video so com texto mostra o aviso de leitura", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    render(<EnrolledCourseWorkspace course={semVideo} previewMode />);

    expect(playerHeading()).toBe("Leitura");
    expect(playerNotice()).toBe("Text-first lesson");
  });

  it("aula sem video e sem texto continua com o aviso de midia", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={semVideo} previewMode />);

    expect(playerHeading()).toBe("Vazia");
    expect(playerNotice()).toBe("Media not attached yet");
  });

  // Quase toda aula de video tem uma linha de resumo: o resumo nao pode
  // transformar "video ainda nao enviado" em "aula de leitura".
  it("aula de video com resumo e sem midia continua com o aviso de midia", () => {
    mocks.searchParams = new URLSearchParams("lesson=l3");
    render(<EnrolledCourseWorkspace course={semVideo} previewMode />);

    expect(playerHeading()).toBe("Video pendente");
    expect(playerNotice()).toBe("Media not attached yet");
  });

  // Enquanto os anexos da aula nao chegam, o aviso e de carregamento: antes a
  // aula de video piscava "Media not attached yet" ate o player aparecer.
  it("com os anexos ainda carregando mostra carregando, nao midia faltando", () => {
    mocks.searchParams = new URLSearchParams("lesson=l3");
    // O mock padrao nunca responde: a assinatura dos anexos fica pendente.
    render(<EnrolledCourseWorkspace course={semVideo} previewMode enableFirestoreAssets />);

    expect(playerNotice()).toBe("Loading lesson content...");
  });

  it("depois que os anexos chegam vazios mostra midia faltando", () => {
    mocks.searchParams = new URLSearchParams("lesson=l3");
    vi.mocked(subscribeToCourseAssets).mockImplementation((_courseId, onAssets) => {
      onAssets([]);
      return vi.fn();
    });
    try {
      render(<EnrolledCourseWorkspace course={semVideo} previewMode enableFirestoreAssets />);

      expect(playerNotice()).toBe("Media not attached yet");
    } finally {
      vi.mocked(subscribeToCourseAssets).mockImplementation(() => vi.fn());
    }
  });
});
