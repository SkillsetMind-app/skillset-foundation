import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { clickConfirm, stubDialogs } from "@/components/teacher/confirm-test-helpers";
import { getCourseReadiness, getLessonIdsWithMedia } from "@/domain/course-readiness";
import type { CourseAsset } from "@/domain/course-asset";
import type { CourseEvent } from "@/domain/course-event";
import type { TeacherCourse } from "@/domain/teacher-course";
import { publishTeacherCourse, subscribeToTeacherCourse, updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";
import { fetchCourseAssets, subscribeToCourseAssets, uploadCourseAsset } from "@/lib/data/course-assets";
import { track } from "@/lib/posthog/events";

const mocks = vi.hoisted(() => {
  // Fuse: a render loop does not hit the vitest timeout, it eats memory
  // until the process dies. We count the subscriptions and blow up early.
  const subscriptionCounts = new Map<string, number>();
  function fused<A extends unknown[]>(name: string, impl: (...args: A) => () => void) {
    return (...args: A) => {
      const calls = (subscriptionCounts.get(name) ?? 0) + 1;
      subscriptionCounts.set(name, calls);
      if (calls > 20) {
        throw new Error(`${name} subscribed ${calls} times: render loop`);
      }
      return impl(...args);
    };
  }

  // Same course for both screens: title, summary, category and one module
  // ready; no lesson and no price. One-time sale without installments.
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    fused,
    resetSubscriptionCounts: () => subscriptionCounts.clear(),
    getSubscriptionCounts: () => new Map(subscriptionCounts),
    course,
    // The SAME object on every render: a new user per render resubscribes
    // the effects and loops.
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("courseId=course-1"),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: vi.fn(mocks.fused(
    "subscribeToTeacherCourse",
    (_id: string, onData: (course: TeacherCourse) => void) => {
      onData(mocks.course);
      return () => undefined;
    },
  )),
  subscribeToTeacherCourses: mocks.fused(
    "subscribeToTeacherCourses",
    (_uid: string, onData: (courses: TeacherCourse[]) => void) => {
      onData([mocks.course]);
      return () => undefined;
    },
  ),
  publishTeacherCourse: vi.fn(),
  updateTeacherCourseBuilder: vi.fn(),
  setOwnCourseFeatured: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: mocks.fused(
    "subscribeToUserProfile",
    (_uid: string, onData: (profile: unknown) => void) => {
      const emit = () => onData({ creatorVerificationStatus: "none", currentPlanId: "free", ...profileExtra });
      profileGate.onData = onData;
      if (profileGate.hold) {
        profileGate.release = emit;
      } else {
        emit();
      }
      return () => undefined;
    },
  ),
}));
// Country of the teacher's Stripe account: only installments (Mexico) read it.
const profileExtra = vi.hoisted((): {
  currentPlanId?: string;
  stripeConnectCountry?: string;
  stripeConnectChargesEnabled?: boolean;
  stripeConnectPayoutsEnabled?: boolean;
} => ({}));
// hold: the profile (payouts, verification) only arrives when the test calls release.
const profileGate = vi.hoisted(() => ({
  hold: false,
  release: null as null | (() => void),
  onData: null as null | ((profile: unknown) => void),
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
  fetchCreatorActivationBlocked: () => Promise.resolve(activation.blocked),
}));
const activation = vi.hoisted(() => ({ blocked: false }));
const plan = vi.hoisted(() => ({
  required: false,
  hold: false,
  release: null as null | (() => void),
}));
vi.mock("@/lib/data/creator-plan", () => ({
  fetchCreatorPlanRequired: async () => {
    if (plan.hold) await new Promise<void>((resolve) => { plan.release = resolve; });
    return plan.required;
  },
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: vi.fn(() => Promise.resolve([])),
  subscribeToCourseAssets: vi.fn(() => () => undefined),
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

// The live event sessions (builder and Manage read the same list).
// hold: the list only arrives when the test calls `held` (one network round trip).
const sessions = vi.hoisted(() => ({
  list: [] as CourseEvent[],
  hold: false,
  held: null as null | ((events: CourseEvent[]) => void),
}));
vi.mock("@/lib/data/course-events", () => ({
  subscribeToTeacherCourseEvents: (_uid: string, onEvents: (events: CourseEvent[]) => void) => {
    if (sessions.hold) {
      sessions.held = onEvents;
    } else {
      onEvents(sessions.list);
    }
    return () => undefined;
  },
}));

// Cover upload depends on browser APIs that jsdom does not have and it is not
// part of the readiness count.
vi.mock("@/components/teacher/course-asset-uploader", () => ({
  // Only the "deleted a file" notice: the re-read error shows below it.
  CourseAssetUploader: ({ onAssetDeleted }: { onAssetDeleted?: () => void }) => (
    <button type="button" onClick={onAssetDeleted}>Fake asset deleted</button>
  ),
}));

// The product panel (numbers, activity, upkeep) reads orders, enrollments,
// coupons, reviews and questions. None of that changes the percentage this
// file measures, and it has its own tests in course-overview-panel.test.tsx. The
// marker exists for the ORDER test: where the panel falls relative to the
// checklist and the hub's decision, not the panel's content.
vi.mock("@/components/teacher/course-overview-panel", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/teacher/course-overview-panel")>(),
  CourseOverviewPanel: () => <div data-testid="course-overview-panel" />,
}));

function SwitchLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Switch language</button>;
}

function renderMembers() {
  mocks.searchParams.set("tab", "members");
  return render(
    <I18nProvider initialLocale="en">
      <SwitchLanguage />
      <CourseBuilderStudio />
    </I18nProvider>,
  );
}

function renderBuilder(tab = "details") {
  mocks.searchParams.set("tab", tab);
  return render(
    <I18nProvider initialLocale="en">
      <SwitchLanguage />
      <CourseBuilderStudio />
    </I18nProvider>,
  );
}

// The payment links bring the learner back to this course's Publish tab.
const PAYOUTS_WITH_RETURN = `/account/payments?returnTo=${encodeURIComponent("/teach/builder?courseId=course-1&tab=review")}#stripe-connect`;

