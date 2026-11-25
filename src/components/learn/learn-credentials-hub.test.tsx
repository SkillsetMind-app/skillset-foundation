import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LearnCredentialsHub } from "@/components/learn/learn-credentials-hub";
import type { Certificate } from "@/domain/certificate";
import type { Enrollment } from "@/domain/enrollment";

const mocks = vi.hoisted(() => ({
  user: { uid: "student" }, router: { refresh: vi.fn() },
  enrollments: vi.fn(), certificates: vi.fn(), issue: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/enrollments", () => ({ subscribeToUserEnrollments: mocks.enrollments }));
vi.mock("@/lib/data/certificates", () => ({
  subscribeToUserCertificates: mocks.certificates, issueSkillsetCertificate: mocks.issue,
}));

const finished: Enrollment = {
  id: "student__course", userId: "student", courseId: "course", courseSlug: "course",
  courseTitle: "Finished course", courseCategory: "Category", courseImage: "",
  status: "completed", source: "payment", progressPercent: 100, lastLessonId: null,
};
const certificate: Certificate = {
  id: finished.id, enrollmentId: finished.id, userId: "student", courseId: "course",
  courseSlug: "course", courseTitle: finished.courseTitle, courseCategory: "Category",
  authorityLabel: "SkillsetMind Verified", status: "issued", verificationCode: "SK-1",
};

function show(enrollment: Enrollment, certificates: Certificate[] = []) {
  mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment]); return () => {}; });
  mocks.certificates.mockImplementation((_uid, next) => { next(certificates); return () => {}; });
  render(<I18nProvider initialLocale="en"><LearnCredentialsHub /></I18nProvider>);
}

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("credentials hub eligibility", () => {
  it.each(["refunded", "revoked", "expired"] as const)(
    "does not offer a certificate for a %s enrollment at full progress",
    (status) => {
      show({ ...finished, status });
      expect(screen.getByText("Not available")).toBeVisible();
      expect(screen.getByText("Your access to this course has ended, so a certificate can't be issued.")).toBeVisible();
      expect(screen.queryByRole("button", { name: "Issue certificate" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Continue course" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ready 0" })).toBeVisible();
    },
  );

  it("does not offer a certificate that operations revoked", () => {
    show(finished, [{ ...certificate, status: "revoked" }]);
    expect(screen.getByText("Revoked")).toBeVisible();
    expect(screen.getByText("This certificate was revoked by SkillsetMind and can't be issued again.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Issue certificate" })).not.toBeInTheDocument();
  });

  it("offers re-issue again after a refunded learner buys and finishes the course again", () => {
    show({ ...finished, status: "active" }, [{ ...certificate, status: "refund_revoked" }]);
    expect(screen.getByRole("button", { name: "Issue certificate" })).toBeVisible();
  });
});

