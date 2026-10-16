import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { CourseAsset } from "@/domain/course-asset";
import type { CourseEvent } from "@/domain/course-event";
import type { TeacherCourse, TeacherCourseProductFormat } from "@/domain/teacher-course";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// O construtor se adapta ao tipo gravado na criacao (courses.product_format):
// comunidade com aula opcional, evento com a sessao no lugar da aula, e-book
// so com o arquivo. Curso continua igual.

const mocks = vi.hoisted(() => ({
  course: null as TeacherCourse | null,
  assets: [] as CourseAsset[],
  sessions: [] as CourseEvent[],
  user: { uid: "teacher-1" },
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams("courseId=course-1&tab=content"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: (_id: string, onData: (course: TeacherCourse | null) => void) => {
    onData(mocks.course);
    return () => undefined;
  },
  publishTeacherCourse: vi.fn(() => Promise.resolve()),
  updateTeacherCourseBuilder: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: unknown) => void) => {
    onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
    return () => undefined;
  },
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/course-assets", () => ({
  CourseAssetUploadCancelled: class CourseAssetUploadCancelled extends Error {},
  deleteCourseAsset: vi.fn(),
  fetchCourseAssets: vi.fn(() => Promise.resolve(mocks.assets)),
  subscribeToCourseAssets: (_id: string, onAssets: (assets: CourseAsset[]) => void) => {
    onAssets(mocks.assets);
    return () => undefined;
  },
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
  uploadLessonVideoToBunny: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToTeacherCourseEvents: (_uid: string, onEvents: (events: CourseEvent[]) => void) => {
    onEvents(mocks.sessions);
    return () => undefined;
  },
}));

vi.mock("@/lib/bunny/config", () => ({ isBunnyConfigured: false }));
vi.mock("@/lib/data/lesson-video-selection", () => ({ activateUploadedLessonVideo: vi.fn() }));
vi.mock("@/components/teacher/course-asset-uploader", () => ({ CourseAssetUploader: () => null }));
vi.mock("@/components/courses/bunny-video-player", () => ({ BunnyVideoPlayer: () => null }));
vi.mock("@/components/shared/protected-asset-preview", () => ({ ProtectedAssetPreview: () => null }));
vi.mock("@/components/learn/trusted-embed-player", () => ({ TrustedEmbedPlayer: () => null }));

function product(productFormat: TeacherCourseProductFormat, lessons: boolean): TeacherCourse {
  return {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    productFormat,
    communityEnabled: productFormat === "community",
    modules: lessons
      ? [{ id: "m1", title: "Download", lessons: [{ id: "l1", title: "Workbook", type: "download", description: "" }] }]
      : [],
    lessonCount: lessons ? 1 : 0,
    priceAmountMinor: 0,
    currency: "USD",
    paymentType: "free",
  };
}

function session(): CourseEvent {
  return {
    id: "event-1",
    courseId: "course-1",
    courseSlug: "course-1",
    courseTitle: "Clinical performance foundations",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    description: "",
    type: "live_class",
    status: "scheduled",
    startsAt: "2026-11-20T22:30:00.000Z",
    externalUrl: "",
    recordingAssetId: null,
  };
}

function pastSession(): CourseEvent {
  return { ...session(), id: "event-0", startsAt: "2020-01-10T22:30:00.000Z" };
}

function material(): CourseAsset {
  return {
    id: "asset-1",
    courseId: "course-1",
    ownerId: "teacher-1",
    kind: "lesson_material",
    fileName: "workbook.pdf",
    contentType: "application/pdf",
    size: 1024,
    storagePath: "courses/course-1/workbook.pdf",
    isPreview: false,
    lessonId: "l1",
  };
}

function renderBuilder(tab: string) {
  mocks.searchParams.set("tab", tab);
  return render(
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>,
  );
}