async function publishProduct() {
  const button = await screen.findByRole("button", { name: "Publish product" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

// No price in Other prices: the builder's price step shows the
// cards. Without the list, it shows no price at all.
let restoreDialogs = () => {};
beforeEach(() => {
  plan.required = false;
  plan.hold = false;
  plan.release = null;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
  restoreDialogs = stubDialogs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreDialogs();
});

// For the same course the teacher saw 71% on the builder chip, 40% on the
// bar right below the chip and 50% in Manage. Each screen had its own rule.
// Now all three read the same function and show the same number.
describe("what is missing to publish: a single number on every screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("section");
    mocks.searchParams.delete("tab");
    mocks.searchParams.delete("module");
    mocks.searchParams.delete("lesson");
    mocks.searchParams.set("courseId", "course-1");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses a compact course heading without the repeated introductory paragraph", async () => {
    const { container } = renderBuilder("content");
    const title = await screen.findByRole("heading", { name: mocks.course.title, level: 1 });
    expect(title).toHaveClass("text-2xl", "break-words");
    expect(title.className).not.toContain("clamp");
    expect(screen.queryByText("Build the course learners will actually experience: details, modules, lessons, media, pricing, drip rules, and publication checks in one guided workspace.")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit, reorder, and clean up modules and lessons")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add module" })).toBeEnabled();
    expect(container.querySelector("#builder-sec-modules")?.className).not.toMatch(/border|rounded|shadow/);
  });

  it.each([
    ["details", "Define las bases del curso."],
    ["pricing", "Define el precio."],
    ["content", "Organiza el contenido."],
    ["members", "Personaliza el área de miembros."],
    ["review", "Publica en el marketplace."],
  ])("keeps the %s step, course and publication gates while switching the builder language", async (tab, heading) => {
    renderBuilder(tab);
    await screen.findByRole("heading", { name: mocks.course.title });
    const subscriptions = vi.mocked(subscribeToTeacherCourse).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("navigation", { name: "Pasos para crear el curso" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: mocks.course.title })).toBeInTheDocument();
    // One "Save draft" (the top one) and "Publish product" only on the Publish tab: the
    // footer used to repeat both under every tab.
    expect(screen.getAllByRole("button", { name: "Guardar borrador" })).toHaveLength(1);
    if (tab === "review") {
      expect(screen.getByRole("button", { name: "Publicar producto" })).toBeDisabled();
    } else {
      expect(screen.queryByRole("button", { name: "Publicar producto" })).toBeNull();
      expect(screen.queryByText("Preparación para publicar")).toBeNull();
    }
    expect(screen.getByRole("link", { name: "Volver al estudio del creador" })).toHaveAttribute("href", "/teach");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
    expect(screen.getAllByText("Añade al menos una lección.").length).toBeGreaterThan(0);
    expect(mocks.searchParams.get("tab")).toBe(tab);
    expect(subscribeToTeacherCourse).toHaveBeenCalledTimes(subscriptions);
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    if (tab === "details") {
      fireEvent.click(screen.getByRole("button", { name: "Continuar a Precios" }));
      expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teach/builder?courseId=course-1&tab=pricing", { scroll: false });
    }
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("navigation", { name: "Course creation steps" })).toBeInTheDocument();
  });

  it("does not restart the 1800ms autosave when the language changes halfway through", async () => {
    vi.useFakeTimers();
    let finishSave = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    renderBuilder();
    await act(async () => {});
    const title = screen.getByRole("textbox", { name: "Course title" });
    fireEvent.change(title, { target: { value: "Curso $$ y $& con borrador" } });
    act(() => vi.advanceTimersByTime(900));
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("textbox", { name: "Título del curso" })).toBe(title);
    expect(title).toHaveValue("Curso $$ y $& con borrador");
    expect(screen.getByText("Cambios sin guardar")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(900));
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1]).toMatchObject({ title: "Curso $$ y $& con borrador", categories: ["Applied Psychology & Behavior"], currency: "USD" });
    expect(screen.getByText("Guardando")).toBeInTheDocument();
    await act(async () => finishSave());
    expect(screen.getByText("Todos los cambios guardados")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("localizes a visible price block without saving the invalid draft", async () => {
    vi.useFakeTimers();
    const view = renderBuilder("pricing");
    await act(async () => {});
    const price = screen.getByRole("textbox", { name: "Price" });
    fireEvent.change(price, { target: { value: "invalid" } });
    // The "not published yet" banner is also role="status" (it comes from InlineAlert),
    // so the announcement is found by its own text and the proof is being inside a live region.
    expect(screen.getByText(/fix the price/).closest('[role="status"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText(/corrige el precio/).closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Precio" })).toBe(price);
    expect(price).toHaveValue("invalid");
    act(() => vi.advanceTimersByTime(5000));
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    // Publishing lives only on the Publish tab: there, with the same draft, it stays
    // disabled.
    expect(screen.queryByRole("button", { name: "Publicar producto" })).toBeNull();
    mocks.searchParams.set("tab", "review");
    view.rerender(
      <I18nProvider initialLocale="en">
        <SwitchLanguage />
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Publicar producto" })).toBeDisabled();
    // The reason says what to do: fix the price, not "finish the items".
    expect(screen.getByRole("button", { name: "Publicar producto" })).toHaveAccessibleDescription(
      "Corrige el precio en Precios para publicar.",
    );
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  // The price warning used to land on the footer card, screens below the field.
  it("invalid price on Save draft: the notice is announced on the field itself, not at the top", async () => {
    renderBuilder("pricing");
    const price = await screen.findByRole("textbox", { name: "Price" });
    fireEvent.change(price, { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    const message = "Use a valid non-negative price, or leave the field empty.";
    // Focus goes to the field (on a phone it may be off screen).
    expect(price).toHaveFocus();
    expect(price).toHaveAttribute("aria-invalid", "true");
    expect(price).toHaveAccessibleDescription(message);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(document.querySelector(".course-builder-hero")?.nextElementSibling?.getAttribute("role")).not.toBe("alert");
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();

    // Fixed it: the warning goes away without waiting for another click.
    fireEvent.change(price, { target: { value: "49" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(price).not.toHaveAttribute("aria-invalid");
  });

  it("keeps canonical price and currency values when their labels change", async () => {
    vi.useFakeTimers();
    renderBuilder("pricing");
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: "Price" }), { target: { value: "149,50" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "BRL" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("textbox", { name: "Precio" })).toHaveValue("149,50");
    expect(screen.getByRole("combobox", { name: "Moneda" })).toHaveValue("BRL");
    const displayPrice = new Intl.NumberFormat("es", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(149.5);
    expect(screen.getByText((_content, element) => element?.tagName === "SPAN" && element.textContent === displayPrice)).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1800));
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1]).toMatchObject({
      priceAmountMinor: 14950,
      currency: "BRL",
      paymentType: "one_time",
      installmentsEnabled: false,
    });
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  // Lesson release used to live on the price tab ("Interval days" next to the
  // currency). Now it sits where the lessons are built, with a plain label.
  it("keeps the canonical release values in Curriculum when their labels change", async () => {
    vi.useFakeTimers();
    renderBuilder("content");
    await act(async () => {});
    const release = screen.getByRole("combobox", { name: "Lesson release" });
    fireEvent.change(release, { target: { value: "time_drip_lesson" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Days between releases" }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("combobox", { name: "Liberación de las lecciones" })).toBe(release);
    expect(release).toHaveValue("time_drip_lesson");
    expect(screen.getByRole("option", { name: "Una lección cada pocos días" })).toHaveProperty("selected", true);
    expect(screen.getByRole("textbox", { name: "Días entre cada liberación" })).toHaveValue("7");
    fireEvent.change(release, { target: { value: "time_drip_module" } });
    expect(screen.getByRole("textbox", { name: "Días entre cada liberación" })).toHaveValue("7");
    fireEvent.change(release, { target: { value: "time_drip_custom" } });
    expect(screen.queryByRole("textbox", { name: "Días entre cada liberación" })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1800));
    expect(vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1]).toMatchObject({
      dripStrategy: "time_drip_custom",
      dripIntervalDays: 7,
    });
  });

  it.each([0, 1, 2])("keeps a module name literal and cancels its deletion with %i lessons in Spanish", async (count) => {
    const title = "Módulo $$ $& {count}";
    const lessons = Array.from({ length: count }, (_, index) => ({
      id: `l${index}`, title: `Lección ${index}`, type: "text" as const, description: "",
    }));
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, modules: [{ id: "m1", title, lessons }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const related = count === 0 ? "" : count === 1 ? " y su 1 lección" : " y sus 2 lecciones";
    // The earlier sentence, now in the platform dialog; cancel does not delete.
    const dialog = screen.getByRole("dialog", { name: "¿Eliminar este módulo?" });
    expect(dialog).toHaveAccessibleDescription(`¿Eliminar el módulo "${title}"${related}? No se podrá deshacer después del guardado automático.`);
    expect(within(dialog).getByRole("button", { name: "Eliminar módulo" })).toHaveClass("button-danger-solid");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The module row shows the literal name and how many lessons it has; the
    // lessons themselves live on the module page (?module=M).
    const row = document.querySelector("#builder-sec-modules article") as HTMLElement;
    expect(row.querySelector("strong")?.textContent).toBe(title);
    expect(within(row).getByText(count === 1 ? "1 lección" : `${count} lecciones`)).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("confirming in the dialog deletes the module once, and only after the confirm", async () => {
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this module?" });
    expect(document.querySelectorAll("#builder-sec-modules article")).toHaveLength(1);
    clickConfirm(dialog, "Delete module");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelectorAll("#builder-sec-modules article")).toHaveLength(0);
  });

  it("localizes an existing module validation error and retains the unsaved module fields", async () => {
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title });
    // The module form is an order on the list; the lesson is born on the module
    // page (?module=M), so the two forms no longer share the screen.
    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const description = screen.getByRole("textbox", { name: "Module description" });
    fireEvent.change(description, { target: { value: "Descripción $$ $& sin enviar" } });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a module title before creating the module.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe un título antes de crear el módulo.");
    expect(screen.getByRole("textbox", { name: "Descripción del módulo" })).toBe(description);
    expect(description).toHaveValue("Descripción $$ $& sin enviar");
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it.each(["save", "publish"] as const)("keeps the activation recovery link after a %s error changes language", async (operation) => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      // The lesson needs content for Publish to unlock (lessonMedia item).
      emit({ ...mocks.course, paymentType: "free", priceAmountMinor: 0, modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const activation = new Error("Pay the one-time activation fee before publishing courses.");
    if (operation === "save") vi.mocked(updateTeacherCourseBuilder).mockRejectedValueOnce(activation);
    else vi.mocked(publishTeacherCourse).mockRejectedValueOnce(activation);
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(operation === "save"
      ? screen.getAllByRole("button", { name: "Save draft" })[0]
      : screen.getByRole("button", { name: "Publish product" }));
    await screen.findByRole("link", { name: "Activate storefront" });
    // The notice shows near the clicked button, not on the card at the end of the page.
    const alert = screen.getByRole("alert");
    if (operation === "save") {
      expect(document.querySelector(".course-builder-hero")?.nextElementSibling).toBe(alert);
    } else {
      expect(alert.closest(".course-builder-panel")).not.toBeNull();
      expect(alert.compareDocumentPosition(screen.getByRole("button", { name: "Publish product" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Activa tu tienda para habilitar la publicación: una tarifa única de activación, que se cobra una sola vez por cuenta de creador, nunca por curso.");
    expect(screen.getByRole("link", { name: "Activar tienda" })).toHaveAttribute("href", "/teach/activate?courseId=course-1");
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(publishTeacherCourse).toHaveBeenCalledTimes(operation === "publish" ? 1 : 0);
  });

  // A studio with stale assets can let Publish through; the server refusal for
  // an empty lesson must read as the same "every lesson" rule, not "try again".
  it("maps the server empty-lesson refusal to the lesson content message", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, paymentType: "free", priceAmountMinor: 0, modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    vi.mocked(publishTeacherCourse).mockRejectedValueOnce(
      new Error("Every lesson needs a video, text or a file before publishing."),
    );
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Publish product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a video, text or file to every lesson before publishing.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Añade un video, texto o archivo a cada lección antes de publicar.");
  });

  // F-04: while publishing, the button says "Publishing..." without changing width: the
  // resting label stays in the same cell, invisible and outside the name.
  it("publishing keeps both labels in place and names the button by the visible one", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, paymentType: "free", priceAmountMinor: 0, modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    let failPublish: (error: Error) => void = () => {};
    vi.mocked(publishTeacherCourse).mockImplementationOnce(
      () => new Promise((_resolve, reject) => { failPublish = reject; }),
    );
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    const idle = screen.getByRole("button", { name: "Publish product" });
    expect(within(idle).getByText("Publishing...")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(idle);

    const busy = await screen.findByRole("button", { name: "Publishing..." });
    expect(busy).toBe(idle);
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(within(busy).getByText("Publish product")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: "Publish product" })).toBeNull();

    await act(async () => { failPublish(new Error("network")); });
    expect(await screen.findByRole("button", { name: "Publish product" })).toBe(idle);
  });

  // The disabled button always says why: on someone else's course it used to be disabled
  // in silence (the sentence depended only on readiness).
  it("someone else's course: the disabled Publish says only the owner publishes", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, ownerId: "another-teacher", paymentType: "free", priceAmountMinor: 0, modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });

    const publish = screen.getByRole("button", { name: "Publish product" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription("Only the course owner can publish it.");
  });

  // The top "Save draft" does not turn into "Saving..." (the badge beside it already says so): only the
  // ring comes in, in the spot the waiting face already kept, so the button does not
  // push Manage and Preview. The name is the same in both states.
  it("Save draft keeps the ring's place and its name while saving", async () => {
    let finishSave = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    const save = screen.getByRole("button", { name: "Save draft" });
    expect(save.querySelectorAll('[class*="grid-area"]')).toHaveLength(2);
    fireEvent.click(save);

    await waitFor(() => expect(save).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByRole("button", { name: "Save draft" })).toBe(save);
    expect(save).toBeDisabled();

    await act(async () => finishSave());
    await waitFor(() => expect(save).not.toHaveAttribute("aria-busy"));
    expect(screen.getByRole("button", { name: "Save draft" })).toBe(save);
  });

  // The new kinds have their own refusals on the server: each says what is missing,
  // instead of the generic "try again".
  it.each([
    [
      "Schedule the live session before publishing.",
      "session",
      "Schedule the live session before publishing: the date has to be in the future.",
      "Agenda la sesión en vivo antes de publicar: la fecha tiene que ser futura.",
    ],
    [
      "Upload at least one file before publishing.",
      "file",
      "Upload at least one file (PDF, slides or workbook) before publishing.",
      "Sube al menos un archivo (PDF, presentación o cuaderno) antes de publicar.",
    ],
    [
      "Turn on the community before publishing.",
      "community",
      "Turn on the community before publishing: it is what members join.",
      "Activa la comunidad antes de publicar: es lo que reciben los miembros.",
    ],
  ])("maps the server refusal \"%s\" to its own message", async (serverMessage, reason, english, spanish) => {
    const blocked = vi.spyOn(track, "coursePublishBlocked");
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, paymentType: "free", priceAmountMinor: 0, modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    vi.mocked(publishTeacherCourse).mockRejectedValueOnce(new Error(serverMessage));
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Publish product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(english);
    expect(blocked).toHaveBeenCalledWith({ course_id: "course-1", reason });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("alert")).toHaveTextContent(spanish);
  });

  it("translates a completed save without repeating it", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await screen.findByText("Draft saved.");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("Borrador guardado.")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
  });

  it("keeps the new lesson pending across a locale change until the saved course echoes its id", async () => {
    vi.useFakeTimers();
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    let finishSave = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    mocks.searchParams.set("module", "m1");
    const view = renderBuilder("content");
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Lesson title" }), { target: { value: "Lesson $$ $&" } });
    fireEvent.click(screen.getByRole("button", { name: "Add lesson" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("Lección añadida. El editor se abrirá cuando termine el guardado automático...")).toBeInTheDocument();
    expect(screen.getByText("Guardando lección...")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1800));
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    const payload = vi.mocked(updateTeacherCourseBuilder).mock.calls[0][1];
    expect(payload.modules?.[0].lessons[0].title).toBe("Lesson $$ $&");
    await act(async () => finishSave());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => emitCourse({ ...mocks.course, ...payload }));
    // The lesson opens as a page (?lesson=L), not as a modal: it follows the requested URL.
    const opened = new URL(String(mocks.router.push.mock.calls.at(-1)?.[0]), "https://example.test");
    expect(opened.searchParams.get("lesson")).toBe(payload.modules?.[0].lessons[0].id);
    mocks.searchParams.set("lesson", opened.searchParams.get("lesson") ?? "");
    view.rerender(
      <I18nProvider initialLocale="en">
        <SwitchLanguage />
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lesson $$ $&" })).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("keeps the course-cover upload and translates its eventual failure", async () => {
    let rejectUpload: (error: Error) => void = () => {};
    vi.mocked(uploadCourseAsset).mockImplementationOnce((input) => {
      input.onProgress?.({ bytesTransferred: 512, totalBytes: 1024, percent: 50, state: "running" });
      return new Promise<string>((_resolve, reject) => { rejectUpload = reject; });
    });
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    const file = new File(["fixture"], "cover-$$-$&.png", { type: "image/png" });
    const input = screen.getByLabelText("Upload cover");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    // Fixed label while sending: the state is only the progress note.
    expect(screen.getByLabelText("Subir portada")).toBe(input);
    expect(screen.queryByText("Subiendo...")).toBeNull();
    expect(input).toBeDisabled();
    expect(screen.getByText("50%").closest('[role="status"]')).not.toBeNull();
    expect(vi.mocked(uploadCourseAsset).mock.calls[0][0]).toMatchObject({ file, courseId: "course-1", kind: "course_cover", isPreview: false });
    await act(async () => rejectUpload(Object.assign(new Error("permission"), { status: 403 })));
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso para subir archivos a este curso.");
    expect(screen.getByLabelText("Subir portada")).not.toBeDisabled();
    expect(uploadCourseAsset).toHaveBeenCalledOnce();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  // B-05: the course cover uses the single shell; the accept list and the ceiling follow its own.
  it("keeps the course-cover accept and refuses a file over the upload limit before sending", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    const input = screen.getByLabelText("Upload cover");
    expect(input).toHaveAttribute("accept", "image/*");
    const big = new File(["x"], "cover.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 600 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByText(/Use an image file under/).closest('[role="alert"]')).not.toBeNull();
    expect(uploadCourseAsset).not.toHaveBeenCalled();
  });

  it("uses the current language when leaving a dirty draft and keeps new-tab preview exempt", async () => {
    const { container } = renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.change(screen.getByRole("textbox", { name: "Course title" }), { target: { value: "Edited course title" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    const leave = document.createElement("a");
    leave.href = "/teach";
    leave.textContent = "Leave fixture";
    // Whoever would navigate (Next's Link): only gets the click if the guard lets it go.
    const followed = vi.fn((event: MouseEvent) => event.preventDefault());
    leave.addEventListener("click", followed);
    container.appendChild(leave);
    expect(fireEvent.click(leave)).toBe(false);
    expect(followed).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "¿Salir sin guardar?" });
    expect(dialog).toHaveAccessibleDescription("Este curso tiene cambios sin guardar. ¿Quieres salir y perderlos?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Quedarme en esta página" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(followed).not.toHaveBeenCalled();
    const preview = screen.getByRole("link", { name: /^Vista previa.*pestaña nueva/i });
    preview.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(preview);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  // The dialog does not hold the click the way confirm() did: once confirmed, the
  // same link gets the click once and goes on (Next's Link navigates).
  it("confirming the exit repeats the link click only once", async () => {
    const { container } = renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.change(screen.getByRole("textbox", { name: "Course title" }), { target: { value: "Edited course title" } });
    const leave = document.createElement("a");
    leave.href = "/teach";
    leave.textContent = "Leave fixture";
    const followed = vi.fn((event: MouseEvent) => event.preventDefault());
    leave.addEventListener("click", followed);
    container.appendChild(leave);
    fireEvent.click(leave);
    clickConfirm(screen.getByRole("dialog", { name: "Leave without saving?" }), "Leave anyway");
    await waitFor(() => expect(followed).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // The link left the screen while the dialog was open: once confirmed, the exit
  // goes through its address, once.
  it("confirming the exit with the link off screen navigates by address", async () => {
    mocks.router.push.mockClear();
    const { container } = renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.change(screen.getByRole("textbox", { name: "Course title" }), { target: { value: "Edited course title" } });
    const leave = document.createElement("a");
    leave.href = "/teach/sales?view=all#top";
    leave.textContent = "Leave fixture";
    container.appendChild(leave);
    fireEvent.click(leave);
    leave.remove();
    clickConfirm(screen.getByRole("dialog", { name: "Leave without saving?" }), "Leave anyway");
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledOnce());
    expect(mocks.router.push).toHaveBeenCalledWith("/teach/sales?view=all#top");
  });

  it("translates a read failure and recovers through the original subscription", async () => {
    let recover: (course: TeacherCourse | null) => void = () => {};
    const unsubscribe = vi.fn();
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit, fail) => {
      recover = emit;
      fail(new Error("Temporary fixture failure"));
      return Object.assign(unsubscribe, { reload: async () => {} });
    });
    const { unmount } = renderBuilder();
    expect(screen.getByText(/We could not load this course/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("No pudimos cargar este curso. Vuelve al estudio del creador e inténtalo de nuevo.")).toBeInTheDocument();
    await act(async () => recover(mocks.course));
    expect(screen.getByRole("navigation", { name: "Pasos para crear el curso" })).toBeInTheDocument();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  // jsdom serves on localhost, which is "outside production": checkout stays relative
  // (the short host only resolves in production) and the product page stays on www.
  it("offers permanent checkout and product page links in Promo links", async () => {
    mocks.searchParams.set("section", "links");
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByRole("button", { name: "Copy Checkout link" });
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveAttribute("href", "/courses/course-1/checkout");
    expect(screen.getByRole("link", { name: "Open Product page" })).toHaveAttribute("href", "https://www.skillsetmind.com/courses/course-1");
    expect(screen.getByRole("link", { name: "Open Checkout" })).not.toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Open Product page" })).not.toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Copy Checkout link" })).toBeInTheDocument();
  });

  it("publishes the checkout link on pay.skillsetmind.com in production and keeps the product page on www", async () => {
    vi.stubGlobal("location", { ...window.location, hostname: "www.skillsetmind.com" });
    mocks.searchParams.set("section", "links");
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByRole("button", { name: "Copy Checkout link" });
    expect(screen.getByRole("link", { name: "Open Checkout" })).toHaveAttribute("href", "https://pay.skillsetmind.com/courses/course-1/checkout");
    expect(screen.getByRole("link", { name: "Open Product page" })).toHaveAttribute("href", "https://www.skillsetmind.com/courses/course-1");
  });

  const expected = getCourseReadiness(mocks.course);

  it("observes navigation that mounts after the course recovers from an initial load failure", async () => {
    let recover: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, onCourse, onError) => {
      recover = onCourse;
      onError(new Error("Temporary load failure"));
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      observe = observe;
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect({ y: this.classList.contains("platform-content") ? 65 : 269 });
    });
    render(
      <section className="platform-content" style={{ paddingTop: 28, paddingBottom: 48 }}>
        <CourseManageHub courseId="course-1" />
      </section>,
    );
    expect(screen.queryByRole("navigation", { name: "Course management sections" })).toBeNull();

    await act(async () => recover(mocks.course));
    const menu = screen.getByRole("navigation", { name: "Course management sections" });
    expect(menu.style.getPropertyValue("--course-nav-height")).toBe("");
    expect(observe).toHaveBeenCalledWith(menu.closest(".platform-content"));
  });

  it("lets the entire desktop management list grow with the page instead of clipping Sales", async () => {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect({ y: this.classList.contains("platform-content") ? 65 : 269 });
    });
    const { unmount } = render(
      <section className="platform-content" style={{ paddingTop: 28, paddingBottom: 48 }}>
        <CourseManageHub courseId="course-1" />
      </section>,
    );
    const menu = await screen.findByRole("navigation", { name: "Course management sections" });
    // jsdom structural guard; real geometry is checked in the browser harness.
    expect(menu.style.getPropertyValue("--course-nav-height")).toBe("");
    expect(menu.className).not.toMatch(/overflow-y|max-h|sticky/);
    expect(within(menu).getByRole("button", { name: "Sales" })).toBeInTheDocument();

    height.mockReturnValue(500);
    act(() => resize());
    expect(menu.style.getPropertyValue("--course-nav-height")).toBe("");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  // jsdom has no layout. These explicit scrollports model an offscreen tab;
  // assertions check visibility and ancestor position, not a scrolling API.
  function managementScrollports(initialWidth = 334) {
    let width = initialWidth;
    let vertical = false;
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ offers: [] }) }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("platform-content")) return new DOMRect(0, 65, width + 56, 600);
      if (this.tagName === "NAV") return new DOMRect(28, 269, vertical ? 240 : width, vertical ? 720 : 54);
      const menu = this.closest("nav");
      const row = this.tagName === "BUTTON" ? this.parentElement : this;
      if (menu && row?.parentElement === menu) {
        const roadmap = !row.classList.contains("overflow-x-auto");
        if (roadmap && !vertical) return new DOMRect();
        const index = Array.from(row.children).indexOf(this);
        const spanish = row.textContent?.includes("Precios y ofertas");
        const top = 269 + (vertical ? (roadmap ? 640 : 32) - menu.scrollTop : 0);
        if (this.tagName === "BUTTON") {
          return new DOMRect(
            28 + (vertical ? 8 : index * (spanish ? 190 : 139) - row.scrollLeft),
            top + (vertical ? index * 48 : 0),
            vertical ? 224 : spanish ? 156 : 148,
            44,
          );
        }
        return new DOMRect(28, top, vertical ? 240 : width, vertical ? 576 : 44);
      }
      return new DOMRect(28, 269, width, 0);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.getBoundingClientRect().height;
    });
    return {
      disconnect,
      resize(nextWidth: number, nextVertical = false) {
        width = nextWidth;
        vertical = nextVertical;
        act(() => resize());
      },
    };
  }

  function navigationFixture() {
    return (
      <section className="platform-content" style={{ paddingBottom: 48 }}>
        <CourseManageHub courseId="course-1" />
      </section>
    );
  }

  function expectSectionVisible(name: string, vertical = false) {
    const menu = screen.getByRole("navigation", { name: /Course management sections|Secciones de gestión del curso/ });
    const button = within(menu).getByRole("button", { name });
    const bounds = (vertical ? menu : button.parentElement!).getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
    expect(rect.right).toBeLessThanOrEqual(bounds.right);
    expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
    expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
    return button.parentElement!;
  }

  it.each([false, true])("reveals a direct pricing section after asynchronous load (initial failure: %s)", async (failsFirst) => {
    managementScrollports();
    mocks.searchParams.set("section", "pricing");
    let receive: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, onCourse, onError) => {
      receive = onCourse;
      if (failsFirst) onError(new Error("Temporary load failure"));
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const { container } = render(navigationFixture());
    const viewport = container.querySelector<HTMLElement>(".platform-content")!;
    viewport.scrollTop = 17;
    expect(screen.queryByRole("navigation", { name: "Course management sections" })).toBeNull();

    await act(async () => receive(mocks.course));
    expect(screen.getByRole("heading", { name: "Pricing & checkout" })).toBeInTheDocument();
    expectSectionVisible("Pricing & offers");
    expect(viewport.scrollTop).toBe(17);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("keeps URL-selected sections visible across history and resize without moving the page or course header", async () => {
    const layout = managementScrollports();
    const { container, rerender, unmount } = render(navigationFixture());
    await screen.findByRole("navigation", { name: "Course management sections" });
    const viewport = container.querySelector<HTMLElement>(".platform-content")!;
    const menu = screen.getByRole("navigation", { name: "Course management sections" });
    const header = menu.parentElement!.previousElementSibling as HTMLElement;
    const headerTop = header.getBoundingClientRect().top;
    viewport.scrollTop = 17;
    expect(expectSectionVisible("Panel").scrollLeft).toBe(0);

    mocks.searchParams.set("section", "pricing");
    rerender(navigationFixture());
    const row = expectSectionVisible("Pricing & offers");
    const previousScroll = row.scrollLeft;
    layout.resize(334);
    expect(row.scrollLeft).toBe(previousScroll);
    layout.resize(264);
    expectSectionVisible("Pricing & offers");

    mocks.searchParams.delete("section");
    rerender(navigationFixture());
    expectSectionVisible("Panel");
    mocks.searchParams.set("section", "assistant");
    rerender(navigationFixture());
    const hiddenScroll = row.scrollLeft;
    layout.resize(1200, true);
    expectSectionVisible("Sales assistant", true);
    expect(menu.scrollTop).toBe(0);
    expect(row.scrollLeft).toBe(hiddenScroll);
    mocks.searchParams.delete("section");
    rerender(navigationFixture());
    expectSectionVisible("Panel", true);
    expect(viewport.scrollTop).toBe(17);
    expect(header.getBoundingClientRect().top).toBe(headerTop);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
    const previousDisconnects = layout.disconnect.mock.calls.length;
    unmount();
    expect(layout.disconnect).toHaveBeenCalledTimes(previousDisconnects + 1);
  });

  it.each([
    ["en", "Scroll to previous sections", "Scroll to more sections"],
    ["es", "Desplazar a secciones anteriores", "Desplazar a más secciones"],
  ] as const)("%s: scroll controls expose both directions and stop at the ends without navigating", async (locale, previousLabel, nextLabel) => {
    const layout = managementScrollports();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
    render(<I18nProvider initialLocale={locale}>{navigationFixture()}</I18nProvider>);
    const next = await screen.findByRole("button", { name: nextLabel });
    const previous = screen.getByRole("button", { name: previousLabel });
    const menu = screen.getByRole("navigation");
    const row = menu.querySelector<HTMLElement>(".overflow-x-auto")!;
    // Model only the browser's scroll operation; the real component owns the controls.
    row.scrollBy = vi.fn((options?: ScrollToOptions | number) => {
      const left = typeof options === "number" ? options : options?.left ?? 0;
      row.scrollLeft = Math.max(0, Math.min(400, row.scrollLeft + left));
      fireEvent.scroll(row);
    });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(row.scrollLeft).toBe(200);
    expect(previous).toBeEnabled();
    fireEvent.click(next);
    expect(row.scrollLeft).toBe(400);
    expect(next).toBeDisabled();
    fireEvent.click(previous);
    expect(row.scrollLeft).toBe(200);
    expect(next).toBeEnabled();
    row.scrollLeft = 0;
    fireEvent.scroll(row);
    expect(previous).toBeDisabled();
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(200);
    layout.resize(1200, true);
    expect(next).toBeDisabled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("keeps pricing visible through ES to EN and back without a URL change or resize", async () => {
    managementScrollports(264);
    mocks.searchParams.set("section", "pricing");
    const { container } = render(
      <I18nProvider initialLocale="es">
        <SwitchLanguage />
        {navigationFixture()}
      </I18nProvider>,
    );
    await screen.findByRole("heading", { name: "Precios y checkout" });
    const row = expectSectionVisible("Precios y ofertas");
    const viewport = container.querySelector<HTMLElement>(".platform-content")!;
    const menu = row.closest("nav")!;
    const header = menu.parentElement!.previousElementSibling as HTMLElement;
    const headerTop = header.getBoundingClientRect().top;
    const rowWidth = row.getBoundingClientRect().width;
    viewport.scrollTop = 17;
    const query = mocks.searchParams.toString();

    for (const label of ["Pricing & offers", "Precios y ofertas"]) {
      fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
      expectSectionVisible(label);
      expect(row.getBoundingClientRect().width).toBe(rowWidth);
      expect(viewport.scrollTop).toBe(17);
      expect(header.getBoundingClientRect().top).toBe(headerTop);
      expect(mocks.searchParams.toString()).toBe(query);
    }
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(subscribeToTeacherCourse).toHaveBeenCalledOnce();
  });

  it("fits the members preview to the intrinsic stage height, including height-only changes, and disconnects", async () => {
    let resize: (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: typeof resize) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    mocks.searchParams.set("tab", "members");
    const { container, unmount } = render(<CourseBuilderStudio />);
    await screen.findByText("Live preview");

    const frame = container.querySelector<HTMLDivElement>(
      "#builder-sec-members [data-members-theme][aria-hidden='true']",
    );
    expect(frame).toBeInTheDocument();
    expect(observe).toHaveBeenCalledWith(frame);
    const stage = frame?.firstElementChild as HTMLDivElement;
    expect(observe).toHaveBeenCalledWith(stage);
    const scaledWidth = () =>
      Number(stage.style.transform.slice(6, -1)) * Number.parseFloat(stage.style.width);

    act(() => resize([
      { target: frame!, contentRect: { width: 170, height: 0 } },
      { target: stage, contentRect: { width: 1080, height: 220 } },
    ]));
    expect(Number.parseFloat(frame!.style.height)).toBeCloseTo(220 * 170 / 1080);
    expect(scaledWidth()).toBeCloseTo(170);

    // A media query, font or title can change the hero height without changing
    // the frame width. Observing only the width leaves a blank strip or clips it.
    act(() => resize([{ target: stage, contentRect: { width: 1080, height: 540 } }]));
    expect(Number.parseFloat(frame!.style.height)).toBeCloseTo(85);
    expect(scaledWidth()).toBeCloseTo(170);

    act(() => resize([{ target: frame!, contentRect: { width: 340, height: 85 } }]));
    expect(frame).toHaveStyle({ height: "170px" });
    expect(scaledWidth()).toBeCloseTo(340);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(disconnect).not.toHaveBeenCalled();

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("keeps both previews native new-tab links without saving or publishing on click", async () => {
    renderMembers();
    await screen.findByText("Live preview");
    for (const locale of ["en", "es"]) {
      const labels = locale === "en"
        ? [/^Preview.*opens in a new tab/i, /^Open full preview.*opens in a new tab/i]
        : [/^Vista previa.*abre en una pestaña nueva/i, /^Abrir vista previa completa.*abre en una pestaña nueva/i];
      for (const label of labels) {
        const link = screen.getByRole("link", { name: label });
        expect(link.tagName).toBe("A");
        expect(link).toHaveAttribute("href", "/teach/builder/course-1/preview");
        expect(link).toHaveAttribute("target", "_blank");
        // The preview closes its own tab on exit: it needs to know who opened it.
        expect(link).toHaveAttribute("rel", "opener");
        fireEvent.click(link);
      }
      if (locale === "en") fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    }
    expect(screen.getByText("La vista previa completa abre la última versión guardada en una pestaña nueva. Espera a que termine el guardado automático antes de abrirla.")).toBeInTheDocument();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("translates a visible invalid-cover error while keeping author drafts and theme literal", async () => {
    renderMembers();
    await screen.findByText("Live preview");
    const fields = [
      ["Members area title", "Título del área de miembros", "Curso $$50 $&"],
      ["Subtitle", "Subtítulo", "Mi estudio $$ y $&"],
      ["Description", "Descripción", "Bienvenida literal $$ / $&"],
    ];
    for (const [label, , value] of fields) {
      fireEvent.change(screen.getByRole("textbox", { name: new RegExp(`^${label}`) }), { target: { value } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByLabelText("Upload cover")).toHaveAttribute("accept", "image/*");
    fireEvent.change(screen.getByLabelText("Upload cover"), { target: { files: [new File(["no"], "invalid.txt", { type: "text/plain" })] } });
    expect(screen.getByText(/Use an image file under/)).toBeInTheDocument();
    const subscriptions = vi.mocked(subscribeToTeacherCourse).mock.calls.length;
    const assetSubscriptions = vi.mocked(subscribeToCourseAssets).mock.calls.length;
    const saves = vi.mocked(updateTeacherCourseBuilder).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText(/Usa una imagen de menos de/)).toBeInTheDocument();
    expect(screen.queryByText(/Use an image file under/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Oscuro" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Personaliza el área de miembros." })).toBeInTheDocument();
    for (const [, label, value] of fields) expect(screen.getByRole("textbox", { name: new RegExp(`^${label}`) })).toHaveValue(value);
    expect(subscribeToTeacherCourse).toHaveBeenCalledTimes(subscriptions);
    expect(subscribeToCourseAssets).toHaveBeenCalledTimes(assetSubscriptions);
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(saves);
    expect(uploadCourseAsset).not.toHaveBeenCalled();
  });

  it("keeps the same pending cover upload and progress through locale changes, then translates its failure", async () => {
    let rejectUpload: (error: Error) => void = () => {};
    vi.mocked(uploadCourseAsset).mockImplementationOnce((input) => {
      input.onProgress?.({ bytesTransferred: 512, totalBytes: 1024, percent: 50, state: "running" });
      return new Promise<string>((_resolve, reject) => { rejectUpload = reject; });
    });
    renderMembers();
    await screen.findByText("Live preview");
    const file = new File(["fixture"], "cover-$$-$&.png", { type: "image/png" });
    const input = screen.getByLabelText("Upload cover");
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("50%").closest('[role="status"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByLabelText("Subir portada")).toBe(input);
    expect(screen.queryByText("Subiendo...")).toBeNull();
    expect(input).toBeDisabled();
    expect(screen.getByText("50%").closest('[role="status"]')).not.toBeNull();
    expect(uploadCourseAsset).toHaveBeenCalledOnce();
    expect(vi.mocked(uploadCourseAsset).mock.calls[0][0]).toMatchObject({ file, courseId: "course-1", ownerId: "teacher-1", kind: "members_cover", isPreview: false });
    const subscriptions = vi.mocked(subscribeToCourseAssets).mock.calls.length;
    await act(async () => rejectUpload(Object.assign(new Error("permission"), { status: 403 })));
    expect(screen.getByText("No tienes permiso para subir archivos a este curso.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByText("You do not have permission to upload files to this course.")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload cover")).not.toBeDisabled();
    expect(subscribeToCourseAssets).toHaveBeenCalledTimes(subscriptions);
    expect(uploadCourseAsset).toHaveBeenCalledOnce();
  });

  it("renders and removes a newly uploaded cover while preserving the author's literal title in both alt texts", async () => {
    const authorTitle = "Curso $$50; código $&.";
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, title: authorTitle });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    let emitAssets: (assets: CourseAsset[]) => void = () => {};
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, emit) => {
      emitAssets = emit;
      return Object.assign(() => {}, { reload: async () => undefined });
    });
    vi.mocked(uploadCourseAsset).mockResolvedValueOnce("new-cover");
    renderMembers();
    await screen.findByText("Live preview");
    await act(async () => fireEvent.change(screen.getByLabelText("Upload cover"), { target: { files: [new File(["image"], "cover.png", { type: "image/png" })] } }));
    act(() => emitAssets([{ id: "new-cover", courseId: "course-1", ownerId: "teacher-1", kind: "members_cover", fileName: "cover.png", contentType: "image/png", size: 5, storagePath: "fixture/cover.png", downloadUrl: "/fixture-cover.png", isPreview: false, lessonId: null }]));
    expect(screen.getByRole("img", { name: `${authorTitle} members cover` })).toHaveAttribute("src", "/fixture-cover.png");
    // Without the "Cover set" badge (B-05): the preview and "Replace cover" say there is a cover.
    expect(screen.getByLabelText("Replace cover")).toHaveAttribute("type", "file");
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("img", { name: `Portada del área de miembros de ${authorTitle}` })).toHaveAttribute("src", "/fixture-cover.png");
    expect(screen.getByLabelText("Cambiar portada")).toHaveAttribute("type", "file");
    fireEvent.click(screen.getByRole("button", { name: "Quitar portada" }));
    expect(screen.queryByRole("img", { name: `Portada del área de miembros de ${authorTitle}` })).not.toBeInTheDocument();
    expect(screen.getByText("Aún no hay portada")).toBeInTheDocument();
    expect(uploadCourseAsset).toHaveBeenCalledOnce();
    expect(subscribeToCourseAssets).toHaveBeenCalledOnce();
  });

  // The footer is gone: the library error shows below it, and with it closed,
  // at the top of the page.
  it("media library: the failure to reload the files is announced below it", async () => {
    renderBuilder();
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(screen.getByRole("button", { name: "Open media library" }));
    vi.mocked(fetchCourseAssets).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Fake asset deleted" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We could not load this course.");
    expect(alert.closest(".course-builder-footer")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide media library" }));
    expect(document.querySelector(".course-builder-hero")?.nextElementSibling).toBe(screen.getByRole("alert"));
  });

  // The community switch was hand-made (48x28, button positioned by `left`): now it is the
  // same one as Account. And the whole row is the switch: the text beside it toggles too.
  it("community: the Account switch turns on and off with the same state", async () => {
    renderMembers();
    const toggle = await screen.findByRole("switch", { name: "Enable course community" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveClass("min-h-11", "w-full");
    expect(toggle).toContainElement(screen.getByText("Course community"));
    expect(toggle).toHaveAccessibleDescription(/./);
    expect(toggle.querySelector(".settings-toggle:not(.settings-toggle--on)")).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle.querySelector(".settings-toggle--on")).not.toBeNull();
    expect(screen.getByText("Community is on. Students see a Community section in this course.")).toBeInTheDocument();
  });

  it("the pure function is the reference: 4 of 6 checks, 67%", () => {
    expect(expected.doneCount).toBe(4);
    expect(expected.total).toBe(6);
    expect(expected.percent).toBe(67);
  });

  it("builder: readiness shows once, in the stepper, with the bar at 67%", async () => {
    render(<CourseBuilderStudio />);

    await screen.findByRole("heading", { name: "Clinical performance foundations" });

    // The title arrives before the plan query; wait for the final percentage.
    // One line only: the top chip and the footer card used to repeat the number.
    expect(
      await screen.findByText(`${expected.doneCount} of ${expected.total} checks · ${expected.percent}%`),
    ).toBeInTheDocument();
    expect(screen.queryAllByText(new RegExp(`${expected.percent}%`))).toHaveLength(1);
    // One reading only: the sentence is the bar's name; the visible line stays out of the
    // accessibility tree so the screen reader does not repeat it.
    const checksLine = screen.getByText(`${expected.doneCount} of ${expected.total} checks · ${expected.percent}%`);
    expect(checksLine).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("progressbar", { name: checksLine.textContent! })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(expected.percent));

    // The next step shows once, in the stepper; the footer does not repeat the list.
    expect(screen.getAllByText("Add at least one lesson.")).toHaveLength(1);
    expect(screen.queryByText("Set a price above $0, or choose Free.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish product" })).toBeNull();
    cleanup();

    // The pending items live on the Publish tab, from the same list, and the disabled Publish
    // says why.
    mocks.searchParams.set("tab", "review");
    render(<CourseBuilderStudio />);
    await screen.findByRole("heading", { name: "Clinical performance foundations" });
    const review = document.getElementById("builder-sec-review")!;
    expect(within(review).getByText("Add at least one lesson.")).toBeInTheDocument();
    expect(within(review).getByText("Set a price above $0, or choose Free.")).toBeInTheDocument();
    const publish = screen.getByRole("button", { name: "Publish product" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription("Finish the publication checks to go live.");
  });

  it("waits for the plan response before reading the final builder readiness", async () => {
    plan.hold = true;
    render(<CourseBuilderStudio />);
    await screen.findByRole("heading", { name: mocks.course.title });
    expect(screen.getAllByText(/ · 57%$/)).toHaveLength(1);
    expect(screen.queryByText(new RegExp(` · ${expected.percent}%$`))).toBeNull();

    const settled = screen.findByText(`${expected.doneCount} of ${expected.total} checks · ${expected.percent}%`);
    plan.release!();
    expect(await settled).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(expected.percent));
  });

  it.each(["en", "es"] as const)("localizes the real manage checklist from %s without changing publication gates or edit destinations", async (initialLocale) => {
    const paidCourse = {
      ...mocks.course,
      title: "Curso $$ y $& de autoría",
      priceAmountMinor: 12000,
      installmentsEnabled: true,
      installmentsMax: 3,
    };
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit(paidCourse);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const { container } = render(
      <I18nProvider initialLocale={initialLocale}>
        <SwitchLanguage />
        <CourseManageHub courseId="course-1" />
      </I18nProvider>,
    );
    await screen.findByRole("heading", { name: paidCourse.title });
    const subscriptions = mocks.getSubscriptionCounts();
    const rows = () => [...container.querySelectorAll<HTMLElement>("[data-readiness-item]")];
    const state = () => rows().map((row) => ({
      id: row.dataset.readinessItem,
      done: row.querySelector("[data-drawn-check]") !== null,
      hrefs: [...row.querySelectorAll("a")].map((link) => link.getAttribute("href")),
    }));
    await waitFor(() => expect(rows()).toHaveLength(11));
    const initialState = state();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
    if (initialLocale === "en") {
      expect(screen.getByRole("link", { name: "Edit Course title" })).toBeInTheDocument();
      expect(screen.getByText("6 of 8 required steps done · 75% ready")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    }

    const card = screen.getByText("Lista de publicación").closest("section")!;
    for (const [id, label, hint, optional, done, href] of [
      ["title", "Título del curso", "Dale al curso un título de al menos 3 caracteres.", false, true, "/teach/builder?courseId=course-1&tab=details"],
      ["summary", "Descripción", "Escribe una descripción de al menos 20 caracteres.", false, true, "/teach/builder?courseId=course-1&tab=details"],
      ["category", "Categoría del marketplace", "Elige al menos una categoría del marketplace.", false, true, "/teach/builder?courseId=course-1&tab=details"],
      ["cover", "Imagen de portada", "Sube una portada. Aparece en la página del producto y en las tarjetas del marketplace.", true, false, "/teach/builder?courseId=course-1&tab=details"],
      ["module", "Módulo", "Añade al menos un módulo.", false, true, "/teach/builder?courseId=course-1&tab=content"],
      ["lesson", "Lección", "Añade al menos una lección.", false, false, "/teach/builder?courseId=course-1&tab=content"],
      ["pricing", "Precios", "Define un precio mayor que $0 o elige Gratis.", false, true, "/teach/builder?courseId=course-1&tab=pricing"],
      ["outcomes", "Resultados de aprendizaje", "Añade resultados de aprendizaje. Ayudan a vender en la página del producto.", true, false, "/teach/courses/course-1/manage?section=page"],
      ["installments", "Cuotas", "Define un límite de cuotas válido.", false, true, "/teach/builder?courseId=course-1&tab=pricing"],
      ["payouts", "Cobros de Stripe", "Completa la configuración de cobros de Stripe antes de publicar un curso de pago.", false, false, "/account/payments#stripe-connect"],
      ["verification", "Verificación profesional", "Hoy es opcional; será obligatoria cuando se abra la admisión profesional.", true, false, "/teach/verification"],
    ] as const) {
      const row = card.querySelector<HTMLElement>(`[data-readiness-item="${id}"]`)!;
      expect(within(row).getByText(label)).toBeInTheDocument();
      expect(within(row).getByText(hint)).toBeInTheDocument();
      expect(Boolean(within(row).queryByText("Opcional"))).toBe(optional);
      expect(row.querySelector("[data-drawn-check]") !== null).toBe(done);
      expect(within(row).getByRole("link", {
        name: id === "verification" ? "Abrir verificación" : `Editar ${label}`,
      })).toHaveAttribute("href", href);
      expect(within(row).getAllByRole("link")).toHaveLength(1);
    }
    expect(within(card).getByText("6 de 8 pasos obligatorios listos · 75% listo")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
    expect(state()).toEqual(initialState);
    expect(screen.getByRole("heading", { name: paidCourse.title })).toBeInTheDocument();
    expect(mocks.getSubscriptionCounts()).toEqual(subscriptions);
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  // A course could be published with empty lessons. The builder's Publish
  // now locks and says which lesson is missing; with content in both, it unlocks.
  it.each([
    ["one empty lesson", false],
    ["content in both", true],
  ] as const)("builder: Publish with %s", async (_case, filled) => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({
        ...mocks.course,
        paymentType: "free",
        priceAmountMinor: 0,
        modules: [{ id: "m1", title: "Start here", lessons: [
          { id: "l1", title: "Welcome", description: "", type: "video", contentText: "Read this first." },
          {
            id: "l2", title: "Empty lesson", description: "", type: "video",
            ...(filled ? { externalUrl: "https://www.youtube.com/watch?v=abc" } : {}),
          },
        ] }],
      });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });

    const hint = "Add a video, text or file to every lesson. Missing: Empty lesson.";
    const publish = screen.getByRole("button", { name: "Publish product" });
    if (filled) {
      await waitFor(() => expect(publish).toBeEnabled());
      expect(screen.queryByText(hint)).not.toBeInTheDocument();
    } else {
      expect((await screen.findAllByText(hint)).length).toBeGreaterThan(0);
      expect(publish).toBeDisabled();
    }
    expect(publishTeacherCourse).not.toHaveBeenCalled();
  });

  it("Manage: bar and count show the same 67% and the same pending items", async () => {
    render(<CourseManageHub courseId="course-1" />);

    await screen.findByText("Publish checklist");

    expect(
      await screen.findByText(
        `${expected.doneCount} of ${expected.total} required steps done · ${expected.percent}% ready`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(expected.percent));
    // One reading only: the sentence is the bar's name, and the visible line stays hidden.
    const stepsLine = screen.getByText(`${expected.doneCount} of ${expected.total} required steps done · ${expected.percent}% ready`);
    expect(stepsLine).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("progressbar", { name: stepsLine.textContent! })).toBeInTheDocument();

    const list = screen.getByText("Publish checklist").closest("section") ?? document.body;
    expect(within(list).getByText("Add at least one lesson.")).toBeInTheDocument();
    expect(
      within(list).getByText("Set a price above $0, or choose Free."),
    ).toBeInTheDocument();
  });

  // Manage did not read the file list and dropped "content in every lesson": the
  // same course gave 83% there and 71% in the builder.
  it("empty lesson: builder and Manage show the same number, with the same item", async () => {
    const withEmptyLesson: TeacherCourse = {
      ...mocks.course,
      modules: [{ id: "m1", title: "Start here", lessons: [
        { id: "l1", title: "Ready lesson", description: "", type: "text", contentText: "Read this first." },
        { id: "l2", title: "Empty lesson", description: "", type: "video" },
      ] }],
      lessonCount: 2,
    };
    const reference = getCourseReadiness({
      ...withEmptyLesson,
      lessonIdsWithMedia: getLessonIdsWithMedia(withEmptyLesson.modules, []),
    });
    expect([reference.doneCount, reference.total, reference.percent]).toEqual([5, 7, 71]);
    const emit = () => vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, onData) => {
      onData(withEmptyLesson);
      return Object.assign(() => {}, { reload: async () => {} });
    });

    emit();
    const hub = render(<CourseManageHub courseId="course-1" />);
    expect(await screen.findByText("5 of 7 required steps done · 71% ready")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "71");
    expect(hub.container.querySelector('[data-readiness-item="lessonMedia"]')).not.toBeNull();
    cleanup();

    emit();
    render(<CourseBuilderStudio />);
    expect(await screen.findByText("5 of 7 checks · 71%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "71");
  });

  // B-15: without the file list, Manage gave a different number than the builder
  // (and the failure was swallowed). Now it waits with "—%", and the failure has "Try again".
  it("Manage: without the file list, —% in place of the number and Try again", async () => {
    const withLesson: TeacherCourse = {
      ...mocks.course,
      modules: [{ id: "m1", title: "Start here", lessons: [
        { id: "l1", title: "Ready lesson", description: "", type: "text", contentText: "Read this first." },
      ] }],
      lessonCount: 1,
    };
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, onData) => {
      onData(withLesson);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    vi.mocked(fetchCourseAssets).mockRejectedValueOnce(new Error("offline"));
    render(<CourseManageHub courseId="course-1" />);

    expect(await screen.findByText("Checking the content of your lessons... · —% ready")).toBeInTheDocument();
    expect(await screen.findByText(/We could not check the content of your lessons/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText(/—%/)).toBeNull();
    expect(screen.queryByText(/We could not check the content/)).toBeNull();
  });
});

// Cut 1 of simple creation: whoever picks Free does not go through the whole
// price tab, the dead installments disappear, lesson release leaves pricing and
// recurring charge says "charge every month / every year".
describe("price tab without what does not apply", () => {
  const freeCourse: TeacherCourse = { ...mocks.course, paymentType: "free", priceAmountMinor: 0 };

  function emit(course: TeacherCourse) {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, onData) => {
      onData(course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("tab");
    mocks.searchParams.delete("welcome");
    delete profileExtra.stripeConnectCountry;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("free product: the phrase 'This product is free' takes the place of the price fields, not of the cards", async () => {
    emit(freeCourse);
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.getByText(/^This product is free\./)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Price" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Currency" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Let them split it into payments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Free preview lesson" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Free/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Monthly membership/ })).toBeInTheDocument();
  });

  // Keyboard and screen reader: before, the whole group of cards unmounted when
  // picking Free (and the sentence when going back to paid), and focus fell on <body>.
  it("switching between Free and paid keeps focus on the clicked card and only the price fields disappear and come back", async () => {
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    const free = screen.getByRole("button", { name: /^Free/ });
    free.focus();
    fireEvent.click(free);
    expect(free).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(free);
    expect(screen.queryByRole("textbox", { name: "Price" })).not.toBeInTheDocument();
    expect(screen.getByText(/^This product is free\./)).toBeInTheDocument();

    const monthly = screen.getByRole("button", { name: /Monthly membership/ });
    monthly.focus();
    fireEvent.click(monthly);
    expect(monthly).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(monthly);
    expect(screen.queryByText(/^This product is free\./)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Price per month" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Currency" })).toBeInTheDocument();
  });

  it("free product: the publish checklist does not ask for a price", async () => {
    emit(freeCourse);
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.queryByText(/Set a paid price/)).not.toBeInTheDocument();
    expect(screen.queryByText("Pricing", { selector: "p" })).not.toBeInTheDocument();
    // A sale with no items said "Sale available · 0 of 0"; the other groups
    // keep the count.
    expect(document.querySelector('[data-readiness-group="sale"] p')).toHaveTextContent(/^Sale available$/);
    expect(document.querySelector('[data-readiness-group="content"] p')).toHaveTextContent(/^Content saved · \d+ of \d+$/);
    expect(screen.queryByText(/0 of 0/)).not.toBeInTheDocument();
  });

  it("paid product: one question, the monthly fee says it repeats and the fixed sentence separates installments from monthly fee", async () => {
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.getByRole("group", { name: /How will people pay\?/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Monthly membership/ })).toHaveTextContent("Charged every month until they cancel. Ex.: $29/month.");
    expect(screen.getByRole("button", { name: /One payment/ })).toHaveTextContent("They pay once and keep access. Ex.: $300.");
    expect(screen.getByText("Split payments = the same price divided; it ends on the last payment. Monthly membership = a charge that repeats until they cancel.")).toBeInTheDocument();
    expect(screen.queryByText(/subscription|Payment model|Marketplace setup|billing interval/i)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Price" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Free preview lesson" })).toBeInTheDocument();
    // F-12: with no lesson the selector stays disabled and says why.
    expect(screen.getByRole("combobox", { name: "Free preview lesson" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Free preview lesson" }))
      .toHaveAccessibleDescription("Add a lesson in Curriculum first, then pick it here.");
  });

  // F-12: no teto de resultados o "Add" apagava calado.
  it("results at the cap: the disabled Add states the limit", async () => {
    renderBuilder("details");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });
    const add = screen.getByRole("button", { name: "Add learning outcome" });
    for (let index = 0; index < 8 && !(add as HTMLButtonElement).disabled; index += 1) fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription("You can list up to 8 outcomes.");
  });

  it.each([
    ["flag off, Mexico account", undefined, "MX"],
    ["flag on, US account", "true", "US"],
  ])("installments stay hidden: %s", async (_case, flag, country) => {
    if (flag) vi.stubEnv("NEXT_PUBLIC_PAYMENTS_CARD_INSTALLMENTS_ENABLED", flag);
    profileExtra.stripeConnectCountry = country;
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "MXN" } });
    expect(screen.queryByRole("checkbox", { name: "Let them split it into payments" })).not.toBeInTheDocument();
    expect(screen.queryByText(/installment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stripe requires/)).not.toBeInTheDocument();
  });

  // Same rule as checkout (canSplitPayments): flag, MXN and a Mexico
  // account. With the right account and the wrong currency the option does not exist either,
  // instead of showing up disabled asking to change the currency.
  it("installments only show with the flag on, a Mexico account and MXN, with the installments preview", async () => {
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_CARD_INSTALLMENTS_ENABLED", "true");
    profileExtra.stripeConnectCountry = "MX";
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.queryByRole("checkbox", { name: "Let them split it into payments" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "MXN" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Price" }), { target: { value: "300" } });
    const split = screen.getByRole("checkbox", { name: "Let them split it into payments" });
    expect(split).not.toBeChecked();
    expect(screen.queryByRole("combobox", { name: "Up to how many payments" })).not.toBeInTheDocument();
    fireEvent.click(split);
    fireEvent.change(screen.getByRole("combobox", { name: "Up to how many payments" }), { target: { value: "3" } });
    expect(screen.getByText(`3x of ${new Intl.NumberFormat("en", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(100)}`)).toBeInTheDocument();
    expect(screen.queryByText(/Mexican card|card issuer|not a subscription/)).not.toBeInTheDocument();

    // A monthly fee does not split into installments: the option disappears.
    fireEvent.click(screen.getByRole("button", { name: /Monthly membership/ }));
    expect(screen.queryByRole("checkbox", { name: "Let them split it into payments" })).not.toBeInTheDocument();
  });

  it("lesson release lives in the content, not in the price", async () => {
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.queryByRole("combobox", { name: "Lesson release" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Interval days|Content release/)).not.toBeInTheDocument();
    cleanup();

    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });
    expect(screen.getByRole("heading", { name: "When lessons open" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Lesson release" })).toHaveValue("instant");

    // The default interval is 1: "Release lessons every 1 days" came out wrong.
    fireEvent.change(screen.getByRole("combobox", { name: "Lesson release" }), { target: { value: "time_drip_lesson" } });
    expect(screen.getByRole("textbox", { name: "Days between releases" })).toHaveValue("1");
    expect(screen.queryByText(/Release (lessons|modules) every/)).not.toBeInTheDocument();
  });

  // The "Add a short welcome lesson" shortcut from the Agenda arrives with ?welcome=1: the
  // first module already comes with its name filled in.
  it("welcome lesson shortcut: the first module is created with the name Welcome", async () => {
    emit({ ...mocks.course, modules: [] });
    mocks.searchParams.set("welcome", "1");
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.getByRole("textbox", { name: "Module title" })).toHaveValue("Welcome");

    // Filled once, the parameter leaves the URL (replace, no new history
    // entry). Reloading the URL that was left does not fill in another "Welcome".
    expect(mocks.router.replace).toHaveBeenCalledOnce();
    const [href, options] = vi.mocked(mocks.router.replace).mock.calls[0];
    const next = new URL(String(href), "https://app.test");
    expect(next.pathname).toBe("/teach/builder");
    expect(next.searchParams.get("welcome")).toBeNull();
    expect(next.searchParams.get("courseId")).toBe("course-1");
    expect(next.searchParams.get("tab")).toBe("content");
    expect(options).toEqual({ scroll: false });

    cleanup();
    mocks.searchParams.delete("welcome");
    emit({ ...mocks.course, modules: [] });
    renderBuilder("content");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });
    expect(screen.getByRole("textbox", { name: "Module title" })).toHaveValue("");
    expect(mocks.router.replace).toHaveBeenCalledOnce();
  });

  it("details calls the text Description", async () => {
    renderBuilder("details");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    expect(screen.getByRole("textbox", { name: /^Description/ })).toHaveValue(mocks.course.summary);
    expect(screen.queryByText(/summary/i)).not.toBeInTheDocument();
  });

  it("footer: Continue filled, large and with an arrow; Back outlined", async () => {
    renderBuilder("pricing");
    await screen.findByRole("heading", { name: mocks.course.title, level: 1 });

    const next = screen.getByRole("button", { name: "Continue to Curriculum" });
    const back = screen.getByRole("button", { name: "Back to Details" });
    expect(next).toHaveClass("button-solid", "button-lg");
    expect(next.querySelector("svg")).not.toBeNull();
    expect(back).toHaveClass("button-outline", "button-lg");
    expect(back).not.toHaveClass("button-solid");
  });
});

// The teacher of a course not yet published opened the Panel and saw three empty boxes
// — "nobody bought this product yet", "needs your attention" and
// "recent activity" — before reaching what they came for: what is missing
// to publish. And each checklist row only described the pending item, without taking
// them anywhere.
describe("Dashboard: what is missing to publish comes first and each row leads somewhere", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("section");
    mocks.searchParams.delete("tab");
    mocks.searchParams.delete("module");
    mocks.searchParams.delete("lesson");
    vi.restoreAllMocks();
  });

  function checklistCard() {
    const card = screen.getByText("Publish checklist").closest("section");
    if (!card) throw new Error("checklist card did not mount");
    return card;
  }

  it("draft: the checklist comes BEFORE the panel; published: after", async () => {
    const { unmount } = render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");

    const draftOrder = checklistCard().compareDocumentPosition(
      screen.getByTestId("course-overview-panel"),
    );
    // FOLLOWING = the panel comes AFTER the checklist in the DOM (and on screen).
    expect(draftOrder & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    vi.mocked(subscribeToTeacherCourse).mockImplementation((_id, onCourse) => {
      onCourse({ ...mocks.course, status: "published" });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");

    const liveOrder = checklistCard().compareDocumentPosition(
      screen.getByTestId("course-overview-panel"),
    );
    expect(liveOrder & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("each row leads to the screen that EDITS the field, and does not duplicate the verification link", async () => {
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");
    const card = checklistCard();

    const hrefOf = (item: string) =>
      within(card)
        .getByLabelText(`Edit ${item}`)
        .getAttribute("href");

    expect(hrefOf("Course title")).toBe("/teach/builder?courseId=course-1&tab=details");
    expect(hrefOf("Cover image")).toBe("/teach/builder?courseId=course-1&tab=details");
    expect(hrefOf("Lesson")).toBe("/teach/builder?courseId=course-1&tab=content");
    expect(hrefOf("Pricing")).toBe("/teach/builder?courseId=course-1&tab=pricing");
    // Learning outcomes have a real editor INSIDE the hub.
    expect(hrefOf("Learning outcomes")).toBe(
      "/teach/courses/course-1/manage?section=page",
    );
    // Verification already has its own link in the hint: it does not get a second one.
    expect(within(card).getByRole("link", { name: "Open verification" })).toBeInTheDocument();
    expect(within(card).queryByLabelText(/^Edit Professional verification$/)).toBeNull();
  });

  // The same drawing as the builder: a drawn green check (with "Done" for the
  // screen reader) and an empty circle, and the same brass bar. Before it was a
  // typed "✓" in a blue dot and a thicker blue bar.
  it("completed row has the builder's green check; pending row, the empty circle", async () => {
    render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");
    const card = checklistCard();

    // "Module" is done (the course has one module); "Lesson" is not.
    const done = card.querySelector<HTMLElement>('[data-readiness-item="module"]')!;
    const pending = card.querySelector<HTMLElement>('[data-readiness-item="lesson"]')!;
    expect(done.querySelector("[data-drawn-check]")).not.toBeNull();
    expect(done).toHaveTextContent(/^Done: /);
    expect(done).not.toHaveTextContent("✓");
    expect(pending.querySelector("[data-drawn-check]")).toBeNull();
    // The shared bar: fill in the text brass (3:1 contrast).
    expect(screen.getByRole("progressbar").firstElementChild).toHaveClass("bg-[var(--color-accent-fg)]");
  });
});

// The activation fee only showed up as a database error AFTER clicking Publish,
// the payouts item did not lead anywhere and success did not give the link to
// share. Now all of that shows on the Publish tab, before and after the click.
describe("publish without surprise", () => {
  const readyFreeCourse: TeacherCourse = {
    ...mocks.course,
    paymentType: "free",
    priceAmountMinor: 0,
    modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit(readyFreeCourse);
      return Object.assign(() => {}, { reload: async () => {} });
    });
  });

  afterEach(() => {
    cleanup();
    activation.blocked = false;
    mocks.searchParams.delete("section");
    mocks.searchParams.delete("tab");
    vi.restoreAllMocks();
  });

  it("lists the one-time activation and sends Activate and publish to checkout with this course", async () => {
    activation.blocked = true;
    const blocked = vi.spyOn(track, "coursePublishBlocked");
    renderBuilder("review");
    const button = await screen.findByRole("button", { name: "Activate and publish" });
    expect(screen.getAllByText("Activation — US$25, one time").length).toBeGreaterThan(0);
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach/activate?courseId=course-1"));
    expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce();
    expect(publishTeacherCourse).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledWith({ course_id: "course-1", reason: "activation" });

    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("button", { name: "Activar y publicar" })).toBeInTheDocument();
    expect(screen.getAllByText("Activación — US$25, pago único").length).toBeGreaterThan(0);
  });

  it("keeps Publish product for a creator who does not owe the fee", async () => {
    renderBuilder("review");
    const button = await screen.findByRole("button", { name: "Publish product" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText("Activation — US$25, one time")).toBeNull();
  });

  it("keeps a complete course blocked until the plan response allows publishing", async () => {
    plan.hold = true;
    renderBuilder("review");
    const button = await screen.findByRole("button", { name: "Publish product" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(publishTeacherCourse).not.toHaveBeenCalled();

    await act(async () => plan.release!());
    await waitFor(() => expect(button).toBeEnabled());
    expect(publishTeacherCourse).not.toHaveBeenCalled();
  });

  it("Manage: the activation row leads to checkout for this course", async () => {
    activation.blocked = true;
    const { container } = render(<CourseManageHub courseId="course-1" />);
    await screen.findByText("Publish checklist");
    const row = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-readiness-item="activation"]');
      if (!found) throw new Error("activation row missing");
      return found;
    });
    expect(within(row).getByRole("link")).toHaveAttribute("href", "/teach/activate?courseId=course-1");
  });

  it("shows the product link to share right after publishing", async () => {
    vi.mocked(publishTeacherCourse).mockResolvedValueOnce(undefined as never);
    renderBuilder("review");
    await publishProduct();
    expect(await screen.findByRole("heading", { name: "It's live." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Product page" })).toHaveAttribute("href", "https://www.skillsetmind.com/courses/course-1");
    expect(screen.getByRole("button", { name: "Copy my page link" })).toBeInTheDocument();
  });

  // The peak of the journey was a gray paragraph just like "Draft saved.". Now it is
  // a panel with the "Published!" scene and focus on the brass copy button.
  describe("the Published! panel", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("swaps the gray paragraph for the scene and moves focus to 'Copy my page link'", async () => {
      vi.mocked(publishTeacherCourse).mockResolvedValueOnce(undefined as never);
      const { container } = renderBuilder("review");
      await publishProduct();

      const copy = await screen.findByRole("button", { name: "Copy my page link" });
      await waitFor(() => expect(copy).toHaveFocus());
      expect(copy).toHaveClass("button-accent");
      // The button reads the panel's title and sentence for whoever arrives by focus.
      expect(copy).toHaveAccessibleDescription(/It's live\. Your product page is open to everyone/);

      const panel = screen.getByRole("region", { name: "It's live." });
      expect(panel).toHaveClass("published-panel", "is-celebrating");
      expect(panel.querySelector('svg[data-scene="published"]')).toHaveAttribute("aria-hidden", "true");
      expect(container.querySelector(".info-notice")).toBeNull();
      // One brass per screen: "Publish product" leaves while the panel is there.
      expect(screen.queryByRole("button", { name: "Publish product" })).toBeNull();
    });

    it("celebrates once per product: publishing again shows the still panel", async () => {
      window.localStorage.setItem("skillsetmind.publishedCelebrated.course-1", "1");
      vi.mocked(publishTeacherCourse).mockResolvedValueOnce(undefined as never);
      renderBuilder("review");
      await publishProduct();

      const panel = await screen.findByRole("region", { name: "It's live." });
      expect(panel).not.toHaveClass("is-celebrating");
      expect(panel).toHaveClass("published-panel");
    });
  });

  it("links the payouts error to Stripe setup and records why publishing was blocked", async () => {
    const blocked = vi.spyOn(track, "coursePublishBlocked");
    vi.mocked(publishTeacherCourse).mockRejectedValueOnce(new Error("Finish Stripe payout onboarding before publishing a paid course."));
    renderBuilder("review");
    await publishProduct();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "Set up how you get paid" })).toHaveAttribute("href", PAYOUTS_WITH_RETURN);
    expect(blocked).toHaveBeenCalledWith({ course_id: "course-1", reason: "payouts" });
  });

  // Whoever never subscribed went to the receipts ("Manage plan"): now they go to the
  // plans, as on the teacher's Home. Whoever has a plan keeps managing.
  it.each([
    ["free", "See plans", "/account/plans"],
    ["pro", "Manage plan", "/account/billing?tab=subscriptions"],
  ] as const)("links a server plan refusal for plan %s to %s", async (planId, name, href) => {
    profileExtra.currentPlanId = planId;
    try {
      vi.mocked(publishTeacherCourse).mockRejectedValueOnce(new Error("creator_plan_required"));
      renderBuilder("review");
      await publishProduct();
      const alert = await screen.findByRole("alert");
      await waitFor(() => expect(within(alert).getByRole("link", { name })).toHaveAttribute("href", href));
    } finally {
      delete profileExtra.currentPlanId;
    }
  });

  it.each([
    ["free", "See plans", "/account/plans"],
    ["pro", "Manage plan", "/account/billing?tab=subscriptions"],
  ] as const)("offers plan %s a %s link and disables publishing when the server requires a plan", async (planId, name, href) => {
    plan.required = true;
    profileExtra.currentPlanId = planId;
    try {
      renderBuilder("review");
      expect(await screen.findByRole("link", { name })).toHaveAttribute("href", href);
      expect(screen.getByRole("button", { name: "Publish product" })).toBeDisabled();
      expect(publishTeacherCourse).not.toHaveBeenCalled();
    } finally {
      delete profileExtra.currentPlanId;
    }
  });
});

describe("block reason in analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({
        ...mocks.course,
        paymentType: "free",
        priceAmountMinor: 0,
        modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }],
      });
      return Object.assign(() => {}, { reload: async () => {} });
    });
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("tab");
    vi.restoreAllMocks();
  });

  it.each([
    ["the draft save fails", "save", () => vi.mocked(updateTeacherCourseBuilder).mockRejectedValueOnce(new Error("Server said no."))],
    ["the connection drops", "network", () => vi.mocked(publishTeacherCourse).mockRejectedValueOnce(new TypeError("Failed to fetch"))],
    ["the server refuses for an unknown reason", "publish", () => vi.mocked(publishTeacherCourse).mockRejectedValueOnce(new Error("Something odd."))],
  ] as const)("records %s as %s", async (_case, reason, arrange) => {
    const blocked = vi.spyOn(track, "coursePublishBlocked");
    arrange();
    renderBuilder("review");
    await publishProduct();
    await screen.findByRole("alert");
    expect(blocked).toHaveBeenCalledExactlyOnceWith({ course_id: "course-1", reason });
  });
});