describe("credentials hub hierarchy", () => {
  // The custom design painted the hover the same as the chosen filter; now it is the
  // house segmented selector, with the choice on the button itself.
  it("the filters are the house segmented selector and filter the list", () => {
    show({ ...finished, status: "active", progressPercent: 40 });
    const group = screen.getByRole("group", { name: "Credential filters" });
    // Wraps the line: at 360px in Spanish all four stay in view, with no scrolling.
    expect(group).toHaveClass("studio-range-tabs", "studio-range-tabs--wrap");
    expect(within(group).getByRole("button", { name: "All 1" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(group).getByRole("button", { name: "Issued 0" }));
    expect(within(group).getByRole("button", { name: "Issued 0" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "All 1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("heading", { name: "Finished course" })).not.toBeInTheDocument();
    expect(screen.getByText("No credentials match this filter.")).toBeVisible();
  });

  it("one header (the shell's), and each card states its progress once", () => {
    show({ ...finished, status: "active", progressPercent: 40 });
    // The hero and the section title are gone; the filters carry the counts.
    expect(screen.queryByText("Credentials from real course progress.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In progress 1" })).toBeVisible();
    const title = screen.getByRole("heading", { name: "Finished course" });
    expect(title).not.toHaveClass("display-title");
    // Status pill + a bar with the percentage; no "Progress" box, no sentence.
    expect(screen.getByText("In progress", { selector: "span" })).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Progress" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getAllByText("40%")).toHaveLength(1);
    expect(screen.queryByText("Complete the course to become eligible for your SkillsetMind Verified certificate.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue course" })).toBeVisible();
  });
});

describe("credentials hub issuance errors", () => {
  async function claimAndFail(error: unknown) {
    mocks.issue.mockRejectedValue(error);
    show(finished);
    fireEvent.click(screen.getByRole("button", { name: "Issue certificate" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Full name on certificate" }), { target: { value: "Maria Silva" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm & issue" })); });
  }

  it.each([
    ["This certificate was revoked by Skillset operations.", "This certificate was revoked by SkillsetMind and can't be issued again."],
    ["This enrollment is not eligible for certificate issuance.", "Your access to this course has ended, so a certificate can't be issued."],
    ["Complete the course before requesting a certificate.", "Complete the course to become eligible for your SkillsetMind Verified certificate."],
    ["RATE_LIMIT", "Too many attempts. Wait before trying again."],
  ])("shows the real reason when the claim is refused with %j", async (message, shown) => {
    // Same shape as a PostgrestError: a plain object, not an Error instance.
    await claimAndFail({ message, code: "P0001", details: null, hint: null });
    expect(screen.getByRole("alert")).toHaveTextContent(shown);
  });

  it("never prints an unknown database message", async () => {
    await claimAndFail({ message: "duplicate key value violates unique constraint", code: "23505" });
    expect(screen.getByRole("alert")).toHaveTextContent("We could not issue this certificate yet. Please try again.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("duplicate key");
  });
});

describe("credentials hub load errors", () => {
  // The read failure was a dead end: the only way out was to reload the browser.
  it("an enrollments failure offers Try again, which re-reads through the same channel", async () => {
    const reload = vi.fn(async () => undefined);
    let next: (rows: Enrollment[]) => void = () => {};
    mocks.enrollments.mockImplementation((_uid, onData, onError) => {
      next = onData;
      onError(new Error("network"));
      return Object.assign(() => {}, { reload });
    });
    mocks.certificates.mockImplementation((_uid, onData) => { onData([]); return () => {}; });
    render(<I18nProvider initialLocale="en"><LearnCredentialsHub /></I18nProvider>);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your credential records.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(mocks.enrollments).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The button disappears on click: focus stays on the panel frame, not on <body>.
    const frame = document.activeElement as HTMLElement;
    expect(frame).not.toBe(document.body);
    expect(frame).toHaveAttribute("tabindex", "-1");
    expect(frame).toHaveTextContent("Loading credentials");

    act(() => next([finished]));
    expect(screen.getByRole("heading", { name: "Finished course" })).toBeVisible();
    expect(document.activeElement).toBe(frame);
    expect(frame).toContainElement(screen.getByRole("heading", { name: "Finished course" }));
  });

  // Certificates now have a re-read: "Try again" re-reads only them, and the list
  // does not show without the issued ones (until the answer arrives, "loading" applies).
  it("a certificates failure offers Try again, which re-reads only the certificates", () => {
    const enrollmentsReload = vi.fn(async () => undefined);
    const certificatesReload = vi.fn(async () => undefined);
    let deliver: (rows: Certificate[]) => void = () => {};
    let fail: (error: Error) => void = () => {};
    mocks.enrollments.mockImplementation((_uid, onData) => {
      onData([finished]);
      return Object.assign(() => {}, { reload: enrollmentsReload });
    });
    mocks.certificates.mockImplementation((_uid, next, onError) => {
      deliver = next;
      fail = onError;
      onError(new Error("network"));
      return Object.assign(() => {}, { reload: certificatesReload });
    });
    render(<I18nProvider initialLocale="en"><LearnCredentialsHub /></I18nProvider>);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your issued certificate records.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(certificatesReload).toHaveBeenCalledTimes(1);
    expect(enrollmentsReload).not.toHaveBeenCalled();
    expect(mocks.certificates).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Finished course" })).not.toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent("Loading credentials");

    // Failed again: the error comes back, with the button.
    act(() => fail(new Error("network")));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your issued certificate records.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(certificatesReload).toHaveBeenCalledTimes(2);

    act(() => deliver([certificate]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Finished course" })).toBeVisible();
    expect(screen.getByText("Issued", { selector: "span" })).toBeVisible();
  });
});
