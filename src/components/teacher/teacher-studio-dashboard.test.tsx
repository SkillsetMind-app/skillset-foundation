import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";

const { mockUser, state, data } = vi.hoisted(() => {
  const state = {
    courses: [] as unknown[],
    orders: [] as unknown[],
    profile: { creatorVerificationStatus: "none" } as Record<string, unknown>,
    requireVerification: false,
    // When set, it replaces the verification adjustment response (to
    // hold the read and see the "loading" state).
    verificationFlag: null as Promise<boolean> | null,
    activationBlocked: false,
    // No active plan and no trial in progress: the plan step enters the list.
    planRequired: false,
    ordersFail: false,
  };

  return {
    mockUser: {
      uid: "teacher-1",
      displayName: "Patrick Simon",
      roles: ["teacher"],
    },
    state,
    // Spies, not just stubs: the proof that the Home reads each piece of data ONCE counts
    // the calls to these three functions.
    data: {
      subscribeToTeacherCourses: vi.fn(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the real signature has the 3rd argument (error)
        (_uid: string, onData: (courses: unknown[]) => void, _onError?: (error: Error) => void) => {
          onData(state.courses);
          return () => undefined;
        },
      ),
      subscribeToTeacherOrders: vi.fn(
        (_uid: string, onData: (orders: unknown[]) => void, onError?: (error: Error) => void) => {
          const read = () => {
            if (state.ordersFail) onError?.(new Error("offline"));
            else onData(state.orders);
          };
          read();
          // Like the real one: `reload` re-reads without touching the channel.
          return Object.assign(() => undefined, { reload: async () => read() });
        },
      ),
      subscribeToUserProfile: vi.fn(
        (_uid: string, onData: (profile: unknown) => void) => {
          onData(state.profile);
          return () => undefined;
        },
      ),
      fetchCreatorActivationBlocked: vi.fn(() => Promise.resolve(state.activationBlocked)),
    },
  };
});

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    user: mockUser,
  }),
}));

// No i18n mock: outside the I18nProvider, useTranslation falls back to the real
// English dictionary. The old mock returned the raw KEY for everything that was not
// in the map, and the Home now reads every label from the dictionary.

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: data.subscribeToTeacherCourses,
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: data.subscribeToTeacherOrders,
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () =>
    state.verificationFlag ?? Promise.resolve(state.requireVerification),
  fetchCreatorActivationBlocked: data.fetchCreatorActivationBlocked,
}));