describe("payouts item in the builder", () => {
  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("tab");
    vi.restoreAllMocks();
  });

  it("links the pending Stripe payouts item to the payouts setup, like Manage", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, priceAmountMinor: 12000 });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    const item = screen.getAllByText("Stripe payouts")[0].closest("li")!;
    expect(within(item).getByRole("link", { name: "Set up how you get paid" })).toHaveAttribute("href", PAYOUTS_WITH_RETURN);
  });
});

// Each Publish pending item leads to the place to fix it; a product that is live does not
// show a disabled, mute "Publish product".
describe("Publish tab: each pending item has somewhere to go", () => {
  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("tab");
    mocks.router.push.mockReset();
    vi.restoreAllMocks();
  });

  it("the price item leads to the Pricing tab, and the item name goes on the button", async () => {
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    const fix = await screen.findByRole("button", { name: "Go to Pricing: Pricing" });
    fireEvent.click(fix);
    expect(mocks.router.push).toHaveBeenCalledWith(
      "/teach/builder?courseId=course-1&tab=pricing",
      { scroll: false },
    );
  });

  it("missing content opens the first lesson without content", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({
        ...mocks.course,
        modules: [{ id: "m1", title: "Start here", lessons: [
          { id: "l1", title: "Ready lesson", description: "", type: "text", contentText: "Read this first." },
          { id: "l2", title: "Empty lesson", description: "", type: "video" },
        ] }],
      });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    fireEvent.click(await screen.findByRole("button", { name: "Open the lesson: Lesson content" }));
    expect(mocks.router.push).toHaveBeenCalledWith(
      "/teach/builder?courseId=course-1&tab=content&module=m1&lesson=l2",
      { scroll: false },
    );
  });

  it("live product says it does not need to be published again, with no disabled button", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, status: "published" });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    expect(screen.getAllByText("This product is already live. Saved changes don't need a new publish.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Publish product" })).toBeNull();
    expect(screen.queryByText("Finish the publication checks to go live.")).toBeNull();
  });
});

