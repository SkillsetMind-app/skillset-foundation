import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * A RLS só entrega o texto, o link e o material da aula que já abriu
 * (migration 20260915020000), e nada no banco muda quando uma aula abre. A
 * sala tem de buscar de novo, mas só quando alguma aula abre de fato, sem
 * reinscrever os canais realtime e sem trocar o objeto de um anexo que não
 * mudou (o player de vídeo enviado reassinaria a URL e recomeçaria no meio).
 *
 * Aqui os módulos de dados são os de verdade, sobre um Supabase falso que
 * aplica a "RLS" (serverOpen) e conta cada select, cada subscribe de canal e
 * cada assinatura de URL.
 */

type Row = Record<string, unknown>;

function makeEnrollment() {
  return {
    id: "student-1__course-1",
    userId: "student-1",
    courseId: "course-1",
    courseSlug: "demo-course",
    courseTitle: "Demo course",
    courseCategory: "Leadership",
    courseImage: "",
    status: "active",
    source: "payment",
    progressPercent: 0,
    lastLessonId: null as string | null,
    createdAt: "2026-03-01T12:00:00.000Z",
  };
}

const db = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Row[]>,
    // Aulas que a RLS do banco já libera (o relógio do servidor).
    serverOpen: new Set<string>(),
    // Tabelas cujo próximo select volta com erro.
    failNext: new Set<string>(),
    // Com hold, as respostas ficam paradas até o teste soltar (recarga "no ar").
    hold: false,
    held: [] as Array<() => void>,
    selects: {} as Record<string, number>,
    subscribes: 0,
    signs: 0,
    realtime: new Map<string, () => void>(),
    searchParams: new URLSearchParams(),
    completed: null as null | ((ids: string[]) => void),
    // Matrícula: entregue na hora, ou segurada até o teste emitir.
    holdEnrollment: false,
    emitEnrollment: null as null | ((value: unknown) => void),
    enrollment: null as unknown,
    auth: {
      status: "authenticated",
      user: { uid: "student-1", email: "student@example.test", roles: ["student"] },
    },
  };
  const rowsFor = (table: string) =>
    (state.tables[table] ?? []).filter(
      (row) => row.lesson_id == null || state.serverOpen.has(String(row.lesson_id)),
    );
  // Qualquer cadeia .select().eq()... termina num await que devolve as linhas
  // visíveis naquele momento.
  const from = (table: string) => {
    state.selects[table] = (state.selects[table] ?? 0) + 1;
    const failed = state.failNext.delete(table);
    const builder: unknown = new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === "then"
            ? (resolve: (value: unknown) => void) => {
                // As linhas saem na hora da entrega, com a "RLS" de então.
                const deliver = () =>
                  resolve(
                    failed
                      ? { data: null, error: { message: "falha simulada" } }
                      : { data: rowsFor(table), error: null },
                  );
                if (state.hold) {
                  state.held.push(deliver);
                } else {
                  deliver();
                }
              }
            : () => builder,
      },
    );
    return builder;
  };
  const channel = () => {
    const created = {
      on: (_event: string, filter: { table: string }, callback: () => void) => {
        state.realtime.set(filter.table, callback);
        return created;
      },
      subscribe: () => {
        state.subscribes += 1;
        return created;
      },
    };
    return created;
  };
  const client = {
    from,
    channel,
    removeChannel: () => Promise.resolve("ok"),
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          state.signs += 1;
          return { data: { signedUrl: "https://files.example.test/aula-1.mp4" }, error: null };
        },
      }),
    },
  };
  return { state, client };
});

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => db.client,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => db.state.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => db.state.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: (_uid: string, _slug: string, onNext: (value: unknown) => void) => {
    db.state.emitEnrollment = onNext;
    if (!db.state.holdEnrollment) {
      onNext(db.state.enrollment);
    }
    return () => undefined;
  },
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: (_id: string, onNext: (ids: string[]) => void) => {
    db.state.completed = onNext;
    onNext([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: () => () => undefined,
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// Aula 1 (vídeo enviado, sem Bunny) aberta; aula 2 abre 24h depois da
// matrícula (time_drip_lesson, intervalo 1).
const timeDripCourse = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  dripStrategy: "time_drip_lesson",
  dripIntervalDays: 1,
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        { id: "l1", title: "Lesson one", type: "video", videoSource: "upload", duration: "5 min", isPreview: false },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false },
      ],
    },
  ],
} as unknown as Course;

