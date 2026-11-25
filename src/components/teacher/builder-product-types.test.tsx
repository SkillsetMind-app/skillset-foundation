import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { CourseAsset } from "@/domain/course-asset";
import type { CourseEvent } from "@/domain/course-event";
import type { TeacherCourse, TeacherCourseProductFormat } from "@/domain/teacher-course";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// The builder adapts to the type saved at creation (courses.product_format):
// community with optional lesson, event with the session in place of the lesson, e-book
// with only the file. Course stays the same.

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
    // Upcoming session: the old date (20/11/2026) expired and broke the test.
    startsAt: "2099-11-20T22:30:00.000Z",
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

// Required items of the "what is missing to publish" list.
async function requiredChecklist() {
  renderBuilder("review");
  const groups = await screen.findAllByText(/^(Content saved|Page prepared|Sale available)/);
  return groups.map((group) => group.closest("section") as HTMLElement);
}

beforeEach(() => {
  mocks.assets = [];
  mocks.sessions = [];
  // No price in Other prices: the pricing step shows the cards.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.searchParams.delete("module");
  mocks.searchParams.delete("lesson");
});

describe("community: optional lessons", () => {
  it("the content tab says a lesson is optional and still lets you create a module", async () => {
    mocks.course = product("community", false);
    renderBuilder("content");

    expect(await screen.findByText("Optional: add lessons or files.")).toBeInTheDocument();
    expect(screen.getByText("Add your first module")).toBeInTheDocument();
  });

  it("publishing does not require a module or lesson, only the community turned on", async () => {
    mocks.course = product("community", false);
    const [content] = await requiredChecklist();

    expect(within(content).queryByText("Module")).toBeNull();
    expect(within(content).queryByText("Lesson")).toBeNull();
    expect(within(content).getByText("Community turned on")).toBeInTheDocument();
  });
});

describe("live event: the session is the content", () => {
  it("without a session: says it is missing and leads to the Agenda with the form open", async () => {
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

  it("with a session: shows the date, warns about the missing link and leads to the Agenda to edit", async () => {
    mocks.course = product("live_event", false);
    mocks.sessions = [session()];
    renderBuilder("content");

    expect(await screen.findByText("Link not added yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit in the Agenda" })).toHaveAttribute(
      "href",
      "/teach/events?courseId=course-1",
    );
  });

  // A session that already passed is not sold: the server requires an upcoming session.
  it("a session that already passed does not count", async () => {
    mocks.course = product("live_event", false);
    mocks.sessions = [pastSession()];
    renderBuilder("content");

    expect(await screen.findByText("No session scheduled yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule the session" })).toBeInTheDocument();
  });

  it("publishing requires the session, not the lesson", async () => {
    mocks.course = product("live_event", false);
    const [content] = await requiredChecklist();

    expect(within(content).getByText("Live session")).toBeInTheDocument();
    expect(within(content).queryByText("Lesson")).toBeNull();
  });
});