// Manage reached 100% with the builder saying "not ready": it did not
// know the live event session nor the e-book file.
describe("Manage: what the type delivers counts toward the percentage", () => {
  afterEach(() => {
    cleanup();
    sessions.list = [];
    vi.clearAllMocks();
  });

  function renderHub(course: TeacherCourse) {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit(course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    return render(
      <I18nProvider initialLocale="en">
        <CourseManageHub courseId="course-1" />
      </I18nProvider>,
    );
  }

  const row = (container: HTMLElement, id: string) =>
    container.querySelector<HTMLElement>(`[data-readiness-item="${id}"]`);
  const done = (element: HTMLElement | null) =>
    Boolean(element?.querySelector("[data-drawn-check]"));

  const free = { paymentType: "free" as const, priceAmountMinor: 0 };

  it("live event: the upcoming session is an item, pending until it exists", async () => {
    const event = { ...mocks.course, ...free, productFormat: "live_event" as const, modules: [], lessonCount: 0 };
    const pending = renderHub(event);
    await screen.findByRole("heading", { name: event.title });
    await waitFor(() => expect(row(pending.container, "session")).not.toBeNull());
    expect(done(row(pending.container, "session"))).toBe(false);
    expect(row(pending.container, "lesson")).toBeNull();
    cleanup();

    sessions.list = [{
      id: "event-1", courseId: "course-1", courseSlug: "course-1", courseTitle: event.title,
      ownerId: "teacher-1", title: event.title, description: "", type: "live_class", status: "scheduled",
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), externalUrl: "",
      recordingAssetId: null,
    }];
    const ready = renderHub(event);
    await screen.findByRole("heading", { name: event.title });
    await waitFor(() => expect(done(row(ready.container, "session"))).toBe(true));
  });

  it("e-book: the file in the product's lesson is an item", async () => {
    const ebook = {
      ...mocks.course,
      ...free,
      productFormat: "ebook" as const,
      modules: [{ id: "m1", title: "Your file", lessons: [{ id: "l1", title: "Workbook", type: "download" as const, description: "" }] }],
      lessonCount: 1,
    };
    const pending = renderHub(ebook);
    await screen.findByRole("heading", { name: ebook.title });
    await waitFor(() => expect(row(pending.container, "file")).not.toBeNull());
    expect(done(row(pending.container, "file"))).toBe(false);
    cleanup();

    vi.mocked(fetchCourseAssets).mockResolvedValueOnce([{
      id: "asset-1", courseId: "course-1", ownerId: "teacher-1", kind: "lesson_material",
      fileName: "workbook.pdf", contentType: "application/pdf", size: 1024,
      storagePath: "courses/course-1/workbook.pdf", isPreview: false, lessonId: "l1",
    } as CourseAsset]);
    const ready = renderHub(ebook);
    await screen.findByRole("heading", { name: ebook.title });
    await waitFor(() => expect(done(row(ready.container, "file"))).toBe(true));
    expect(fetchCourseAssets).toHaveBeenCalledWith("course-1");
  });
});