const sequentialCourse = {
  ...timeDripCourse,
  dripStrategy: "sequential_progress",
} as unknown as Course;

function assetRow(id: string, lessonId: string, kind: string, contentType: string) {
  return {
    id,
    course_id: "course-1",
    owner_id: "teacher-1",
    kind,
    file_name: `${id}.bin`,
    content_type: contentType,
    size: 10,
    storage_path: `courses/course-1/assets/teacher-1/${id}/${id}.bin`,
    download_url: null,
    bunny_video_id: null,
    is_preview: false,
    lesson_id: lessonId,
    module_id: null,
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: null,
  };
}

function contentRow(lessonId: string, text: string) {
  return { lesson_id: lessonId, course_id: "course-1", content_text: text, external_url: null };
}

const second = 1000;
const minute = 60 * second;
const day = 24 * 60 * minute;

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let turn = 0; turn < 5; turn += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
  });
}

// Solta as respostas paradas pelo hold e deixa a sala assentar.
async function releaseHeld() {
  db.state.hold = false;
  await act(async () => {
    for (const deliver of db.state.held.splice(0)) {
      deliver();
    }
  });
  await flush();
}

async function mount(course: Course, lesson = "l1") {
  db.state.searchParams = new URLSearchParams(`lesson=${lesson}`);
  render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);
  await flush();
}

function counts() {
  return {
    assets: db.state.selects.course_assets ?? 0,
    content: db.state.selects.course_lesson_content ?? 0,
    subscribes: db.state.subscribes,
    signs: db.state.signs,
  };
}