vi.mock("@/lib/data/enrollments", () => ({
  getMyCourseStudents: () => Promise.resolve([]),
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

vi.mock("@/lib/data/user-profiles", () => ({
  claimWelcomeTour: vi.fn(async () => false),
  subscribeToUserProfile: data.subscribeToUserProfile,
}));

function course(fields: Record<string, unknown>) {
  return {
    id: "c1",
    title: "Breathwork Basics",
    summary: "",
    category: "",
    status: "draft",
    modules: [],
    lessonCount: 1,
    coverImageUrl: null,
    paymentType: "one_time",
    priceAmountMinor: 4900,
    ...fields,
  };
}

async function stepLabels() {
  const list = await screen.findByRole("list", { name: "Creator next steps" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector("strong")?.textContent);
}

// The open step: highlighted in its own place in the list, with the button. It was the
// "Recommended now" panel, which repeated the title and the sentence of the same step.
function currentStep() {
  const step = document.querySelector<HTMLElement>('li[aria-current="step"]');
  if (!step) throw new Error("no open step");
  return step;
}

beforeEach(() => {
  state.courses = [];
  state.orders = [];
  state.profile = { creatorVerificationStatus: "none" };
  state.requireVerification = false;
  state.verificationFlag = null;
  state.activationBlocked = false;
  state.planRequired = false;
  state.ordersFail = false;
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("TeacherStudioDashboard", () => {
  it("a sales read that fails: error with 'Try again', which re-reads without opening another subscription", async () => {
    state.courses = [course({ status: "published" })];
    state.ordersFail = true;
    render(<TeacherStudioDashboard />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load your products or sales.");
    state.ordersFail = false;
    await act(async () => {
      screen.getByRole("button", { name: "Try again" }).click();
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(data.subscribeToTeacherOrders).toHaveBeenCalledTimes(1);
  });

  // The same four types as the creation screen. Free, subscription and guided
  // program stopped being a type.
  it("routes each of the four product types to the creation screen", async () => {
    // The formats are shortcuts for those who already have a product (on the 1st visit they go away).
    state.courses = [course({})];
    render(<TeacherStudioDashboard />);

    const formats = (
      await screen.findByRole("heading", { name: "Choose a product format" })
    ).closest("section") as HTMLElement;
    const links = within(formats).getAllByRole("link");
    expect(links.map((link) => link.querySelector("h3")?.textContent)).toEqual([
      "Course",
      "Community",
      "Live event",
      "Digital download",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/teach/builder?newCourse=1&format=course",
      "/teach/builder?newCourse=1&format=community",
      "/teach/builder?newCourse=1&format=live_event",
      "/teach/builder?newCourse=1&format=ebook",
    ]);
    expect(within(formats).queryByText(/Guided program|Subscription|Free program/)).toBeNull();
  });

  // The panel with 0 products was a dashed strip with "No products in this
  // view yet.". Now it is the first-product scene and the only brass button.
  it("no product: the first-product scene and the brass create button", async () => {
    render(<TeacherStudioDashboard />);

    const heading = await screen.findByRole("heading", { name: "Your first product starts here." });
    const box = heading.closest(".border-dashed") as HTMLElement;
    expect(box.querySelector('svg[data-scene="firstProduct"]')).toHaveAttribute("aria-hidden", "true");
    const create = within(box).getByRole("link", { name: "Create my first product" });
    expect(create).toHaveClass("button-accent");
    expect(create).toHaveAttribute("href", "/teach/builder?newCourse=1&format=course");
    expect(screen.queryByText("No products in this view yet.")).toBeNull();
  });

  // 1st visit: four strong buttons, five filters over an empty list and four
  // formats competed with "Create my first product". Now it is the only one.
  it("no product: the filter, 'Show all' and the formats go away; the empty state holds the only strong button", async () => {
    render(<TeacherStudioDashboard />);

    await screen.findByRole("heading", { name: "Your first product starts here." });
    expect(screen.queryByRole("group", { name: "Product filters" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drafts" })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("link", { name: /Show all/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Choose a product format" })).toBeNull();
    expect(screen.queryByText("Revenue, 30d")).toBeNull();
    expect(screen.getByRole("link", { name: "New product" })).toHaveClass("button-outline");
    expect(screen.getByRole("link", { name: "Edit storefront" })).not.toHaveClass("button-solid");
    // The "create" step is highlighted, but with no button of its own: the one in the empty state is enough.
    await waitFor(() => expect(currentStep()).toHaveTextContent("Create a product"));
    expect(currentStep().querySelector(".button-solid")).toBeNull();
    expect(document.querySelectorAll(".button-solid")).toHaveLength(0);
  });

  it("with a product: the filters, 'Show all' and the solid 'New product' come back", async () => {
    state.courses = [course({})];
    render(<TeacherStudioDashboard />);

    expect(await screen.findByRole("group", { name: "Product filters" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Show all/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New product" })).toHaveClass("button-solid");
  });

  // The product filters are a filter, not section tabs: the house segmented
  // selector (aria-pressed), the same as the period one.
  it("product filters mark the choice with aria-pressed and filter the list", async () => {
    state.courses = [course({ title: "Draft course", status: "draft" }), course({ id: "live", title: "Live course", status: "published" })];
    render(<TeacherStudioDashboard />);

    const group = await screen.findByRole("group", { name: "Product filters" });
    const all = within(group).getByRole("button", { name: "All" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Drafts" }));
    expect(within(group).getByRole("button", { name: "Drafts" })).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
    const products = screen.getByRole("region", { name: "Products in your workspace" });
    expect(within(products).queryByText("Live course")).toBeNull();
    expect(within(products).getByText("Draft course")).toBeInTheDocument();
  });
});

// What the person suffered: step 2 only closed with an APPROVED verification and
// sent them to /teach/verification, which nobody requires; there was no
// publish step; progress stopped at 67% and the "Recommended now" was
// the verification. The steps are now the real publish gates.
describe("Teacher home: the steps are the real publish gates", () => {
  it("new teacher: create and publish, no Stripe or verification", async () => {
    render(<TeacherStudioDashboard />);

    expect(await stepLabels()).toEqual(["Create a product", "Publish your product"]);
    expect(screen.getByText("0 of 2 complete")).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Create a product");
    // The step sentence shows up only once (the panel beside it repeated it).
    expect(screen.getAllByText(/Choose the delivery and access model/)).toHaveLength(1);
    expect(screen.queryByText("Recommended now")).toBeNull();
  });

  // The card is only asked for after creating: the free trial is required to
  // publish, not to build the product.
  it("no plan: create comes before the plan, and the plan opens the plan cards", async () => {
    state.planRequired = true;
    render(<TeacherStudioDashboard />);

    await waitFor(async () =>
      expect(await stepLabels()).toEqual(["Create a product", "Creator plan", "Publish your product"]),
    );
    expect(currentStep()).toHaveTextContent("Create a product");
  });

  it("no plan and with a product: the recommended one is the plan, at /account/plans", async () => {
    state.planRequired = true;
    state.courses = [course({ paymentType: "free", priceAmountMinor: 0 })];
    render(<TeacherStudioDashboard />);

    await waitFor(() => expect(currentStep()).toHaveTextContent("Creator plan"));
    expect(within(currentStep()).getByRole("link", { name: "See plans" })).toHaveAttribute(
      "href",
      "/account/plans",
    );
  });

  it("paid course in draft: Stripe comes before publish and becomes the recommended one", async () => {
    state.courses = [course({})];

    render(<TeacherStudioDashboard />);

    expect(await stepLabels()).toEqual([
      "Create a product",
      "Connect Stripe",
      "Publish your product",
    ]);
    const steps = screen.getByRole("list", { name: "Creator next steps" });
    // The sentence that LIVED in the permanent yellow strip at the top of /teach.
    expect(within(steps).getByText(/buyers are charged on it directly/i)).toBeInTheDocument();
    expect(screen.getByText("1 of 3 complete")).toBeInTheDocument();
    expect(currentStep()).toHaveTextContent("Connect Stripe");
    expect(within(currentStep()).getByRole("link", { name: /Connect Stripe/ })).toHaveClass("button-solid");
    // The Stripe sentence shows up only once on the screen.
    expect(screen.getAllByText(/buyers are charged on it directly/i)).toHaveLength(1);
    expect(within(currentStep()).getByRole("link", { name: /Connect Stripe/ })).toHaveAttribute(
      "href",
      "/account/payments#stripe-connect",
    );
  });

  it("Stripe ready: the recommended one is publish, in the course's publish panel", async () => {
    state.courses = [course({})];
    state.profile = {
      creatorVerificationStatus: "none",
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    };

    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getByText("2 of 3 complete")).toBeInTheDocument();
    });
    expect(currentStep()).toHaveTextContent("Publish your product");
    expect(within(currentStep()).getByRole("link", { name: /Review and publish/ })).toHaveAttribute(
      "href",
      "/teach/builder?courseId=c1&tab=review",
    );
  });

  it("free course does not ask for Stripe", async () => {
    state.courses = [course({ paymentType: "free", priceAmountMinor: 0 })];

    render(<TeacherStudioDashboard />);

    expect(await stepLabels()).toEqual(["Create a product", "Publish your product"]);
  });

  it("verification only enters when the platform requires it", async () => {
    state.requireVerification = true;

    render(<TeacherStudioDashboard />);

    await waitFor(async () => {
      expect(await stepLabels()).toEqual([
        "Create a product",
        "Professional verification",
        "Publish your product",
      ]);
    });
    const steps = screen.getByRole("list", { name: "Creator next steps" });
    expect(
      within(steps).getByRole("link", { name: /Professional verification/ }),
    ).toHaveAttribute("href", "/teach/verification");
  });

  // With everything done, the block stayed at 100% recommending "Publish your product"
  // to someone who had already published and sold.
  it("published and with Stripe: arriving with everything done, the steps block leaves the screen", async () => {
    state.courses = [course({ status: "published" })];
    state.profile = {
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    };

    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.queryByRole("list", { name: "Creator next steps" })).toBeNull();
    });
    expect(screen.queryByText("100%")).toBeNull();
    expect(screen.queryByText("Get ready for your first sale")).toBeNull();
    expect(screen.queryByText(/Review and publish/)).toBeNull();
  });

  // With the fee required and unpaid, the Home sent "Review and publish" and the
  // server refused with "Pay the one-time activation fee...".
  it("activation fee pending: publish warns of the one-time fee and says 'Activate and publish'", async () => {
    state.courses = [course({})];
    state.profile = { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true };
    state.activationBlocked = true;

    render(<TeacherStudioDashboard />);

    await waitFor(() =>
      expect(
        within(currentStep()).getByRole("link", { name: /Activate and publish/ }),
      ).toHaveAttribute("href", "/teach/builder?courseId=c1&tab=review"),
    );
    expect(within(currentStep()).getByText(/one-time US\$25 activation fee/)).toBeInTheDocument();
  });

  it("fee paid or not required: publish without a fee notice", async () => {
    state.courses = [course({})];
    state.profile = { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true };

    render(<TeacherStudioDashboard />);

    await waitFor(() =>
      expect(
        within(currentStep()).getByRole("link", { name: /Review and publish/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/activation fee/)).toBeNull();
  });

  it("archived paid course does not ask for Stripe nor become an urgent alert", async () => {
    // Archiving is status "inactive": the course left sale.
    state.courses = [course({ status: "inactive" })];

    render(<TeacherStudioDashboard />);

    // With no Stripe step, create and publish are already done: the block leaves.
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Creator next steps" })).toBeNull(),
    );
    expect(screen.queryByText(/Connect Stripe/)).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "What needs your attention today." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Finish your Stripe setup")).toBeNull();
  });

  // Before the gates arrive the list still changes: "1 of 2" and "50%" would become
  // "1 of 3", and for someone with everything ready the block appeared and vanished. Now the
  // block only enters with the data ready, already with the right count.
  it("while the gates load, the steps block does not show up", async () => {
    let resolveFlag: (value: boolean) => void = () => undefined;
    state.verificationFlag = new Promise<boolean>((resolve) => {
      resolveFlag = resolve;
    });
    state.courses = [course({ paymentType: "free", priceAmountMinor: 0 })];

    render(<TeacherStudioDashboard />);

    await screen.findByRole("heading", { name: "Products in your workspace" });
    expect(screen.queryByRole("list", { name: "Creator next steps" })).toBeNull();
    expect(screen.queryByText(/of \d complete/)).toBeNull();
    expect(screen.queryByText("Create a product", { selector: "strong" })).toBeNull();

    resolveFlag(true);

    const section = (await screen.findByRole("list", { name: "Creator next steps" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(section).getByText("1 of 3 complete")).toBeInTheDocument();
    expect(within(section).getByText("33%")).toBeInTheDocument();
  });

  // The block enters ~0.6 s after the product list; with no reserved space, "My
  // products" dropped hundreds of pixels on the phone. The height from the last visit
  // (same person, same screen width) holds the place until the data arrives.
  describe("place reserved while the gates load", () => {
    function holdGates() {
      let release: (value: boolean) => void = () => undefined;
      state.verificationFlag = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      state.courses = [course({ paymentType: "free", priceAmountMinor: 0 })];
      return (value: boolean) => release(value);
    }
    function saveHeight(fields: { uid?: string; w?: number; h: number }) {
      window.localStorage.setItem(
        "skillset.studio.nextStepsHeight.v1",
        JSON.stringify({ uid: "teacher-1", w: window.innerWidth, ...fields }),
      );
    }
    const placeholder = () => document.querySelector<HTMLElement>('[data-reserved="next-steps"]');

    it("with the last visit's height: reserves the place and swaps for the block when the data arrives", async () => {
      const release = holdGates();
      saveHeight({ h: 312 });
      render(<TeacherStudioDashboard />);

      await screen.findByRole("heading", { name: "Products in your workspace" });
      expect(placeholder()?.style.height).toBe("312px");
      expect(placeholder()).toHaveAttribute("aria-hidden", "true");
      expect(screen.queryByRole("list", { name: "Creator next steps" })).toBeNull();

      // jsdom does not measure: today's block height comes from here.
      const offset = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(280);
      release(true);

      await screen.findByRole("list", { name: "Creator next steps" });
      expect(placeholder()).toBeNull();
      // Today's visit records its height for the next one.
      await waitFor(() =>
        expect(JSON.parse(window.localStorage.getItem("skillset.studio.nextStepsHeight.v1") ?? "{}")).toEqual({
          uid: "teacher-1",
          w: window.innerWidth,
          h: 280,
        }),
      );
      offset.mockRestore();
    });

    it("arriving with everything done: records 0, and the next visit reserves nothing", async () => {
      saveHeight({ h: 312 });
      state.courses = [course({ status: "published" })];
      state.profile = { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true };
      render(<TeacherStudioDashboard />);

      await waitFor(() =>
        expect(JSON.parse(window.localStorage.getItem("skillset.studio.nextStepsHeight.v1") ?? "{}").h).toBe(0),
      );
      expect(screen.queryByRole("list", { name: "Creator next steps" })).toBeNull();
    });

    it.each([
      ["outra largura de tela", { w: window.innerWidth + 200, h: 312 }],
      ["outra pessoa neste aparelho", { uid: "someone-else", h: 312 }],
      ["o bloco nao aparecia na ultima visita", { h: 0 }],
    ])("%s: reserves nothing", async (_label, fields) => {
      holdGates();
      saveHeight(fields);
      render(<TeacherStudioDashboard />);

      await screen.findByRole("heading", { name: "Products in your workspace" });
      expect(placeholder()).toBeNull();
    });
  });

  it.each([
    ["none", "Start verification"],
    ["pending", "In review"],
    ["needs_changes", "Edit application"],
    ["rejected", "Edit application"],
  ])("verification '%s': the button says '%s'", async (status, action) => {
    state.requireVerification = true;
    state.courses = [course({ paymentType: "free", priceAmountMinor: 0 })];
    state.profile = { creatorVerificationStatus: status };

    render(<TeacherStudioDashboard />);

    await waitFor(() =>
      expect(
        within(currentStep()).getByRole("link", { name: new RegExp(action) }),
      ).toHaveAttribute("href", "/teach/verification"),
    );
  });
});

// Three "next step" lists competed for the same screen: the steps, the milestones
// and the attention list (which flagged Stripe as URGENT before any
// course existed).
describe("Teacher home: before the 1st publish only the steps list guides", () => {
  it("draft: no milestones and no attention list", async () => {
    state.courses = [course({})];

    render(<TeacherStudioDashboard />);

    await screen.findByRole("list", { name: "Creator next steps" });
    expect(screen.queryByRole("heading", { name: "Creator milestones" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "What needs your attention today." }),
    ).toBeNull();
    expect(screen.queryByText("Finish your Stripe setup")).toBeNull();
    // The products and the formats stay.
    expect(
      screen.getByRole("heading", { name: "Products in your workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose a product format" })).toBeInTheDocument();
  });

  // The milestones ("Creator milestones") were the same steps list again.
  it("after the 1st publish the attention list comes back; the milestones no longer exist", async () => {
    state.courses = [course({ status: "published", paymentType: "free", priceAmountMinor: 0 })];

    render(<TeacherStudioDashboard />);

    expect(
      await screen.findByRole("heading", { name: "What needs your attention today." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Creator milestones" })).toBeNull();
    // Only a free product: no "urgent" Stripe.
    expect(screen.queryByText("Finish your Stripe setup")).toBeNull();
  });

  // "Connect Stripe" showed up 4 times: in the step, in the panel beside it, in the milestones
  // and in the urgent card "Finish your Stripe setup". Only the open step stays.
  it("paid product live without Stripe: the pending item shows up once, in the open step", async () => {
    state.courses = [course({ status: "published" })];

    render(<TeacherStudioDashboard />);

    await waitFor(() => expect(currentStep()).toHaveTextContent("Connect Stripe"));
    expect(within(currentStep()).getByRole("link", { name: /Connect Stripe/ })).toHaveAttribute(
      "href",
      "/account/payments#stripe-connect",
    );
    expect(
      await screen.findByRole("heading", { name: "What needs your attention today." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Finish your Stripe setup")).toBeNull();
    expect(screen.queryByText("Payouts ready")).toBeNull();
  });
});

describe("Teacher home: each piece of data is read once", () => {
  it("courses, orders and profile: one read each, with all blocks mounted", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [
      {
        id: "o1",
        courseId: "c1",
        courseTitle: "Breathwork Basics",
        status: "paid",
        amountMinor: 4900,
        currency: "usd",
        createdAt: new Date(),
      },
    ];

    render(<TeacherStudioDashboard />);

    // Metrics, chart (insights) and recent activity on screen.
    expect(await screen.findByText("Revenue, 30d")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Revenue" })).toBeInTheDocument();
    expect(await screen.findByText("New sale in Breathwork Basics")).toBeInTheDocument();

    expect(data.subscribeToTeacherCourses).toHaveBeenCalledTimes(1);
    expect(data.subscribeToTeacherOrders).toHaveBeenCalledTimes(1);
    expect(data.subscribeToUserProfile).toHaveBeenCalledTimes(1);
    // The activation fee comes from the publish gates, not from an extra read.
    expect(data.fetchCreatorActivationBlocked).toHaveBeenCalledTimes(1);
  });
});

// --- Wave 6: teacher shell -------------------------------------------

describe("Teacher home: one headline, what happened and the storefront", () => {
  it("has ONE level-1 headline (the 'Producer home' eyebrow is gone)", async () => {
    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Welcome, Patrick",
    );
    expect(screen.queryByText("Producer home")).toBeNull();
  });

  it("shows 'Recent activity' with an honest empty state for a new teacher", async () => {
    render(<TeacherStudioDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Recent activity" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
  });

  it("shows 'Your storefront' with the public address and the two paths", async () => {
    render(<TeacherStudioDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Your storefront" }),
    ).toBeInTheDocument();
    expect(screen.getByText("/instructors/teacher-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open storefront/ })).toHaveAttribute(
      "href",
      "/instructors/teacher-1",
    );
    expect(screen.getByRole("link", { name: "Edit storefront" })).toHaveAttribute(
      "href",
      "/teach/storefront",
    );
    // Nothing published yet: we do not say the storefront is live.
    expect(
      screen.getByText("The page exists, but nothing is published on it yet."),
    ).toBeInTheDocument();
  });

  it("a name with $& in the headline shows up literally, without becoming '{name}'", async () => {
    // In a replace without a callback, "$&" becomes the matched piece ("{name}") and "$'" the
    // rest of the sentence. The name comes from sign-up: it is the person's text, not ours.
    mockUser.displayName = "Mc$&Donald Simon";
    try {
      render(<TeacherStudioDashboard />);

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "Welcome, Mc$&Donald",
      );
    } finally {
      mockUser.displayName = "Patrick Simon";
    }
  });
});

// --- First visit: no "Welcome back" or $0 tiles ---------------

describe("Teacher home: first visit", () => {
  it("without a product says 'Welcome', never 'Welcome back'", async () => {
    render(<TeacherStudioDashboard />);

    const heading = await screen.findByRole("heading", { level: 1 });
    // No period: the Home title follows the header of the sibling screens.
    expect(heading).toHaveTextContent(/^Welcome, Patrick$/);
    expect(heading).not.toHaveTextContent("Welcome back");
  });

  it("with a product it says 'Welcome back' again", async () => {
    state.courses = [course({})];

    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Welcome back, Patrick",
      );
    });
  });

  it("before the 1st sale it hides the revenue, learners and rating tiles", async () => {
    state.courses = [course({ status: "published" })];
    // An order that did not become a sale (not paid) does not count.
    state.orders = [
      {
        id: "o1",
        courseId: "c1",
        courseTitle: "Breathwork Basics",
        status: "pending",
        amountMinor: 4900,
        currency: "usd",
        createdAt: new Date(),
      },
    ];

    render(<TeacherStudioDashboard />);

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Revenue, 30d")).toBeNull();
    expect(screen.queryByText("New students")).toBeNull();
    expect(screen.queryByText("$0")).toBeNull();
  });

  it("with the 1st paid sale the tiles show up", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [
      {
        id: "o1",
        courseId: "c1",
        courseTitle: "Breathwork Basics",
        status: "paid",
        amountMinor: 4900,
        currency: "usd",
        createdAt: new Date(),
      },
    ];

    render(<TeacherStudioDashboard />);

    expect(await screen.findByText("Revenue, 30d")).toBeInTheDocument();
    expect(screen.getByText("New students")).toBeInTheDocument();
    // "Completion" was always "--": the value is not measured, the tile is gone.
    expect(screen.queryByText("Completion")).toBeNull();
    expect(screen.queryByText("Appears once learners finish lessons")).toBeNull();
  });

  it("with only a free enrollment (no paid order) the tiles show up", async () => {
    state.courses = [course({ status: "published", paymentType: "free", enrollmentCount: 3 })];
    state.orders = [];

    render(<TeacherStudioDashboard />);

    expect(await screen.findByText("Revenue, 30d")).toBeInTheDocument();
  });

  it("with a product but zero enrollments and zero paid orders it still has no tiles", async () => {
    state.courses = [course({ status: "published", enrollmentCount: 0 })];
    state.orders = [];

    render(<TeacherStudioDashboard />);

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Revenue, 30d")).toBeNull();
  });

  it("while the course list loads it says 'Hello', never 'Welcome' nor 'Welcome back'", async () => {
    data.subscribeToTeacherCourses.mockImplementationOnce(() => () => undefined);

    render(<TeacherStudioDashboard />);

    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/^Hello, Patrick$/);
    expect(heading).not.toHaveTextContent("Welcome");
  });

  // The skeleton has the shape of the card (16:9 cover and text), announced once;
  // and the header only has "New product" (the "Storefront" repeated the card).
  it("while the products load: skeleton shaped like the card, and one button in the header", async () => {
    data.subscribeToTeacherCourses.mockImplementationOnce(() => () => undefined);

    render(<TeacherStudioDashboard />);

    const status = (await screen.findByText("Loading products...")).closest("[role='status']") as HTMLElement;
    expect(status).not.toBeNull();
    expect(status.querySelectorAll(".aspect-video")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: "Storefront" })).toBeNull();
    expect(screen.getByRole("link", { name: "New product" })).toBeInTheDocument();
  });

  it("if the courses subscription fails, it keeps 'Welcome back'", async () => {
    data.subscribeToTeacherCourses.mockImplementationOnce(
      (_uid: string, _onData: (courses: unknown[]) => void, onError?: (error: Error) => void) => {
        onError?.(new Error("boom"));
        return () => undefined;
      },
    );

    render(<TeacherStudioDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Welcome back, Patrick",
      );
    });
    // A failure is not "no product": no inviting to create a repeated product.
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your products or sales.");
    expect(screen.queryByRole("heading", { name: "Your first product starts here." })).toBeNull();
    expect(screen.getByRole("link", { name: "New product" })).toHaveClass("button-solid");
  });
});

// --- Card status: each with its own color, none in brass ---------------

describe("Teacher home: the card badge is the recorded type", () => {
  it("shows the product type, and free or subscription do not become a type", async () => {
    state.courses = [
      course({ id: "c1", title: "Grupo", productFormat: "community", paymentType: "subscription_monthly" }),
      course({ id: "c2", title: "Apostila", productFormat: "ebook", paymentType: "free", priceAmountMinor: 0 }),
      course({ id: "c3", title: "Antigo", paymentType: "free", priceAmountMinor: 0 }),
    ];

    render(<TeacherStudioDashboard />);

    const produtos = await screen.findByRole("region", { name: "Products in your workspace" });
    const typeOf = (title: string) =>
      within(produtos).getByRole("link", { name: new RegExp(title) }).querySelector("span.uppercase")?.textContent;
    expect([typeOf("Grupo"), typeOf("Apostila"), typeOf("Antigo")]).toEqual(["Community", "Digital download", "Course"]);
    expect(produtos.textContent).not.toContain("creatorPanel.home.formats");
  });
});

describe("Teacher home: product card status", () => {
  it("Published, Draft and Needs changes come out in different StatusChips", async () => {
    state.courses = [
      course({ id: "c1", title: "No ar", status: "published" }),
      course({ id: "c2", title: "Rascunho", status: "draft" }),
      course({ id: "c3", title: "Com ajuste", status: "needs_changes" }),
    ];

    render(<TeacherStudioDashboard />);

    const produtos = await screen.findByRole("region", {
      name: "Products in your workspace",
    });
    const cardOf = (title: string) =>
      within(produtos).getByRole("link", { name: new RegExp(title) });
    const chipOf = (title: string) => cardOf(title).querySelector(".status-chip");

    expect(chipOf("No ar")).toHaveClass("status-chip--success");
    expect(chipOf("No ar")).toHaveTextContent("Published");
    expect(chipOf("Rascunho")).toHaveClass("status-chip--draft");
    expect(chipOf("Rascunho")).toHaveTextContent("Draft");
    expect(chipOf("Com ajuste")).toHaveClass("status-chip--danger");
    expect(chipOf("Com ajuste")).toHaveTextContent("Needs changes");
    // The earlier gold text does not come back on any card.
    for (const title of ["No ar", "Rascunho", "Com ajuste"]) {
      expect(cardOf(title).innerHTML).not.toContain("--color-accent-fg");
    }
  });
});

// Wave D on the Home: the cards arrive in a staircase and rise on hover; whoever opens the
// Home with everything ready sees the check and the badge still (celebration only on change).
describe("Teacher home: motion", () => {
  it("cards in a staircase (--i per card) and with the hover that rises", async () => {
    state.courses = [
      course({ id: "c1", title: "Primeiro" }),
      course({ id: "c2", title: "Segundo" }),
    ];

    render(<TeacherStudioDashboard />);

    const produtos = await screen.findByRole("region", { name: "Products in your workspace" });
    const list = produtos.querySelector("ul.motion-stagger")!;
    expect(list).not.toBeNull();
    const items = [...list.children] as HTMLElement[];
    expect(items.map((item) => item.style.getPropertyValue("--i"))).toEqual(["0", "1"]);
    expect(within(produtos).getByRole("link", { name: /Primeiro/ })).toHaveClass("motion-hover-lift");
  });

  // Whoever arrives with everything ready does not see the block (test above). If the last step
  // becomes ready with the Home open, the block stays, with the celebration: check and badge.
  it("the last step becomes ready with the Home open: the block stays and the check and the badge are drawn", async () => {
    let pushProfile: (profile: unknown) => void = () => undefined;
    data.subscribeToUserProfile.mockImplementationOnce((_uid, onData) => {
      pushProfile = onData;
      onData(state.profile);
      return () => undefined;
    });
    state.courses = [course({ status: "published" })];

    const { container } = render(<TeacherStudioDashboard />);

    await waitFor(() => expect(currentStep()).toHaveTextContent("Connect Stripe"));
    expect(container.querySelector(".drawn-check")).toBeNull();

    act(() => pushProfile({ stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true }));

    await waitFor(() => expect(screen.getByText("3 of 3 complete")).toBeInTheDocument());
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(container.querySelectorAll(".drawn-check")).toHaveLength(1);
    expect(container.querySelector("[data-milestone-seal]")).toHaveClass("milestone-seal");
    expect(document.querySelector('li[aria-current="step"]')).toBeNull();
  });
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => state.planRequired }));

// --- Revenue per currency: nothing adds reais to dollars --------------------------

function paidOrder(fields: Record<string, unknown>) {
  return {
    id: "o1",
    courseId: "c1",
    courseTitle: "Breathwork Basics",
    status: "paid",
    amountMinor: 4900,
    currency: "usd",
    createdAt: new Date(),
    ...fields,
  };
}

function revenueTile() {
  return screen.getByText("Revenue, 30d").nextElementSibling as HTMLElement;
}

describe("Teacher home: revenue never adds currencies", () => {
  it("one currency only (USD): tile and chart as always", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [paidOrder({})];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    expect(revenueTile()).toHaveTextContent(/^\$49$/);
    expect(screen.getByText("$49", { selector: "strong.num" })).toBeInTheDocument();
    expect(screen.queryByText(/not in this chart/)).toBeNull();
  });

  // R$100 and $20 became "$120" in the tile and the chart.
  it("two currencies: each in its own value, the chart draws one and names the others", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [
      paidOrder({ id: "brl", currency: "BRL", amountMinor: 10_000 }),
      paidOrder({ id: "usd", currency: "USD", amountMinor: 2_000 }),
    ];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    // Side by side, the largest first.
    expect(revenueTile()).toHaveTextContent("R$100 · $20");
    // Tie on orders: the chart takes the first in alphabetical order.
    expect(screen.getByText("R$100", { selector: "strong.num" })).toBeInTheDocument();
    expect(screen.getByText("Other currencies are not in this chart: $20.")).toBeInTheDocument();
    expect(screen.getAllByText("R$0").length).toBeGreaterThan(0);
    // No sum of the two anywhere on the Home.
    expect(document.body.textContent).not.toMatch(/\$120|R\$120/);
  });

  it("a refund does not count as revenue, nor in its currency", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [
      paidOrder({ id: "usd" }),
      paidOrder({ id: "brl", currency: "BRL", amountMinor: 10_000, status: "refunded" }),
    ];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    expect(revenueTile()).toHaveTextContent(/^\$49$/);
    expect(document.body.textContent).not.toContain("R$");
  });

  // Old row with no currency: Intl refuses the code; the Home opens with the value.
  it("empty currency: falls back to plain text, without bringing the Home down", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [paidOrder({ currency: "" })];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    expect(revenueTile()).toHaveTextContent("UNSPECIFIED 49.00");
    expect(screen.getByRole("img", { name: "Teacher revenue chart" })).toBeInTheDocument();
  });

  it("no paid order (free enrollment only): zero without inventing a currency", async () => {
    state.courses = [course({ status: "published", paymentType: "free", enrollmentCount: 3 })];
    state.orders = [];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    expect(revenueTile()).toHaveTextContent(/^0$/);
    expect(screen.queryByRole("img", { name: "Teacher revenue chart" })).toBeNull();
  });
});

describe("Teacher home: change, Top courses, partial refund and failed read", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const revenueCard = () => revenueTile().closest("article") as HTMLElement;

  it("change only currency with currency: $60 now against $50 before = +20.0%", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [
      paidOrder({ id: "now", amountMinor: 6_000, createdAt: new Date(Date.now() - 10 * DAY) }),
      paidOrder({ id: "before", amountMinor: 5_000, createdAt: new Date(Date.now() - 40 * DAY) }),
    ];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    expect(revenueCard()).toHaveTextContent("+20.0%");
  });

  it("BRL now and USD before: no revenue change", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [
      paidOrder({ id: "now", currency: "BRL", amountMinor: 6_000, createdAt: new Date(Date.now() - 10 * DAY) }),
      paidOrder({ id: "before", currency: "USD", amountMinor: 5_000, createdAt: new Date(Date.now() - 40 * DAY) }),
    ];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    expect(revenueCard().textContent).not.toMatch(/%|NaN|Infinity|∞/);
  });

  it("no previous period: the change goes away, never NaN or infinity", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [paidOrder({ amountMinor: 6_000, createdAt: new Date(Date.now() - 10 * DAY) })];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    expect(revenueCard().textContent).not.toMatch(/%|NaN|Infinity|∞/);
  });

  // Chart in BRL; the product that made $5,000 in USD fell below products
  // that never sold but had more lessons.
  it("Top courses: whoever sold in another currency does not fall below whoever never sold", async () => {
    state.courses = [
      course({ id: "brl", title: "Reais", status: "published", lessonCount: 1 }),
      course({ id: "usd", title: "Dolares", status: "published", lessonCount: 1 }),
      course({ id: "empty-1", title: "Vazio Um", status: "published", lessonCount: 20 }),
      course({ id: "empty-2", title: "Vazio Dois", status: "published", lessonCount: 30 }),
    ];
    state.orders = [
      paidOrder({ id: "b1", courseId: "brl", currency: "BRL", amountMinor: 10_000 }),
      paidOrder({ id: "b2", courseId: "brl", currency: "BRL", amountMinor: 10_000 }),
      paidOrder({ id: "u1", courseId: "usd", currency: "USD", amountMinor: 500_000 }),
    ];

    render(<TeacherStudioDashboard />);

    const top = (await screen.findByRole("heading", { name: "Top courses" })).closest(".dash-card") as HTMLElement;
    const rows = within(top).getAllByRole("link").filter((link) => link.className.includes("studio-course-row"));
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual(["Reais", "Dolares", "Vazio Dois"]);
    // Each product in its own value: "$5,000", never the "R$0" of the chart's currency.
    expect(within(rows[1]).getByText("$5,000")).toBeInTheDocument();
    expect(within(rows[1]).queryByText("R$0")).toBeNull();
  });

  it("partial refund: $100 with $30 returned counts $70 in the tile, the chart and Top courses", async () => {
    state.courses = [course({ status: "published" })];
    state.orders = [paidOrder({ status: "partially_refunded", amountMinor: 10_000, refundedAmountMinor: 3_000 })];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    expect(revenueTile()).toHaveTextContent(/^\$70$/);
    expect(screen.getByText("$70", { selector: "strong.num" })).toBeInTheDocument();
    const top = screen.getByRole("heading", { name: "Top courses" }).closest(".dash-card") as HTMLElement;
    expect(within(top).getByText("$70")).toBeInTheDocument();
  });

  it("the orders read failed: the tiles say Unavailable, never 0", async () => {
    data.subscribeToTeacherOrders.mockImplementationOnce(
      (_uid: string, _onData: (orders: unknown[]) => void, onError?: (error: Error) => void) => {
        onError?.(new Error("boom"));
        return Object.assign(() => undefined, { reload: async () => {} });
      },
    );
    state.courses = [course({ status: "published", paymentType: "free", enrollmentCount: 3 })];

    render(<TeacherStudioDashboard />);

    await screen.findByText("Revenue, 30d");
    expect(revenueTile()).toHaveTextContent("Unavailable");
    expect(screen.getByText("New students").nextElementSibling).toHaveTextContent("Unavailable");
  });

  it("orders still loading: skeleton, never 0", async () => {
    data.subscribeToTeacherOrders.mockImplementationOnce(() => Object.assign(() => undefined, { reload: async () => {} }));
    state.courses = [course({ status: "published", paymentType: "free", enrollmentCount: 3 })];

    render(<TeacherStudioDashboard />);

    const card = (await screen.findByText("Revenue, 30d")).closest("article") as HTMLElement;
    expect(card.querySelector(".animate-pulse")).not.toBeNull();
    expect(card.textContent).not.toMatch(/\$0/);
    expect(within(card).queryByText("0")).toBeNull();
  });
});
