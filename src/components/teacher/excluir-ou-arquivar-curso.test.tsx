import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { DeleteOrArchiveCourseDialog } from "@/components/teacher/course-actions";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { TeacherCourseStudio } from "@/components/teacher/teacher-course-studio";
import type { TeacherCourse } from "@/domain/teacher-course";

// What the person suffered: the teacher could only delete a DRAFT, and only via the ⋮
// on the list. In the product hub — the screen where they spend the day — there was no action
// at all, and a published course only went offline if an admin unpublished it.
//
// These tests cover the new entry point (the menu in the hub header, in the same
// place as the Hotmart caret), the modal that changes text depending on whether the course has
// a buyer or not, and the two outcomes the server returns.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Facilitation foundations",
    summary: "Build a dependable practice for leading productive group sessions.",
    category: "Facilitation & Group Work",
    categories: ["Facilitation & Group Work"],
    status: "published",
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
    // The SAME object on every render: a new user per render resubscribes the
    // effects and enters a loop.
    user: { uid: "teacher-1", displayName: "Patricia", roles: ["teacher"] },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams(),
    deleteOrArchiveCourse: vi.fn(),
    getCourseAudience: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/teach",
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, status: "authenticated" }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: (_id: string, onData: (course: TeacherCourse) => void) => {
    onData(mocks.course);
    return () => undefined;
  },
  subscribeToTeacherCourses: (_uid: string, onData: (courses: TeacherCourse[]) => void) => {
    onData([mocks.course]);
    return () => undefined;
  },
  deleteOrArchiveCourse: mocks.deleteOrArchiveCourse,
  getCourseAudience: mocks.getCourseAudience,
  setOwnCourseFeatured: vi.fn(),
}));

