import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { TeacherMediaLibrary } from "@/components/teacher/teacher-media-library";
import { TeacherMembersAreaHub } from "@/components/teacher/teacher-members-area-hub";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { CourseAsset } from "@/domain/course-asset";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const state = vi.hoisted(() => ({
  user: { uid: "teacher" }, courses: [] as TeacherCourse[], assets: [] as CourseAsset[],
  courseError: false, assetError: false, loading: false, query: "", push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: state.push }),
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: vi.fn((_id, next, error) => {
    if (state.courseError) error(new Error("Raw course failure"));
    else if (!state.loading) next(state.courses);
    return vi.fn();
  }),
}));
vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn((_id, next, error) => {
    if (state.assetError) error(new Error("Raw asset failure")); else next(state.assets);
    return vi.fn();
  }),
}));
const course: TeacherCourse = {
  id: "course-1", ownerId: "teacher", title: "Original course $&", summary: "Original summary",
  category: "Other", status: "draft", lessonCount: 1,
  modules: [{ id: "module", title: "Original module", lessons: [] }],
  membersTheme: "dark", membersTitle: "Original welcome", communityEnabled: true,
  coverImageUrl: "/uploads/original-course.jpg",
};
const cover: CourseAsset = {
  id: "asset", courseId: "course-1", ownerId: "teacher", kind: "course_cover",
  fileName: "Original $&.jpg", size: 1536, contentType: "image/jpeg",
  storagePath: "private/original.jpg", downloadUrl: "/uploads/original.jpg", isPreview: false, lessonId: null,
};
function Language() {
  const { setLocale } = useTranslation();
  return <><button onClick={() => setLocale("en")}>EN</button><button onClick={() => setLocale("es")}>ES</button></>;
}
function mount(children: ReactNode) {
  return render(<I18nProvider initialLocale="es"><Language />{children}</I18nProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.courses = [course]; state.assets = [cover];
  state.query = ""; state.courseError = false; state.assetError = false; state.loading = false;
});
afterEach(cleanup);

describe("ES-12 media and members with real dictionaries", () => {
  it("requires the real namespaces, not fixture translations", () => {
    expect(translate(getDictionary("es"), "teacherMedia.eyebrow")).toBe("Biblioteca de archivos");
    expect(translate(getDictionary("es"), "teacherMembers.title")).toBe("Miembros y comunidades");
  });

  it("localizes filters, alt text and sizes; preserves names, URLs, kind values and search draft", () => {
    mount(<TeacherMediaLibrary />);
    expect(screen.getByRole("heading", { name: "Archivos del curso y recursos de las lecciones" })).toBeInTheDocument();
    const image = screen.getByRole("img", { name: "Portada del curso: Original $&.jpg" });
    expect(image).toHaveAttribute("src", "/uploads/original.jpg");
    expect(screen.getByText(/1,5 KB/)).toBeInTheDocument();
    expect(screen.getByText("Privado")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Curso" })).toHaveValue("course-1");
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo" }), { target: { value: "course_cover" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar recursos" }), { target: { value: "portada" } });
    expect(screen.getByText("Original $&.jpg")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Original $&" } });
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("searchbox", { name: "Search assets" })).toHaveValue("Original $&");
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("course_cover");
    expect(screen.getByText(/1.5 KB/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Course cover: Original $&.jpg" })).toHaveAttribute("src", "/uploads/original.jpg");
    expect(screen.getByRole("link", { name: "Open builder" })).toHaveAttribute("href", "/teach/builder?courseId=course-1&tab=content");
  });

  it("localizes nonimage MIME categories and private lesson metadata", () => {
    state.assets = [{ ...cover, kind: "lesson_material", contentType: "application/pdf",
      fileName: "Original.pdf", downloadUrl: null, lessonId: "lesson", isPreview: true }];
    mount(<TeacherMediaLibrary />);
    expect(screen.getByText("archivo")).toBeInTheDocument();
    expect(screen.getByText("Recurso de la lección")).toBeInTheDocument();
    expect(screen.getByText("Vista previa")).toBeInTheDocument();
    expect(screen.getByText("Original.pdf")).toBeInTheDocument();
  });

  it("localizes loading, no-course and empty-library copy", () => {
    state.loading = true;
    const loading = mount(<TeacherMediaLibrary />);
    expect(screen.getByText("Cargando biblioteca de archivos...")).toBeInTheDocument();
    loading.unmount();
    state.loading = false; state.courses = [];
    const empty = mount(<TeacherMediaLibrary />);
    expect(screen.getByRole("heading", { name: "Crea un curso antes de subir archivos." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear primer curso" })).toHaveAttribute("href", "/teach/builder?newCourse=1");
    empty.unmount();
    state.courses = [course]; state.assets = [];
    mount(<TeacherMediaLibrary />);
    expect(screen.getByRole("heading", { name: "Sube archivos desde el editor." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir área de subida del editor" })).toBeInTheDocument();
  });

  it.each(["courseError", "assetError"] as const)("relocalizes media %s", (failure) => {
    state[failure] = true;
    mount(<TeacherMediaLibrary />);
    expect(screen.getByRole("alert")).toHaveTextContent(failure === "courseError" ? "No pudimos cargar tus cursos." : "No pudimos cargar los recursos de este curso.");
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("alert")).toHaveTextContent(failure === "courseError" ? "We could not load your courses." : "We could not load assets for this course.");
  });

  it("localizes member metadata, singular counts and theme without translating course content", () => {
    mount(<TeacherMembersAreaHub />);
    expect(screen.getByRole("heading", { name: "Miembros y comunidades" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Tipo de contenido para miembros" })).toBeInTheDocument();
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent("Original course $&");
    expect(card).toHaveTextContent("1 módulo · 1 lección");
    expect(card).toHaveTextContent("tema oscuro");
    expect(card).toHaveTextContent("Bienvenida personalizada");
    expect(card).toHaveTextContent("Comunidad activada");
    expect(within(card).getByRole("link", { name: "Personalizar" }))
      .toHaveAttribute("href", "/teach/builder?courseId=course-1&tab=members");
    fireEvent.click(screen.getByRole("radio", { name: "Comunidades" }));
    expect(state.push).toHaveBeenCalledWith("/teach/members?view=communities");
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(card).toHaveTextContent("Original course $&");
    expect(card).toHaveTextContent("1 module · 1 lesson");
    expect(card).toHaveTextContent("dark theme");
  });

  it("localizes both empty member views and preserves creation routes", () => {
    state.courses = [];
    const spaces = mount(<TeacherMembersAreaHub />);
    expect(screen.getByText("Aún no hay espacios de productos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo producto" })).toHaveAttribute("href", "/teach/builder?newCourse=1&format=course");
    spaces.unmount();
    state.query = "view=communities";
    mount(<TeacherMembersAreaHub />);
    expect(screen.getByText("Aún no hay comunidades")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nueva comunidad" })).toHaveAttribute("href", "/teach/builder?newCourse=1&format=community");
  });

  it("relocalizes the existing members error", () => {
    state.courseError = true;
    mount(<TeacherMembersAreaHub />);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus áreas de miembros. Inténtalo de nuevo.");
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your members areas. Please try again.");
  });
});