describe("a sala busca de novo só quando uma aula abre", () => {
  beforeEach(() => {
    // Só o relógio e o setTimeout: o player com marca d'água arma setInterval
    // curtos, e avançar 24h com eles falsos roda dezenas de milhares de renders.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
    db.state.tables = {
      course_assets: [
        assetRow("video-l1", "l1", "lesson_video", "video/mp4"),
        assetRow("pdf-l2", "l2", "lesson_material", "application/pdf"),
      ],
      course_lesson_content: [contentRow("l1", "Texto da aula um"), contentRow("l2", "Texto da aula dois")],
    };
    db.state.serverOpen = new Set(["l1"]);
    db.state.failNext = new Set();
    db.state.hold = false;
    db.state.held = [];
    db.state.selects = {};
    db.state.subscribes = 0;
    db.state.signs = 0;
    db.state.realtime.clear();
    db.state.completed = null;
    db.state.holdEnrollment = false;
    db.state.emitEnrollment = null;
    db.state.enrollment = makeEnrollment();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("volta para a aba sem aula nova liberada: nada é buscado e o vídeo não é reassinado", async () => {
    await mount(timeDripCourse);
    expect(db.state.signs).toBe(1);
    const before = counts();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush(10 * second);

    expect(counts()).toEqual(before);
  });

  it("o prazo que libera uma aula dispara uma recarga só, sem reinscrever o canal", async () => {
    await mount(timeDripCourse);
    const before = counts();
    db.state.serverOpen.add("l2");

    // Folga de 5s depois do prazo.
    await flush(day + 4 * second);
    expect(counts()).toEqual(before);

    await flush(2 * second);
    expect(counts()).toEqual({
      assets: before.assets + 1,
      content: before.content + 1,
      subscribes: before.subscribes,
      // O vídeo da aula 1 voltou igual: o mesmo objeto, sem assinar de novo.
      signs: before.signs,
    });

    // A aula chegou: nenhuma tentativa extra.
    await flush(10 * minute);
    expect(counts().content).toBe(before.content + 1);
  });

  it("relógio do aparelho adiantado: tenta de novo em 30s e mostra o conteúdo", async () => {
    await mount(timeDripCourse, "l2");
    const before = counts();

    await flush(day + 6 * second);
    expect(counts().content).toBe(before.content + 1);
    expect(screen.queryByText("Texto da aula dois")).toBeNull();

    db.state.serverOpen.add("l2");
    await flush(30 * second);
    expect(screen.getByText("Texto da aula dois")).toBeTruthy();
    expect(counts().content).toBe(before.content + 2);

    await flush(5 * minute);
    expect(counts().content).toBe(before.content + 2);
  });

  it("perto do prazo, sem a aula no banco, para depois de 3 tentativas extras", async () => {
    await mount(timeDripCourse, "l2");
    const before = counts();

    await flush(day + 6 * second);
    await flush(10 * minute);

    expect(counts().content).toBe(before.content + 1 + 3);
    expect(counts().subscribes).toBe(before.subscribes);
  });

  it("o realtime continua entregando depois de uma recarga", async () => {
    await mount(timeDripCourse, "l2");
    const before = counts();
    db.state.serverOpen.add("l2");
    await flush(day + 6 * second);
    expect(screen.getByText("Texto da aula dois")).toBeTruthy();

    db.state.tables.course_lesson_content = [
      contentRow("l1", "Texto da aula um"),
      contentRow("l2", "Texto revisado da aula dois"),
    ];
    await act(async () => {
      db.state.realtime.get("course_lesson_content")?.();
    });
    await flush();

    expect(screen.getByText("Texto revisado da aula dois")).toBeTruthy();
    expect(counts().subscribes).toBe(before.subscribes);
  });

  it("o conjunto de concluídas mudando recarrega uma vez, sem reinscrever", async () => {
    await mount(sequentialCourse);
    const before = counts();

    db.state.serverOpen.add("l2");
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush();
    expect(counts()).toEqual({
      assets: before.assets + 1,
      content: before.content + 1,
      subscribes: before.subscribes,
      signs: before.signs,
    });

    // O mesmo conjunto de novo (outra lista, mesmo conteúdo): nada.
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush();
    expect(counts().content).toBe(before.content + 1);
  });

  it("concluir uma aula traz a matrícula de novo (objeto novo): sem reinscrever os canais nem reassinar o vídeo", async () => {
    await mount(sequentialCourse);
    const before = counts();

    // record_lesson_progress grava em enrollments, e a matrícula chega de novo
    // pelo realtime como outro objeto.
    db.state.serverOpen.add("l2");
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await act(async () => {
      db.state.emitEnrollment?.({ ...makeEnrollment(), progressPercent: 50, lastLessonId: "l1" });
    });
    await flush(minute);

    expect(counts()).toEqual({
      assets: before.assets + 1,
      content: before.content + 1,
      subscribes: before.subscribes,
      signs: before.signs,
    });
  });

  it("matrícula que chega depois da montagem: a aula 1 abre na hora, sem recarga extra", async () => {
    db.state.holdEnrollment = true;
    await mount(timeDripCourse);
    await flush(10 * minute);

    // Fluxo do checkout: a matrícula nasce agora, depois da montagem.
    db.state.enrollment = { ...makeEnrollment(), createdAt: new Date(Date.now()).toISOString() };
    await act(async () => {
      db.state.emitEnrollment?.(db.state.enrollment);
    });
    await flush();
    expect(db.state.signs).toBe(1);

    const afterArrival = counts();
    await flush(10 * second);
    expect(counts()).toEqual(afterArrival);
  });

  it("uma conclusão dentro da janela de 30s não cancela a nova tentativa da aula que falta", async () => {
    await mount(timeDripCourse, "l2");

    // Prazo: a recarga volta sem a aula 2 (relógio do aparelho adiantado).
    await flush(day + 6 * second);
    expect(screen.queryByText("Texto da aula dois")).toBeNull();

    // Outra mudança dentro da janela da nova tentativa.
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush(10 * second);

    db.state.serverOpen.add("l2");
    await flush(minute);
    expect(screen.getByText("Texto da aula dois")).toBeTruthy();
  });

  it("aula aberta sem conteúdo protegido (sequencial) gasta no máximo uma tentativa extra", async () => {
    db.state.tables = {
      course_assets: [assetRow("video-l1", "l1", "lesson_video", "video/mp4")],
      course_lesson_content: [contentRow("l1", "Texto da aula um")],
    };
    await mount(sequentialCourse);
    const before = counts();

    db.state.serverOpen.add("l2");
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush(5 * minute);

    expect(counts().content).toBe(before.content + 1 + 1);
  });

  it("recarga que falha mantém os anexos na tela, sem estado de erro", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await mount(timeDripCourse);
    const before = counts();

    db.state.serverOpen.add("l2");
    db.state.failNext.add("course_assets");
    await flush(day + 6 * second);

    expect(document.getElementById("member-lesson-player")).not.toBeNull();
    expect(counts().signs).toBe(before.signs);
  });

  // O aviso grande do player (h5): fechada, carregando, ou o vazio de verdade.
  function playerNotice() {
    return (
      document
        .getElementById("member-lesson-player")
        ?.querySelector(".member-video-empty h5")?.textContent ?? null
    );
  }

  it("a aula que abre pelo prazo mostra carregando enquanto a recarga está no ar", async () => {
    await mount(timeDripCourse, "l2");

    // Prazo + folga; a recarga sai e fica no ar.
    db.state.serverOpen.add("l2");
    db.state.hold = true;
    await flush(day + 6 * second);
    expect(playerNotice()).toBe("Loading lesson content...");

    await releaseHeld();
    expect(screen.getByText("Texto da aula dois")).toBeTruthy();
    expect(playerNotice()).toBe("Text-first lesson");
  });

  it("uma aula que já estava aberta não pisca carregando enquanto outra aula abre", async () => {
    const textFirstCourse = {
      ...timeDripCourse,
      modules: [
        {
          ...timeDripCourse.modules[0],
          lessons: [
            { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: false },
            timeDripCourse.modules[0].lessons[1],
          ],
        },
      ],
    } as unknown as Course;
    db.state.tables = {
      course_assets: [assetRow("pdf-l2", "l2", "lesson_material", "application/pdf")],
      course_lesson_content: [contentRow("l1", "Texto da aula um"), contentRow("l2", "Texto da aula dois")],
    };
    await mount(textFirstCourse, "l1");
    expect(playerNotice()).toBe("Text-first lesson");

    // A aula 2 abre e fica na fila (banco atrasado); a aula 1 não muda.
    await flush(day + 6 * second);
    expect(playerNotice()).toBe("Text-first lesson");
    await flush(minute);
    expect(playerNotice()).toBe("Text-first lesson");
  });

  it("a aula que volta vazia mostra o estado real logo depois da primeira recarga", async () => {
    await mount(timeDripCourse, "l2");

    db.state.hold = true;
    await flush(day + 6 * second);
    expect(playerNotice()).toBe("Loading lesson content...");

    // Banco ainda fechado: a recarga volta sem a aula. A tela mostra o real na
    // hora; as tentativas seguem por trás sem segurar o "carregando".
    await releaseHeld();
    expect(playerNotice()).toBe("Text-first lesson");
    await flush(10 * minute);
    expect(playerNotice()).toBe("Text-first lesson");
  });

  it("no sequencial, a próxima aula sem conteúdo protegido mostra o estado real logo depois da primeira recarga", async () => {
    // Aula 2 sem linha protegida: quiz, texto só no currículo ou embed.
    db.state.tables = {
      course_assets: [assetRow("video-l1", "l1", "lesson_video", "video/mp4")],
      course_lesson_content: [contentRow("l1", "Texto da aula um")],
    };
    await mount(sequentialCourse, "l2");

    db.state.serverOpen.add("l2");
    await act(async () => {
      db.state.completed?.(["l1"]);
    });
    await flush();

    expect(playerNotice()).toBe("Text-first lesson");
  });

  it("a aula que abre com o texto no próprio currículo mostra 'Text-first lesson', não carregando", async () => {
    const inlineTextCourse = {
      ...timeDripCourse,
      modules: [
        {
          ...timeDripCourse.modules[0],
          lessons: [
            timeDripCourse.modules[0].lessons[0],
            {
              id: "l2",
              title: "Lesson two",
              type: "text",
              duration: "7 min",
              isPreview: false,
              contentText: "Texto no currículo da aula dois",
            },
          ],
        },
      ],
    } as unknown as Course;
    db.state.tables = {
      course_assets: [assetRow("video-l1", "l1", "lesson_video", "video/mp4")],
      course_lesson_content: [contentRow("l1", "Texto da aula um")],
    };
    await mount(inlineTextCourse, "l2");

    db.state.serverOpen.add("l2");
    db.state.hold = true;
    await flush(day + 6 * second);
    expect(playerNotice()).toBe("Text-first lesson");
    expect(screen.getByText("Texto no currículo da aula dois")).toBeTruthy();

    await releaseHeld();
    expect(playerNotice()).toBe("Text-first lesson");
  });
});