// Creating the product used to redirect in silence. Now the create screen sends
// ?created=1 and the builder shows the milestone banner once.
describe("milestone banner after creating (created=1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
    mocks.searchParams.set("created", "1");
  });

  afterEach(() => {
    cleanup();
    mocks.searchParams.delete("created");
    mocks.searchParams.delete("tab");
    vi.useRealTimers();
  });

  it("shows with the course's next step and removes the URL parameter", async () => {
    renderBuilder("content");

    const text = await screen.findByText("Draft saved. Next: your first lesson.");
    expect(text.closest(".created-strip")?.parentElement).toHaveAttribute("role", "status");
    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenCalledWith(
        "/teach/builder?courseId=course-1&tab=content",
        { scroll: false },
      ),
    );
  });

  it("closes on the X and does not come back", async () => {
    renderBuilder("content");
    await screen.findByText("Draft saved. Next: your first lesson.");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Draft saved. Next: your first lesson.")).toBeNull();
  });

  const STRIP = "Draft saved. Next: your first lesson.";

  it("disappears by itself in 4 seconds", () => {
    vi.useFakeTimers();
    renderBuilder("content");
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText(STRIP)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByText(STRIP)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText(STRIP)).toBeNull();
  });

  // NVDA and JAWS do not announce a live region that is born already filled.
  it("the role=status region is already mounted, empty, when the text enters", () => {
    vi.useFakeTimers();
    renderBuilder("content");
    const region = screen.getAllByRole("status").find((node) => node.classList.contains("absolute"))!;
    expect(region).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(0));
    expect(region).toHaveTextContent(STRIP);
    // Closed, the region is still there, just without content.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(region).toBeInTheDocument();
    expect(region).toBeEmptyDOMElement();
  });

  it("stops the clock with the pointer or focus on the banner", () => {
    vi.useFakeTimers();
    renderBuilder("content");
    act(() => vi.advanceTimersByTime(0));
    const strip = screen.getByText(STRIP).closest(".created-strip")!;

    fireEvent.mouseEnter(strip);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText(STRIP)).toBeInTheDocument();
    fireEvent.mouseLeave(strip);

    // Focus on the X: the banner does not vanish from under it (focus would fall on <body>).
    const close = screen.getByRole("button", { name: "Close" });
    act(() => close.focus());
    act(() => vi.advanceTimersByTime(10_000));
    expect(close).toHaveFocus();
    act(() => close.blur());

    // Solto, o relogio recomeca: 4s inteiros.
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByText(STRIP)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText(STRIP)).toBeNull();
  });

  // The course is born with "Module 1, Lesson 1": the banner becomes a shortcut to it and does not
  // disappear on its own (after 4s the button went out of reach).
  it("with the lesson that already exists, the banner leads to it and stays until used", () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, modules: [{ id: "m1", title: "Module 1", lessons: [{ id: "l1", title: "Lesson 1", description: "", type: "video" }] }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    vi.useFakeTimers();
    renderBuilder("content");
    act(() => vi.advanceTimersByTime(0));
    const open = screen.getByRole("button", { name: "Open your first lesson" });
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText(STRIP)).toBeInTheDocument();
    fireEvent.click(open);
    // (?created=1 is removed by router.replace, which here is a mock.)
    expect(mocks.router.push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/teach\/builder\?courseId=course-1&.*tab=content&module=m1&lesson=l1$/),
      { scroll: false },
    );
    expect(screen.queryByText(STRIP)).toBeNull();
  });

  // Pinned to the foot of the screen, the banner covered "Continue to…" and the footer of the
  // other tabs: outside the content tab it goes away.
  it("leaves when switching to another tab", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, modules: [{ id: "m1", title: "Module 1", lessons: [{ id: "l1", title: "Lesson 1", description: "", type: "video" }] }] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const view = renderBuilder("content");
    await screen.findByText(STRIP);
    mocks.searchParams.set("tab", "pricing");
    view.rerender(
      <I18nProvider initialLocale="en">
        <SwitchLanguage />
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    expect(screen.queryByText(STRIP)).toBeNull();
    // And it does not come back when returning to the content.
    mocks.searchParams.set("tab", "content");
    view.rerender(
      <I18nProvider initialLocale="en">
        <SwitchLanguage />
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    expect(screen.queryByText(STRIP)).toBeNull();
  });

  // The community has no "welcome post" in the builder; price exists
  // in every kind.
  it("in the community, the next step is the price", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, productFormat: "community", communityEnabled: true });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("content");
    expect(await screen.findByText("Draft saved. Next: set your price.")).toBeInTheDocument();
  });

  // The event sentence depends on the sessions, which arrive one network round trip after
  // the course. Before, the banner said "schedule" to someone who had already scheduled and swapped
  // the sentence in front of the screen reader.
  describe("live event: waits for the sessions before speaking", () => {
    const liveEvent = {
      ...mocks.course,
      paymentType: "free" as const,
      priceAmountMinor: 0,
      productFormat: "live_event" as const,
      modules: [],
      lessonCount: 0,
    };
    const session: CourseEvent = {
      id: "event-1", courseId: "course-1", courseSlug: "course-1", courseTitle: liveEvent.title,
      ownerId: "teacher-1", title: liveEvent.title, description: "", type: "live_class", status: "scheduled",
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), externalUrl: "",
      recordingAssetId: null,
    };

    beforeEach(() => {
      sessions.hold = true;
      vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
        emit(liveEvent);
        return Object.assign(() => {}, { reload: async () => {} });
      });
    });

    afterEach(() => {
      sessions.hold = false;
      sessions.held = null;
    });

    it("with a scheduled session: speaks only after the list, and says it is already on the calendar", () => {
      vi.useFakeTimers();
      renderBuilder("content");
      act(() => vi.advanceTimersByTime(0));
      expect(screen.queryByText(/^Draft saved\./)).toBeNull();

      act(() => sessions.held!([session]));
      act(() => vi.advanceTimersByTime(0));
      expect(screen.getByText("Draft saved. Your session is on the calendar.")).toBeInTheDocument();
      expect(screen.queryByText("Draft saved. Next: schedule your session.")).toBeNull();
    });

    it("without a session: speaks only after the list, and asks to schedule", () => {
      vi.useFakeTimers();
      renderBuilder("content");
      act(() => vi.advanceTimersByTime(0));
      expect(screen.queryByText(/^Draft saved\./)).toBeNull();

      act(() => sessions.held!([]));
      act(() => vi.advanceTimersByTime(0));
      expect(screen.getByText("Draft saved. Next: schedule your session.")).toBeInTheDocument();
    });
  });
});