// Itens obrigatorios da lista "o que falta para publicar".
async function requiredChecklist() {
  renderBuilder("review");
  const groups = await screen.findAllByText(/^(Content saved|Page prepared|Sale available)/);
  return groups.map((group) => group.closest("section") as HTMLElement);
}

beforeEach(() => {
  mocks.assets = [];
  mocks.sessions = [];
  // Nenhum preco em Outros precos: a etapa de preco mostra os cartoes.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.searchParams.delete("module");
  mocks.searchParams.delete("lesson");
});

describe("comunidade: aulas opcionais", () => {
  it("a aba de conteudo diz que aula e opcional e continua deixando criar modulo", async () => {
    mocks.course = product("community", false);
    renderBuilder("content");

    expect(await screen.findByText("Optional: add lessons or files.")).toBeInTheDocument();
    expect(screen.getByText("Add your first module")).toBeInTheDocument();
  });

  it("publicar nao cobra modulo nem aula, so a comunidade ligada", async () => {
    mocks.course = product("community", false);
    const [content] = await requiredChecklist();

    expect(within(content).queryByText("Module")).toBeNull();
    expect(within(content).queryByText("Lesson")).toBeNull();
    expect(within(content).getByText("Community turned on")).toBeInTheDocument();
  });
});

describe("evento ao vivo: a sessao e o conteudo", () => {
  it("sem sessao: diz que falta e leva a Agenda com o formulario aberto", async () => {
    mocks.course = product("live_event", false);
    renderBuilder("content");

    expect(await screen.findByText("No session scheduled yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule the session" })).toHaveAttribute(
      "href",
      "/teach/events?courseId=course-1&newEvent=1",
    );
    expect(screen.getByRole("heading", { name: "Live session" })).toBeInTheDocument();
    expect(screen.getByText("Replay (optional)")).toBeInTheDocument();
  });

  it("com sessao: mostra a data, avisa do link que falta e leva a Agenda para editar", async () => {
    mocks.course = product("live_event", false);
    mocks.sessions = [session()];
    renderBuilder("content");

    expect(await screen.findByText("Link not added yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit in the Agenda" })).toHaveAttribute(
      "href",
      "/teach/events?courseId=course-1",
    );
  });

  // A sessao que ja passou nao se vende: o servidor cobra uma sessao por vir.
  it("sessao que ja passou nao conta", async () => {
    mocks.course = product("live_event", false);
    mocks.sessions = [pastSession()];
    renderBuilder("content");

    expect(await screen.findByText("No session scheduled yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule the session" })).toBeInTheDocument();
  });

  it("publicar cobra a sessao, nao a aula", async () => {
    mocks.course = product("live_event", false);
    const [content] = await requiredChecklist();

    expect(within(content).getByText("Live session")).toBeInTheDocument();
    expect(within(content).queryByText("Lesson")).toBeNull();
  });
});

describe("e-book: so o arquivo", () => {
  it("a aba de conteudo mostra o envio de arquivo, sem modulo, aula nem video", async () => {
    mocks.course = product("ebook", true);
    renderBuilder("content");

    expect(await screen.findByRole("heading", { name: "File to download" })).toBeInTheDocument();
    expect(screen.queryByText("Add your first module")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add module/i })).toBeNull();
    expect(screen.queryByRole("navigation", { name: /Lesson setup/i })).toBeNull();
    expect(screen.queryByText("Workbook")).toBeNull();
    expect(screen.queryByText(/1 module/i)).toBeNull();
  });

  // O link "Open" do envio leva ?module&lesson; o e-book continua so com arquivos.
  it("com a aula na URL, continua so com o envio de arquivo", async () => {
    mocks.course = product("ebook", true);
    mocks.searchParams.set("module", "m1");
    mocks.searchParams.set("lesson", "l1");
    renderBuilder("content");

    expect(await screen.findByRole("heading", { name: "File to download" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /Lesson setup/i })).toBeNull();
    expect(screen.queryByText("Workbook")).toBeNull();
  });

  it("publicar cobra um arquivo e fica pronto quando ele chega", async () => {
    mocks.course = product("ebook", true);
    const [content] = await requiredChecklist();
    expect(within(content).getByText("File to download")).toBeInTheDocument();
    expect(within(content).queryByText("Lesson content")).toBeNull();
    cleanup();

    mocks.assets = [material()];
    const [ready] = await requiredChecklist();
    await waitFor(() => {
      expect(within(ready).getByText(/^Content saved/).closest("p")).toHaveTextContent(/2 of 2/);
    });
  });
});