vi.mock("@/lib/data/course-deletions", () => ({
  getMyCoursesBeingDeleted: () => Promise.resolve([]),
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

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (_uid: string, onData: (orders: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/enrollments", () => ({
  getMyCourseStudents: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: () => () => undefined,
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

vi.mock("@/lib/data/course-commerce", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  subscribeToCourseCoupons: (_id: string, onData: (coupons: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-reviews", () => ({
  getRecentCourseReviews: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/community-posts", () => ({
  getRecentCommunityQuestions: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (_uid: string, onData: (entries: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

function renderEn(ui: ReactElement) {
  return render(<I18nProvider initialLocale="en">{ui}</I18nProvider>);
}

const MENU_TRIGGER = "More actions for Facilitation foundations";

async function abreMenuDoHub() {
  renderEn(<CourseManageHub courseId="course-1" />);
  const trigger = await screen.findByRole("button", { name: MENU_TRIGGER });
  fireEvent.click(trigger);
  return screen.getByRole("menu", { name: "Actions for Facilitation foundations" });
}

async function abreModalDoHub() {
  const menu = await abreMenuDoHub();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete course" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete Facilitation foundations" });
  // The modal only enables the confirmation after it knows how many buyers exist.
  await waitFor(() => expect(mocks.getCourseAudience).toHaveBeenCalledWith("course-1"));
  await waitFor(() => expect(within(dialog).queryByText("Remove product")).toBeNull());
  return dialog;
}

beforeEach(() => {
  mocks.course.status = "published";
  mocks.router.push.mockReset();
  mocks.deleteOrArchiveCourse.mockReset();
  mocks.deleteOrArchiveCourse.mockResolvedValue({ outcome: "deleted" });
  mocks.getCourseAudience.mockReset();
  mocks.getCourseAudience.mockResolvedValue({ enrollments: 0, orders: 0, subscriptions: 0 });
});

afterEach(cleanup);

describe("course hub — delete/archive entry point", () => {
  // Hotmart puts the action in the caret next to "Trocar Produto". Here it sits in the
  // same place: next to the product selector and "Edit in Builder".
  it("offers new product, preview and delete, in that order, in the header", async () => {
    const menu = await abreMenuDoHub();
    const itens = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);

    expect(itens).toEqual(["New product", "Preview as a student", "Delete course"]);
    expect(within(menu).getByRole("menuitem", { name: "New product" })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=course",
    );
    expect(
      within(menu).getByRole("menuitem", { name: "Preview as a student" }),
    ).toHaveAttribute("href", "/teach/builder/course-1/preview");
  });

  // The list's ⋮ called `delete_teacher_course_draft` and vanished for anything that is not a
  // draft. Now it opens the SAME modal, for a published course too.
  it("the product list opens the same action, even with the course published", async () => {
    renderEn(<TeacherCourseStudio />);
    fireEvent.click(await screen.findByRole("button", { name: MENU_TRIGGER }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await screen.findByRole("dialog", { name: "Delete Facilitation foundations" });
    await waitFor(() => expect(mocks.getCourseAudience).toHaveBeenCalledWith("course-1"));
  });

  // "I bought and did not get in": the teacher needs a number to search for.
  // A real course id is a UUID and comes out short (see short-id.test); this
  // test's ("course-1") is not, so it comes out whole.
  it("the list and the product panel show the ID, with copy", async () => {
    const list = renderEn(<TeacherCourseStudio />);
    expect(await screen.findByRole("button", { name: "Copy course-1" })).toBeInTheDocument();
    expect(screen.getByText("Product ID")).toBeInTheDocument();
    list.unmount();

    renderEn(<CourseManageHub courseId="course-1" />);
    expect(await screen.findByRole("button", { name: "Copy course-1" })).toBeInTheDocument();
    expect(screen.getByText("course-1", { selector: "code" })).toBeInTheDocument();
  });
});

describe("the menu opens inward on the screen", () => {
  // jsdom does not measure layout: the trigger's rectangle and the window width are
  // simulated. What is proven is the math — a 224 px menu is never born outside
  // the window, on either side, and on desktop it aligns to the right of the
  // trigger as it always did.
  const MENU = 224;
  const GATILHO = 44;

  function simula(left: number, viewport: number) {
    const janela = window.innerWidth;
    window.innerWidth = viewport;
    const medida = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left,
      right: left + GATILHO,
      top: 0,
      bottom: 44,
      x: left,
      y: 0,
      width: GATILHO,
      height: 44,
      toJSON: () => ({}),
    } as DOMRect);
    return () => {
      medida.mockRestore();
      window.innerWidth = janela;
    };
  }

  // Left edge of the menu in window coordinates: the trigger is at `left`
  // and the menu is positioned relative to it.
  async function bordaEsquerdaDoMenu(left: number) {
    const menu = await abreMenuDoHub();
    return left + Number.parseFloat(menu.style.left);
  }

  it("on the phone, with the trigger on the left edge, the menu starts 8 px from the edge", async () => {
    const desfaz = simula(95, 390);
    try {
      expect(await bordaEsquerdaDoMenu(95)).toBe(8);
    } finally {
      desfaz();
    }
  });

  it("on the phone, with the trigger on the right edge, the menu does not go past the window", async () => {
    const desfaz = simula(340, 390);
    try {
      const x = await bordaEsquerdaDoMenu(340);
      expect(x + MENU).toBeLessThanOrEqual(390 - 8);
      expect(x).toBeGreaterThanOrEqual(8);
    } finally {
      desfaz();
    }
  });

  it("on desktop, with the trigger on the right edge, the menu aligns to its right", async () => {
    const desfaz = simula(1337, 1440);
    try {
      expect((await bordaEsquerdaDoMenu(1337)) + MENU).toBe(1337 + GATILHO);
    } finally {
      desfaz();
    }
  });
});

describe("delete/archive dialog — the text follows the data", () => {
  // The modal opened saying "Delete" in red and became "Archive" in blue
  // when the count arrived. Before it: neutral text and confirm locked.
  it("while the count has not arrived, does not promise to delete or archive", async () => {
    let answer!: (audience: { enrollments: number; orders: number; subscriptions: number }) => void;
    mocks.getCourseAudience.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const menu = await abreMenuDoHub();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete course" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Facilitation foundations" });

    expect(within(dialog).getByText("Remove product")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent("Facilitation foundations");
    const waiting = within(dialog).getByRole("button", { name: "Checking for buyers..." });
    expect(waiting).toBeDisabled();
    expect(waiting).not.toHaveClass("button-danger-solid");
    expect(within(dialog).queryByText("Delete this course?")).toBeNull();
    expect(within(dialog).queryByText("This course has students")).toBeNull();

    answer({ enrollments: 1, orders: 0, subscriptions: 0 });
    expect(await within(dialog).findByRole("button", { name: "Archive course" })).toBeEnabled();
    expect(within(dialog).queryByText("Remove product")).toBeNull();
  });

  it("with no buyer, warns that the deletion is permanent", async () => {
    const dialog = await abreModalDoHub();

    expect(within(dialog).getByText("Delete this course?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This permanently deletes the course and all its content. It can't be undone.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Yes, delete" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Archive course" })).toBeNull();
  });

  // Wave G2b: what goes away with it is written before the click, and the final button
  // looks like danger (solid red), not a red outline on a white background.
  it("with no buyer, lists what goes away, says when the cleanup starts and confirms in solid red", async () => {
    const dialog = await abreModalDoHub();

    await within(dialog).findByText("This also deletes:");
    for (const item of [
      "Lessons, texts and files",
      "Uploaded videos",
      "Community posts and replies",
      "Live sessions and pending invitations",
    ]) {
      expect(within(dialog).getByText(item).tagName).toBe("LI");
    }
    expect(
      within(dialog).getByText(
        'Files and videos are removed from our servers in hourly batches, starting about a day after you delete. Until then the product shows as "Being deleted". Anything another product still uses is kept.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Yes, delete" })).toHaveClass(
      "button-danger",
      "button-danger-solid",
    );
  });

  it("with a buyer, does not promise to delete anything and confirms in blue", async () => {
    mocks.getCourseAudience.mockResolvedValue({ enrollments: 1, orders: 0, subscriptions: 0 });
    const dialog = await abreModalDoHub();

    const archive = await within(dialog).findByRole("button", { name: "Archive course" });
    expect(archive).toHaveClass("button-solid");
    expect(archive).not.toHaveClass("button-danger-solid");
    expect(within(dialog).queryByText("This also deletes:")).toBeNull();
    expect(within(dialog).queryByText(/about a day after/)).toBeNull();
  });

  // Product with only a subscription: the server archives (a subscription counts as a buyer), and
  // the modal said "Yes, delete" and promised to delete files and videos.
  it("with only a subscription, also promises to archive, never delete", async () => {
    mocks.getCourseAudience.mockResolvedValue({ enrollments: 0, orders: 0, subscriptions: 1 });
    const dialog = await abreModalDoHub();

    expect(await within(dialog).findByRole("button", { name: "Archive course" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Yes, delete" })).toBeNull();
    expect(within(dialog).queryByText("This also deletes:")).toBeNull();
  });

  it("if the server refuses, says nothing was deleted (and no longer mentions draft)", async () => {
    mocks.deleteOrArchiveCourse.mockRejectedValue(new Error("23503"));
    const dialog = await abreModalDoHub();
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, delete" }));

    expect(
      await within(dialog).findByText(
        "We could not delete this product. Nothing was removed. Please try again or contact SkillsetMind support.",
      ),
    ).toBeInTheDocument();
  });

  it("with a buyer, promises to archive and keep access for whoever paid", async () => {
    mocks.getCourseAudience.mockResolvedValue({ enrollments: 3, orders: 3, subscriptions: 0 });
    const dialog = await abreModalDoHub();

    await within(dialog).findByText("This course has students");
    expect(
      within(dialog).getByText(/it will be archived: it leaves the store/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Students who already bought this course keep their access exactly as it is today.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Archive course" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Yes, delete" })).toBeNull();
  });
});

describe("delete/archive modal — the header X", () => {
  it("closes like Cancel, deleting nothing", async () => {
    const dialog = await abreModalDoHub();
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).toHaveClass("button-icon");

    fireEvent.click(close);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.deleteOrArchiveCourse).not.toHaveBeenCalled();
  });

  it("disappears while deleting, when Cancel is also locked", async () => {
    let fail!: (reason: unknown) => void;
    mocks.deleteOrArchiveCourse.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const dialog = await abreModalDoHub();
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled());
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    // Esc and clicking the backdrop follow the locked Cancel.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.getByRole("dialog", { name: "Delete Facilitation foundations" })).toBe(dialog);

    fail(new Error("23503"));
    expect(await within(dialog).findByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("what happens after the action", () => {
  it("once deleted, the hub leaves the scene and goes back to the list", async () => {
    const dialog = await abreModalDoHub();
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(mocks.deleteOrArchiveCourse).toHaveBeenCalledWith("course-1"));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith("/teach/builder"));
  });

  it("once archived, the hub stays up and shows how to republish", async () => {
    mocks.course.status = "inactive";
    mocks.getCourseAudience.mockResolvedValue({ enrollments: 3, orders: 3, subscriptions: 0 });
    mocks.deleteOrArchiveCourse.mockResolvedValue({
      outcome: "archived",
      enrollments: 3,
      orders: 3,
    });

    const dialog = await abreModalDoHub();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive course" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.router.push).not.toHaveBeenCalledWith("/teach/builder");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Facilitation foundations",
    );
    expect(screen.getByRole("link", { name: "Publish again" })).toBeInTheDocument();
  });
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));

// B-11: the page behind scrolled underneath the dialog. In the panel, what scrolls is the
// .platform-content, not the body.
describe("delete/archive dialog — the page behind it", () => {
  it("locks the scroll of .platform-content while open and restores it on close", async () => {
    const { unmount } = renderEn(
      <section className="platform-content">
        <DeleteOrArchiveCourseDialog courseId="course-1" courseTitle="Facilitation foundations" onCancel={vi.fn()} onDone={vi.fn()} />
      </section>,
    );
    const scroller = document.querySelector<HTMLElement>(".platform-content")!;
    await screen.findByRole("dialog", { name: "Delete Facilitation foundations" });
    expect(scroller.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("");
    unmount();
    expect(scroller.style.overflow).toBe("");
  });
});

// The buyer count that fails to load: "Try again" re-reads ONLY the count, and
// confirm stays locked until it arrives (without a count, neither delete nor archive).
describe("delete/archive modal — count that fails to load", () => {
  const deleteError = "We could not delete this product. Nothing was removed. Please try again or contact SkillsetMind support.";
  const audienceError = "We could not check who bought this product. Nothing was removed.";

  it("gets \"Try again\", re-reads the count just once and only then enables confirm", async () => {
    let resolve!: (value: { enrollments: number; orders: number; subscriptions: number }) => void;
    mocks.getCourseAudience
      .mockReset()
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderEn(<DeleteOrArchiveCourseDialog courseId="course-1" courseTitle="Facilitation foundations" onCancel={vi.fn()} onDone={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Delete Facilitation foundations" });
    // The count sentence, never the delete one: "Try again" does not try to delete.
    expect(await within(dialog).findByText(audienceError)).toBeInTheDocument();
    expect(within(dialog).queryByText(deleteError)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Yes, delete" })).toBeDisabled();

    const retry = within(dialog).getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    // Loading: the waiting rows and confirm still locked.
    expect(within(dialog).queryByText(audienceError)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Checking for buyers..." })).toBeDisabled();

    await act(async () => resolve({ enrollments: 0, orders: 0, subscriptions: 0 }));
    expect(within(dialog).getByRole("button", { name: "Yes, delete" })).toBeEnabled();
    expect(mocks.getCourseAudience).toHaveBeenCalledTimes(2);
    expect(mocks.deleteOrArchiveCourse).not.toHaveBeenCalled();
  });

  it("the delete failure does not get \"Try again\"", async () => {
    mocks.deleteOrArchiveCourse.mockRejectedValue(new Error("23503"));
    renderEn(<DeleteOrArchiveCourseDialog courseId="course-1" courseTitle="Facilitation foundations" onCancel={vi.fn()} onDone={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Delete Facilitation foundations" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Yes, delete" }));
    expect(await within(dialog).findByText(deleteError)).toBeInTheDocument();
    expect(within(dialog).queryByText(audienceError)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.getCourseAudience).toHaveBeenCalledTimes(1);
  });
});
