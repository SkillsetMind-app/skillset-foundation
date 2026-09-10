import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorVerificationPanel } from "@/components/teacher/creator-verification-panel";
import type { CreatorVerificationCase } from "@/domain/creator-verification";

const mocks = vi.hoisted(() => ({
  user: { uid: "creator-1" },
  fetchFlag: vi.fn(),
  subscribe: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: mocks.fetchFlag,
  subscribeToMyVerificationCase: mocks.subscribe,
  submitCreatorVerification: mocks.submit,
}));

function renderPanel() {
  return render(<CreatorVerificationPanel />);
}

function receiveCase(status: CreatorVerificationCase["status"]) {
  mocks.subscribe.mockImplementation((
    _uid: string,
    onCase: (value: CreatorVerificationCase | null) => void,
  ) => {
    onCase({
      id: "case-1",
      creatorId: mocks.user.uid,
      status,
      profession: "Performance coach",
      registrationType: "Coaching association",
      registrationId: "COACH-123",
      registrationRegion: "Florida, USA",
      evidenceLinks: ["https://association.org/profile/123"],
      note: "My professional profile",
      reviewNote: "Please update your evidence link.",
      createdAt: "2026-09-09T00:00:00Z",
      updatedAt: "2026-09-09T00:00:00Z",
    });
    return () => {};
  });
}

describe("CreatorVerificationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchFlag.mockResolvedValue(false);
    mocks.subscribe.mockImplementation((
      _uid: string,
      onCase: (value: CreatorVerificationCase | null) => void,
    ) => {
      onCase(null);
      return () => {};
    });
  });

  afterEach(cleanup);

  it("opens the optional badge form only on request and lets the creator skip it", async () => {
    renderPanel();

    const request = await screen.findByRole("button", { name: "Request professional badge" });
    expect(screen.queryByRole("textbox", { name: /^Profession/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/teach");
    expect(screen.getByText(/Verification is optional\./)).toBeInTheDocument();
    expect(screen.queryByText(/becomes required|professional admission opens/i)).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.click(request);

    expect(screen.getByRole("textbox", { name: /^Profession/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeVisible();
    expect(request).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/teach");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each(["needs_changes", "rejected"] as const)("opens a prefilled %s application only after editing is requested", async (status) => {
    receiveCase(status);
    renderPanel();

    const edit = await screen.findByRole("button", { name: "Edit application" });
    expect(screen.queryByRole("textbox", { name: /^Profession/ })).not.toBeInTheDocument();
    expect(screen.getByText("Please update your evidence link.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/teach");

    fireEvent.click(edit);

    expect(screen.getByRole("textbox", { name: /^Profession/ })).toHaveValue("Performance coach");
    expect(screen.getByRole("textbox", { name: /^Registry \/ license type/ })).toHaveValue("Coaching association");
    expect(screen.getByRole("textbox", { name: /^Registration number/ })).toHaveValue("COACH-123");
    expect(screen.getByRole("textbox", { name: /^Issuing country or state/ })).toHaveValue("Florida, USA");
    expect(screen.getByRole("textbox", { name: "Evidence links" })).toHaveValue("https://association.org/profile/123");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not tell an optional pending applicant to wait before activation", async () => {
    receiveCase("pending");
    renderPanel();

    expect(await screen.findByText(/You can continue without a badge while it is reviewed/)).toBeVisible();
    expect(screen.queryByText(/before continuing activation/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Request professional badge|Edit application/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/teach");
  });

  it("preserves the actual mandatory flag copy for a pending applicant", async () => {
    mocks.fetchFlag.mockResolvedValue(true);
    receiveCase("pending");
    renderPanel();

    expect(await screen.findByText(/Verification is required before you can publish a course/)).toBeVisible();
    expect(screen.getByText(/before continuing activation/)).toBeVisible();
    expect(screen.queryByText(/Verification is optional\./)).not.toBeInTheDocument();
  });

  it("keeps approved applicants out of the request form", async () => {
    receiveCase("approved");
    renderPanel();

    expect(await screen.findByRole("heading", { name: "You are verified" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to studio" })).toHaveAttribute("href", "/teach");
    expect(screen.queryByRole("button", { name: /Request professional badge|Edit application/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