describe("e-book: only the file", () => {
  it("the content tab shows the file upload, with no module, lesson or video", async () => {
    mocks.course = product("ebook", true);
    renderBuilder("content");

    expect(await screen.findByRole("heading", { name: "File to download" })).toBeInTheDocument();
    expect(screen.queryByText("Add your first module")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add module/i })).toBeNull();
    expect(screen.queryByRole("tablist", { name: /Lesson setup/i })).toBeNull();
    expect(screen.queryByText("Workbook")).toBeNull();
    expect(screen.queryByText(/1 module/i)).toBeNull();
  });

  // The upload "Open" link carries ?module&lesson; the e-book still has only files.
  it("with the lesson in the URL, it still shows only the file upload", async () => {
    mocks.course = product("ebook", true);
    mocks.searchParams.set("module", "m1");
    mocks.searchParams.set("lesson", "l1");
    renderBuilder("content");

    expect(await screen.findByRole("heading", { name: "File to download" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: /Lesson setup/i })).toBeNull();
    expect(screen.queryByText("Workbook")).toBeNull();
  });

  it("publishing requires a file and is ready when it arrives", async () => {
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

describe("course: same as before", () => {
  it("publishing requires a module and a lesson", async () => {
    mocks.course = product("course", false);
    const [content] = await requiredChecklist();

    expect(within(content).getByText("Module")).toBeInTheDocument();
    expect(within(content).getByText("Lesson")).toBeInTheDocument();
  });
});

// "How will people pay?": a single question, with the type's cards.
describe("how will people pay", () => {
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
    // Only the cards: the question's help button lives in the legend.
    return within(group)
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-pressed"))
      .map((button) => button.querySelector(".plan-card-title")?.textContent);
  }

  function pressed() {
    const group = screen.getByRole("group", { name: /How will people pay\?/ });
    return within(group)
      .getAllByRole("button", { pressed: true })
      .map((button) => button.querySelector(".plan-card-title")?.textContent);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["course", "one_time", ["Free", "One payment", "Monthly membership"], "One payment"],
    ["community", "subscription_monthly", ["Free", "Monthly membership"], "Monthly membership"],
    ["live_event", "one_time", ["Free", "Ticket"], "Ticket"],
    ["ebook", "one_time", ["Free", "One payment"], "One payment"],
  ] as const)("%s: the type's cards and what comes selected", async (format, paymentType, titles, selected) => {
    mocks.course = paid(format, paymentType, 0);
    renderBuilder("pricing");
    await screen.findByRole("group", { name: /How will people pay\?/ });

    expect(cardTitles()).toEqual(titles);
    expect(pressed()).toEqual([selected]);
    // The example in numbers, in the product's currency.
    if (format === "live_event") {
      expect(screen.getByRole("button", { name: /Ticket/ })).toHaveTextContent("Ex.: $300.");
    }
  });

  it("the fields only appear after choosing: free has none", async () => {
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

  it("monthly: the yearly option only opens when checked, with the savings calculated", async () => {
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
    // Manage reads the saved course: the link only appears with the monthly plan saved.
    expect(screen.queryByRole("link", { name: "Add the yearly plan" })).toBeNull();
    expect(await screen.findByRole("link", { name: "Add the yearly plan" }, { timeout: 4000 })).toHaveAttribute(
      "href",
      "/teach/courses/course-1/manage?section=pricing&addPrice=yearly&amount=29000",
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Price per year" }), { target: { value: "348" } });
    expect(screen.getByText("This costs the same as 12 monthly payments, or more.")).toBeInTheDocument();
  });

  // Each payment form already saved lands on a card and the screen saves nothing
  // on its own.
  it.each([
    ["course", "free", 0, {}, "Free", null, null],
    ["course", "one_time", 14900, { installmentsEnabled: true, installmentsMax: 6 }, "One payment", "Price", "149"],
    ["course", "subscription_monthly", 2900, {}, "Monthly membership", "Price per month", "29"],
    ["course", "subscription_yearly", 29000, {}, "Monthly membership", "Price per year", "290"],
    ["community", "subscription_yearly", 29000, {}, "Monthly membership", "Price per year", "290"],
    ["live_event", "one_time", 4900, {}, "Ticket", "Price", "49"],
    ["ebook", "one_time", 1900, {}, "One payment", "Price", "19"],
  ] as const)("existing product %s/%s: right card, same price and nothing saved", async (format, paymentType, price, extra, selected, field, value) => {
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

  // Live product that charges per year: "Charge every month instead" clears the
  // value. Saving like that left the price null and entry free.
  it("published yearly product: switching to monthly does not save without a value", async () => {
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

  // With no saved form and no value, checkout and the database read free.
  it("old product with no form and no value: shows as free and nothing saved", async () => {
    vi.useFakeTimers();
    mocks.course = paid("community", undefined, undefined as unknown as number, { status: "published" });
    renderBuilder("pricing");
    await act(async () => {});

    expect(pressed()).toEqual(["Free"]);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  // With a main price in Other prices, checkout charges that. The cards
  // here would only change the builder: the step says what the page charges and links
  // there, and does not let it become Free with the charge still active.
  describe("with a main price in Other prices", () => {
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
      ["the same model", "one_time", 9700],
      ["a builder that says free", "free", 0],
      ["a builder that says monthly", "subscription_monthly", 2900],
    ] as const)("with %s: shows what the page charges, without cards or fields", async (_label, paymentType, price) => {
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

    it("an inactive offer does not count: the cards come back", async () => {
      stubOffers([{ ...main, active: false }]);
      mocks.course = paid("course", "one_time", 9700);
      renderBuilder("pricing");

      expect(await screen.findByRole("group", { name: /How will people pay\?/ })).toBeInTheDocument();
      expect(screen.queryByText(/^Your page charges/)).toBeNull();
    });

    // Without the list, the main price is unknown: the cards would only change the
    // builder. The route returns 200 with a warning when the read fails.
    it.each([
      ["the read fails", { ok: false, json: async () => ({}) }],
      ["the route warns it did not read", { ok: true, json: async () => ({ offers: [], warning: "Offers are unavailable." }) }],
    ])("when %s: no cards, and Try again reads again", async (_label, response) => {
      vi.stubGlobal("fetch", vi.fn(async () => response));
      mocks.course = paid("course", "one_time", 9700, { status: "published" });
      renderBuilder("pricing");

      expect(await screen.findByText("Couldn't load your prices.")).toHaveAttribute("role", "alert");
      expect(screen.queryByRole("group", { name: /How will people pay\?/ })).toBeNull();
      expect(screen.queryByRole("textbox", { name: /Price/ })).toBeNull();
      expect(screen.queryByText("$97")).toBeNull();

      // The same read, again, without reloading the page.
      stubOffers([]);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("group", { name: /How will people pay\?/ })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    // Someone who is not the course owner (platform staff) does not read the prices: the route
    // returns 403. The step says so, instead of an error with "Try again".
    it("someone who is not the course owner sees the notice, with no error and no Try again", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Only the course owner can list offers." }) })));
      mocks.course = paid("course", "one_time", 9700, { status: "published", ownerId: "another-teacher" });
      renderBuilder("pricing");

      expect(await screen.findByText("Only the course owner can see and change these prices.")).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load your prices.")).toBeNull();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    // While the list arrives: one block per card, in their place, and the three
    // course cards on a single row (in two columns the third was left over).
    it("loading: blocks in place of the cards; loaded: three columns", async () => {
      let answer!: (value: unknown) => void;
      vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { answer = resolve; })));
      mocks.course = paid("course", "one_time", 9700);
      renderBuilder("pricing");

      const waiting = await screen.findByText("Loading prices...");
      const skeleton = waiting.closest('[role="status"]')!;
      expect(skeleton.querySelectorAll(".h-28")).toHaveLength(3);
      expect(skeleton.querySelector(".md\\:grid-cols-3")).not.toBeNull();

      await act(async () => answer({ ok: true, json: async () => ({ offers: [] }) }));
      const group = await screen.findByRole("group", { name: /How will people pay\?/ });
      expect(group.querySelector(".md\\:grid-cols-3")).not.toBeNull();
      expect(screen.queryByText("Loading prices...")).toBeNull();
      expect(group.querySelector(".display-title")).toBeNull();
    });

    // Tab opened before the main price: another tab creates the price, and when coming back
    // to this one the step reads again and shows what the page charges.
    it("when returning to the tab, it reads again: the cards go away", async () => {
      mocks.course = paid("course", "subscription_monthly", 2900);
      renderBuilder("pricing");
      await screen.findByRole("group", { name: /How will people pay\?/ });
      expect(screen.getByText("$29 / month")).toBeInTheDocument();

      stubOffers([main]);
      fireEvent.focus(window);

      expect(await screen.findByText(/^Your page charges \$97 \(One payment\)\./)).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: /How will people pay\?/ })).toBeNull();
      // The summary beside it also says what the page charges.
      expect(screen.queryByText("$29 / month")).toBeNull();
      expect(screen.getByText("$97")).toBeInTheDocument();
    });

    // A re-read on focus that fails does not erase the good list from the screen: the notice with
    // "Try again" appears above it, as in every list.
    it("a re-read that fails keeps the prices on screen, with Try again", async () => {
      stubOffers([main]);
      mocks.course = paid("course", "one_time", 9700, { status: "published" });
      renderBuilder("pricing");
      expect(await screen.findByText(/^Your page charges \$97 \(One payment\)\./)).toBeInTheDocument();

      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
      fireEvent.focus(window);

      expect(await screen.findByText("Couldn't refresh your prices. These are the last ones loaded.")).toHaveAttribute("role", "alert");
      expect(screen.getByText(/^Your page charges \$97 \(One payment\)\./)).toBeInTheDocument();
      expect(screen.getByText("$97")).toBeInTheDocument();

      // While it tries again, the notice stays, with the button waiting.
      let answer!: (value: unknown) => void;
      vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { answer = resolve; })));
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.getByText("Couldn't refresh your prices. These are the last ones loaded.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute("aria-busy", "true");
      // RetryAlert keeps the ring's place: the same name on both faces.
      expect(screen.getByRole("button", { name: "Try again" }).querySelectorAll('[class*="grid-area"]')).toHaveLength(2);
      await act(async () => answer({ ok: true, json: async () => ({ offers: [main] }) }));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(screen.getByText(/^Your page charges \$97 \(One payment\)\./)).toBeInTheDocument();
    });

    // The kept list also feeds the Save rule: live product, charged
    // by the offer and with no value in the builder. Before, the failure became "unknown
    // price" and Save was refused ("livePrice"); now the last good
    // list applies, and Save saves.
    it("live product charged by the offer: with the re-read failing, Save still saves", async () => {
      stubOffers([main]);
      mocks.course = paid("course", "one_time", 0, { status: "published" });
      renderBuilder("pricing");
      expect(await screen.findByText(/^Your page charges \$97 \(One payment\)\./)).toBeInTheDocument();

      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
      fireEvent.focus(window);
      await screen.findByText("Couldn't refresh your prices. These are the last ones loaded.");

      fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledOnce());
    });
  });

  // Product created before the rule: the screen shows what it is and warns.
  it("old community with one-time payment: the card shows up, with the notice", async () => {
    mocks.course = paid("community", "one_time", 9900);
    renderBuilder("pricing");
    await screen.findByRole("group", { name: /How will people pay\?/ });

    expect(cardTitles()).toEqual(["Free", "One payment", "Monthly membership"]);
    expect(pressed()).toEqual(["One payment"]);
    expect(screen.getByText("This option does not fit this type of product. Pick another one to publish.")).toBeInTheDocument();
  });
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
