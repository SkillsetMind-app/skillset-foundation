import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherCourseStudio } from "@/components/teacher/teacher-course-studio";
import type { TeacherCourse } from "@/domain/teacher-course";

const authState = vi.hoisted(() => ({
  user: { uid: "teacher-1", roles: ["teacher"] },
}));

const mocks = vi.hoisted(() => ({
  deleteTeacherCourse: vi.fn(),
  push: vi.fn(),
  subscribeCalls: 0,
}));

const courses: TeacherCourse[] = [
  {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Facilitation foundations",
    summary: "Build a dependable practice for leading productive group sessions.",
    category: "Facilitation & Group Work",
    status: "draft",
    modules: [],
    lessonCount: 0,
    paymentType: "one_time",
    enrollmentCount: 12,
  },
  {
    id: "course-2",
    ownerId: "teacher-1",
    title: "Mentoring essentials",
    summary: "Create a clear and repeatable framework for meaningful mentoring conversations.",
    category: "Mentorship & Professional Growth",
    status: "draft",
    modules: [],
    lessonCount: 0,
    paymentType: "free",
    enrollmentCount: 5,
  },
  {
    id: "course-3",
    ownerId: "teacher-1",
    title: "Community leadership",
    summary: "Shape a welcoming member space with useful rituals and sustainable participation.",
    category: "Leadership & Management",
    status: "draft",
    modules: [],
    lessonCount: 0,
    paymentType: "subscription_monthly",
    communityEnabled: true,
  },
];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  deleteTeacherCourse: mocks.deleteTeacherCourse,
  subscribeToTeacherCourses: (
    _ownerId: string,
    onData: (nextCourses: TeacherCourse[]) => void,
  ) => {
    mocks.subscribeCalls += 1;
    if (mocks.subscribeCalls > 20) {
      throw new Error("subscribeToTeacherCourses entrou em loop de render");
    }
    onData(courses);
    return vi.fn();
  },
}));

async function renderStudio() {
  render(<TeacherCourseStudio />);
  return screen.findByRole("table", { name: "Products" });
}

describe("TeacherCourseStudio — lista de produtos", () => {
  beforeEach(() => {
    mocks.deleteTeacherCourse.mockReset();
    mocks.deleteTeacherCourse.mockResolvedValue(undefined);
    mocks.push.mockReset();
    mocks.subscribeCalls = 0;
  });

  // A pessoa recebia tres colunas sem nome e quarenta botoes em dez produtos.
  // O cabecalho e a acao principal unica tornam cada linha legivel e estavel.
  it("shows desktop column headers and keeps one primary action per course", async () => {
    const table = await renderStudio();

    expect(within(table).getByRole("columnheader", { name: "Product" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Access" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Students" })).toBeInTheDocument();

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    rows.forEach((row) => {
      expect(within(row).getAllByRole("link", { name: "Open" })).toHaveLength(1);
      expect(within(row).queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /More actions for/i })).toBeInTheDocument();
    });

    fireEvent.click(
      within(rows[0]).getByRole("button", { name: "More actions for Facilitation foundations" }),
    );
    const menu = screen.getByRole("menu", { name: "Actions for Facilitation foundations" });
    expect(within(menu).getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "View as student" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Duplicate" })).not.toBeInTheDocument();
  });

  // Confirmar no lugar dos botoes fazia a linha mudar de largura e empurrava
  // o restante da tabela. A decisao destrutiva agora vive numa janela propria.
  it("opens delete confirmation in a dialog without replacing row actions", async () => {
    const table = await renderStudio();
    const courseRow = within(table).getByRole("row", { name: /Facilitation foundations/i });
    const menuTrigger = within(courseRow).getByRole("button", {
      name: "More actions for Facilitation foundations",
    });

    fireEvent.click(menuTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    const dialog = screen.getByRole("dialog", { name: "Delete Facilitation foundations" });
    expect(dialog).toBeInTheDocument();
    expect(within(courseRow).getByRole("link", { name: "Open" })).toBeInTheDocument();
    expect(
      within(courseRow).getByRole("button", {
        name: "More actions for Facilitation foundations",
      }),
    ).toBeInTheDocument();
    expect(within(courseRow).queryByRole("button", { name: /Confirm delete/i })).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(menuTrigger).toHaveFocus();
  });

  // Os atalhos de navegacao ocupavam a primeira faixa e escondiam o assunto
  // da pagina. No DOM, a lista precisa vir antes deles para leitura e teclado.
  it("places workspace shortcuts after the product list", async () => {
    const table = await renderStudio();
    const shortcuts = screen.getByRole("navigation", { name: "Product workspace shortcuts" });

    expect(table.compareDocumentPosition(shortcuts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