// Wave D, review fixes: motion only on CHANGE, never on load.
describe("motion only on change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetSubscriptionCounts();
  });

  afterEach(() => {
    cleanup();
    profileGate.hold = false;
    profileGate.release = null;
    profileGate.onData = null;
    delete profileExtra.stripeConnectChargesEnabled;
    delete profileExtra.stripeConnectPayoutsEnabled;
    mocks.searchParams.delete("tab");
    vi.restoreAllMocks();
  });

  const paid = () =>
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, priceAmountMinor: 12000 });
      return Object.assign(() => {}, { reload: async () => {} });
    });
  const payoutsRow = () => screen.getAllByText("Stripe payouts")[0].closest("li")!;
  // The promise-based reads (verification flag, course files) are back.
  const settle = () => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  // P1: opening ?tab=review with the profile arriving after the course lit up
  // "Stripe payouts" in brass with nobody having done anything.
  it("the profile that arrives late does not light up a row or draw a check", async () => {
    profileGate.hold = true;
    Object.assign(profileExtra, { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true });
    paid();
    const { container } = renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    await settle();
    expect(payoutsRow().querySelector("[data-drawn-check]")).toBeNull();

    act(() => profileGate.release!());
    await waitFor(() => expect(payoutsRow().querySelector("[data-drawn-check]")).not.toBeNull());
    expect(container.querySelector(".is-just-done")).toBeNull();
    expect(container.querySelector(".drawn-check")).toBeNull();
  });

  it("what becomes ready with the tab open lights up once and the check draws itself", async () => {
    paid();
    const { container } = renderBuilder("review");
    await screen.findByRole("heading", { name: mocks.course.title });
    await settle();
    expect(container.querySelector(".is-just-done")).toBeNull();

    // Stripe finished the signup in another tab: the profile arrives again.
    act(() => profileGate.onData!({
      creatorVerificationStatus: "none",
      currentPlanId: "free",
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    }));
    await waitFor(() => expect(payoutsRow()).toHaveClass("is-just-done"));
    expect(payoutsRow().querySelector(".drawn-check")).not.toBeNull();
  });

  // P9: the panel came in sliding up on the first load too (and the trail's check
  // redrew itself on every visit).
  it("the panel only slides up on a tab switch; the initial load enters still", async () => {
    const view = renderBuilder("details");
    await screen.findByRole("heading", { name: mocks.course.title });
    await settle();
    expect(view.container.querySelector(".motion-panel-in")).toBeNull();
    expect(view.container.querySelector(".drawn-check")).toBeNull();

    mocks.searchParams.set("tab", "pricing");
    view.rerender(
      <I18nProvider initialLocale="en">
        <SwitchLanguage />
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    expect(view.container.querySelector(".motion-panel-in")).not.toBeNull();
  });

  // P6: with 0 modules the empty state said "Add your first lesson", but the only action
  // on the screen is the "Add your first module" form (opened on its own).
  it("course without a module: the empty state says the same as the action right below", async () => {
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({ ...mocks.course, modules: [] });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    renderBuilder("content");
    expect(await screen.findByRole("heading", { name: "Add your first module.", level: 4 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add your first module", level: 5 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create module" })).toBeInTheDocument();
    expect(screen.queryByText("Add your first lesson.")).toBeNull();
  });

  // C2: publishing waits for the network and the fields stay editable. Whoever went back to
  // typing in the title must not have the keys stolen by the brass button.
  it("publishing does not steal focus from someone who went back to typing in the title", async () => {
    let finishPublish: () => void = () => undefined;
    vi.mocked(publishTeacherCourse).mockImplementationOnce(
      () => new Promise<never>((resolve) => { finishPublish = () => resolve(undefined as never); }),
    );
    // Free and with one text lesson: Publish unlocks.
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emit({
        ...mocks.course,
        paymentType: "free",
        priceAmountMinor: 0,
        modules: [{ id: "m1", title: "Start here", lessons: [{ id: "l1", title: "Welcome", description: "", type: "text", contentText: "Read this first." }] }],
      });
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const view = renderBuilder("review");
    await publishProduct();
    await waitFor(() => expect(publishTeacherCourse).toHaveBeenCalled());

    // While the network responds: Details tab, click on the title.
    mocks.searchParams.set("tab", "details");
    view.rerender(
      <I18nProvider initialLocale="en">
        <SwitchLanguage />
        <CourseBuilderStudio />
      </I18nProvider>,
    );
    const title = screen.getByRole("textbox", { name: "Course title" });
    title.focus();
    await act(async () => finishPublish());

    // Published with another tab on screen: the panel goes at the top of that tab (the tab
    // does not switch under someone typing) and focus stays on the title.
    const copy = await screen.findByRole("button", { name: "Copy my page link" });
    expect(title).toHaveFocus();
    expect(copy).not.toHaveFocus();
    expect(document.getElementById("builder-sec-review")).toBeNull();
    expect(mocks.searchParams.get("tab")).toBe("details");
  });
});
