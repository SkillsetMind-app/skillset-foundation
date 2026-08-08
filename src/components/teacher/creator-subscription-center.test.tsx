import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CreatorSubscriptionCenterView } from "@/components/teacher/creator-subscription-center";
import type { CourseSubscription } from "@/domain/course-subscription";
import type { Order } from "@/domain/order";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { SubscriberProfile } from "@/lib/data/user-profiles";
import type { TeacherCourse } from "@/domain/teacher-course";

const course = {
  id: "course-1",
  ownerId: "teacher-1",
  title: "Clinical Focus",
  summary: "",
  category: "Psychology",
  status: "published",
  modules: [],
  lessonCount: 0,
  paymentType: "subscription_monthly",
  priceAmountMinor: 19900,
  currency: "BRL",
} as TeacherCourse;

const subscription = {
  id: "sub-1",
  userId: "learner-1",
  courseId: "course-1",
  stripeSubscriptionId: "sub-1",
  status: "active",
  interval: "month",
  currentPeriodEnd: "2026-08-15T10:00:00.000Z",
  cancelAtPeriodEnd: false,
  pastDue: false,
  updatedAt: "2026-07-15T10:00:00.000Z",
} as CourseSubscription;

const order = {
  id: "in-1",
  userId: "learner-1",
  teacherId: "teacher-1",
  courseId: "course-1",
  courseSlug: "course-1",
  courseTitle: "Clinical Focus",
  amountMinor: 9900,
  currency: "BRL",
  platformFeeBps: 800,
  status: "paid",
  provider: "stripe",
  checkoutSessionId: null,
  paymentIntentId: "pi-1",
  createdAt: "2026-07-15T10:00:00.000Z",
} as Order;

const ledger = {
  id: "in-1",
  teacherId: "teacher-1",
  courseId: "course-1",
  orderId: "in-1",
  paymentId: "pi-1",
  subscriptionId: "sub-1",
  kind: "course_subscription",
  grossAmountMinor: 9900,
  skillsetFeeMinor: 792,
  netAmountMinor: 8808,
  currency: "BRL",
  status: "in_release",
  createdAt: "2026-07-15T10:00:00.000Z",
} as PayoutLedgerEntry;

const profile = {
  uid: "learner-1",
  displayName: "Maria Silva",
  photoUrl: "",
} as SubscriberProfile;

describe("CreatorSubscriptionCenterView", () => {
  it("shows operational metrics and filters subscribers by name", () => {
    render(
      <CreatorSubscriptionCenterView
        subscriptions={[subscription]}
        courses={[course]}
        orders={[order]}
        ledgers={[ledger]}
        profiles={[profile]}
      />,
    );

    expect(screen.getAllByText("Maria Silva").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clinical Focus").length).toBeGreaterThan(0);
    expect(screen.getByText("1 active")).toBeInTheDocument();
    expect(screen.getByText("BRL 99.00")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search subscribers"), {
      target: { value: "does-not-match" },
    });
    expect(screen.queryByText("Maria Silva")).not.toBeInTheDocument();
    expect(screen.getByText("No subscribers match these filters.")).toBeInTheDocument();
  });

  it("switches to reportable renewal history", () => {
    render(
      <CreatorSubscriptionCenterView
        subscriptions={[subscription]}
        courses={[course]}
        orders={[order]}
        ledgers={[ledger]}
        profiles={[profile]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Renewals" }));
    expect(screen.getByText("Renewal in-1")).toBeInTheDocument();
    expect(screen.getByText(/Maria Silva/)).toBeInTheDocument();
    expect(screen.getByText(/Gross BRL 99.00/)).toBeInTheDocument();
  });

  it("marks financial metrics and renewals unavailable after a read failure", () => {
    render(
      <CreatorSubscriptionCenterView
        subscriptions={[subscription]}
        courses={[course]}
        orders={[]}
        ledgers={[]}
        profiles={[profile]}
        financialState="error"
      />,
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No MRR yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Renewals" }));
    expect(screen.getByText("Renewal history is unavailable.")).toBeInTheDocument();
  });
});