describe("curso: igual a antes", () => {
  it("publicar cobra modulo e aula", async () => {
    mocks.course = product("course", false);
    const [content] = await requiredChecklist();

    expect(within(content).getByText("Module")).toBeInTheDocument();
    expect(within(content).getByText("Lesson")).toBeInTheDocument();
  });
});

// "Como as pessoas vao pagar?": uma pergunta so, com os cartoes do tipo.
describe("como as pessoas vao pagar", () => {
  function paid(
    productFormat: TeacherCourseProductFormat,
    paymentType: TeacherCourse["paymentType"],
    priceAmountMinor: number,
    extra: Partial<TeacherCourse> = {},
  ): TeacherCourse {
    return { ...product(productFormat, false), paymentType, priceAmountMinor, ...extra };
  }

  function cardTitles() {
    const group = screen.getByRole("group", { name: /How will people pay\?/ });
    // So os cartoes: o botao de ajuda da pergunta mora na legenda.
    return within(group)
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-pressed"))
      .map((button) => button.querySelector(".display-title")?.textContent);
  }

  function pressed() {
    const group = screen.getByRole("group", { name: /How will people pay\?/ });
    return within(group)
      .getAllByRole("button", { pressed: true })
      .map((button) => button.querySelector(".display-title")?.textContent);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["course", "one_time", ["Free", "One payment", "Monthly membership"], "One payment"],
    ["community", "subscription_monthly", ["Free", "Monthly membership"], "Monthly membership"],
    ["live_event", "one_time", ["Free", "Ticket"], "Ticket"],
    ["ebook", "one_time", ["Free", "One payment"], "One payment"],
  ] as const)("%s: os cartoes do tipo e o que ja vem marcado", async (format, paymentType, titles, selected) => {
    mocks.course = paid(format, paymentType, 0);
    renderBuilder("pricing");
    await screen.findByRole("group", { name: /How will people pay\?/ });

    expect(cardTitles()).toEqual(titles);
    expect(pressed()).toEqual([selected]);
    // O exemplo em numeros, na moeda do produto.
    if (format === "live_event") {
      expect(screen.getByRole("button", { name: /Ticket/ })).toHaveTextContent("Ex.: $300.");
    }
  });

  it("os campos so aparecem depois de escolher: gratis nao tem nenhum", async () => {
    mocks.course = paid("live_event", "free", 0);
    renderBuilder("pricing");
    await screen.findByRole("group", { name: /How will people pay\?/ });

    expect(screen.queryByRole("textbox", { name: /Price/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Currency" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Ticket/ }));
    expect(screen.getByRole("textbox", { name: "Price" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Currency" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Also offer a yearly plan" })).toBeNull();
  });

  it("mensalidade: o anual so abre quando marcado, com a economia calculada", async () => {
    mocks.course = paid("course", "one_time", 14900);
    renderBuilder("pricing");
    await screen.findByRole("group", { name: /How will people pay\?/ });

    expect(screen.queryByRole("checkbox", { name: "Also offer a yearly plan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Monthly membership/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Price per month" }), { target: { value: "29" } });

    const yearly = screen.getByRole("checkbox", { name: "Also offer a yearly plan" });
    expect(screen.queryByRole("textbox", { name: "Price per year" })).toBeNull();
    fireEvent.click(yearly);
    fireEvent.change(screen.getByRole("textbox", { name: "Price per year" }), { target: { value: "290" } });
    expect(screen.getByText("They save $58 compared to 12 monthly payments.")).toBeInTheDocument();
    // O Manage le o curso salvo: o link so aparece com o mensal gravado.
    expect(screen.queryByRole("link", { name: "Add the yearly plan" })).toBeNull();
    expect(await screen.findByRole("link", { name: "Add the yearly plan" }, { timeout: 4000 })).toHaveAttribute(
      "href",
      "/teach/courses/course-1/manage?section=pricing&addPrice=yearly&amount=29000",
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Price per year" }), { target: { value: "348" } });
    expect(screen.getByText("This costs the same as 12 monthly payments, or more.")).toBeInTheDocument();
  });

  // Cada forma de pagar ja gravada cai num cartao e a tela nao grava nada
  // por conta propria.
  it.each([
    ["course", "free", 0, {}, "Free", null, null],
    ["course", "one_time", 14900, { installmentsEnabled: true, installmentsMax: 6 }, "One payment", "Price", "149"],
    ["course", "subscription_monthly", 2900, {}, "Monthly membership", "Price per month", "29"],
    ["course", "subscription_yearly", 29000, {}, "Monthly membership", "Price per year", "290"],
    ["community", "subscription_yearly", 29000, {}, "Monthly membership", "Price per year", "290"],
    ["live_event", "one_time", 4900, {}, "Ticket", "Price", "49"],
    ["ebook", "one_time", 1900, {}, "One payment", "Price", "19"],
  ] as const)("produto existente %s/%s: cartao certo, preco igual e nada salvo", async (format, paymentType, price, extra, selected, field, value) => {
    vi.useFakeTimers();
    mocks.course = paid(format, paymentType, price, extra);
    renderBuilder("pricing");
    await act(async () => {});

    expect(pressed()).toEqual([selected]);
    if (field) {
      expect(screen.getByRole("textbox", { name: field })).toHaveValue(value);
    }
    if (paymentType === "subscription_yearly") {
      expect(screen.getByText("This product charges once a year until they cancel.")).toBeInTheDocument();
    }
    await act(async () => vi.advanceTimersByTime(5000));
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  // Produto no ar que cobra por ano: "Charge every month instead" limpa o
  // valor. Gravar assim deixava o preco nulo e a entrada gratis.
  it("produto publicado anual: trocar para mensal nao salva sem valor", async () => {
    vi.useFakeTimers();
    mocks.course = paid("course", "subscription_yearly", 29000, { status: "published" });
    renderBuilder("pricing");
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Charge every month instead" }));
    expect(screen.getByRole("textbox", { name: "Price per month" })).toHaveValue("");
    await act(async () => vi.advanceTimersByTime(5000));
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(screen.getByText("Not saving — fix the price")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Price per month" }), { target: { value: "29" } });
    await act(async () => vi.advanceTimersByTime(5000));
    expect(updateTeacherCourseBuilder).toHaveBeenCalledWith(
      "course-1",
      expect.objectContaining({ paymentType: "subscription_monthly", priceAmountMinor: 2900 }),
    );
  });

  // Sem forma gravada e sem valor, o checkout e o banco leem gratis.
  it("produto antigo sem forma e sem valor: aparece gratis e nada salvo", async () => {
    vi.useFakeTimers();
    mocks.course = paid("community", undefined, undefined as unknown as number, { status: "published" });
    renderBuilder("pricing");
    await act(async () => {});

    expect(pressed()).toEqual(["Free"]);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  // Com preco principal em Outros precos, o checkout cobra ele. Os cartoes
  // daqui mudariam so o construtor: a etapa diz o que a pagina cobra e leva
  // para la, e nao deixa virar Gratis com a cobranca de pe.
  describe("com preco principal em Outros precos", () => {
    function stubOffers(offers: unknown[]) {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers }) })));
    }
    const main = {
      id: "o1", name: "Main", isDefault: true, active: true,
      prices: [{ id: "p1", amountMinor: 9700, currency: "USD", paymentType: "one_time", active: true }],
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it.each([
      ["o mesmo modelo", "one_time", 9700],
      ["um construtor que diz gratis", "free", 0],
      ["um construtor que diz mensal", "subscription_monthly", 2900],
    ] as const)("com %s: mostra o que a pagina cobra, sem cartoes nem campos", async (_label, paymentType, price) => {
      stubOffers([main]);
      mocks.course = paid("course", paymentType, price, { status: "published" });
      renderBuilder("pricing");

      expect(await screen.findByText(/^Your page charges \$97 \(One payment\)\./)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Change it in Other prices." })).toHaveAttribute(
        "href",
        "/teach/courses/course-1/manage?section=pricing",
      );
      expect(screen.queryByRole("group", { name: /How will people pay\?/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Free/ })).toBeNull();
      expect(screen.queryByRole("textbox", { name: /Price/ })).toBeNull();
    });

    it("oferta inativa nao conta: os cartoes voltam", async () => {
      stubOffers([{ ...main, active: false }]);
      mocks.course = paid("course", "one_time", 9700);
      renderBuilder("pricing");

      expect(await screen.findByRole("group", { name: /How will people pay\?/ })).toBeInTheDocument();
      expect(screen.queryByText(/^Your page charges/)).toBeNull();
    });

    // Sem a lista, o preco principal e desconhecido: os cartoes mudariam so o
    // construtor. A rota devolve 200 com warning quando a leitura falha.
    it.each([
      ["a leitura falha", { ok: false, json: async () => ({}) }],
      ["a rota avisa que nao leu", { ok: true, json: async () => ({ offers: [], warning: "Offers are unavailable." }) }],
    ])("quando %s: sem cartoes, pede para recarregar", async (_label, response) => {
      vi.stubGlobal("fetch", vi.fn(async () => response));
      mocks.course = paid("course", "one_time", 9700, { status: "published" });
      renderBuilder("pricing");

      expect(await screen.findByText("Couldn't load your prices. Reload the page.")).toHaveAttribute("role", "alert");
      expect(screen.queryByRole("group", { name: /How will people pay\?/ })).toBeNull();
      expect(screen.queryByRole("textbox", { name: /Price/ })).toBeNull();
      expect(screen.queryByText("$97")).toBeNull();
    });

    // Aba aberta antes do preco principal: outra aba cria o preco, e ao voltar
    // para esta a etapa le de novo e mostra o que a pagina cobra.
    it("ao voltar para a aba, le de novo: os cartoes saem", async () => {
      mocks.course = paid("course", "subscription_monthly", 2900);
      renderBuilder("pricing");
      await screen.findByRole("group", { name: /How will people pay\?/ });
      expect(screen.getByText("$29 / month")).toBeInTheDocument();

      stubOffers([main]);
      fireEvent.focus(window);

      expect(await screen.findByText(/^Your page charges \$97 \(One payment\)\./)).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: /How will people pay\?/ })).toBeNull();
      // O resumo ao lado tambem diz o que a pagina cobra.
      expect(screen.queryByText("$29 / month")).toBeNull();
      expect(screen.getByText("$97")).toBeInTheDocument();
    });
  });

  // Produto criado antes da regra: a tela mostra o que ele e e avisa.
  it("comunidade antiga por pagamento unico: o cartao aparece, com o aviso", async () => {
    mocks.course = paid("community", "one_time", 9900);
    renderBuilder("pricing");
    await screen.findByRole("group", { name: /How will people pay\?/ });

    expect(cardTitles()).toEqual(["Free", "One payment", "Monthly membership"]);
    expect(pressed()).toEqual(["One payment"]);
    expect(screen.getByText("This option does not fit this type of product. Pick another one to publish.")).toBeInTheDocument();
  });
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
