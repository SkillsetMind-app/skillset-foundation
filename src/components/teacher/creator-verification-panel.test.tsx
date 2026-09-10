import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorVerificationPanel } from "@/components/teacher/creator-verification-panel";
import type { CreatorVerificationCase } from "@/domain/creator-verification";

const mocks = vi.hoisted(() => ({
  user: { uid: "creator-1" },
  fetchFlag: vi.fn(),
  subscribe: vi.fn(),
  submit: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: mocks.fetchFlag,
  subscribeToMyVerificationCase: mocks.subscribe,
  submitCreatorVerification: mocks.submit,
  uploadVerificationEvidence: mocks.upload,
  removeVerificationEvidence: mocks.remove,
}));

function renderPanel() {
  return render(<CreatorVerificationPanel />);
}

function receiveCase(status: CreatorVerificationCase["status"], verificationKind: CreatorVerificationCase["verificationKind"] = "legacy", documentPath?: string) {
  mocks.subscribe.mockImplementation((
    _uid: string,
    onCase: (value: CreatorVerificationCase | null) => void,
  ) => {
    onCase({
      id: "case-1",
      creatorId: mocks.user.uid,
      status,
      verificationKind,
      documentPath,
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
    mocks.submit.mockReset().mockResolvedValue(undefined);
    mocks.upload.mockReset().mockResolvedValue("creator-1/evidence.pdf");
    mocks.remove.mockReset().mockResolvedValue(undefined);
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
    expect(screen.queryByRole("combobox", { name: "Profession" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/teach");
    expect(screen.getByText(/Verification is optional\./)).toBeInTheDocument();
    expect(screen.queryByText(/becomes required|professional admission opens/i)).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.click(request);

    expect(screen.getByRole("combobox", { name: "Profession" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Profession" })).toBeRequired();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeVisible();
    expect(request).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/teach");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each(["needs_changes", "rejected"] as const)("opens a prefilled %s application only after editing is requested", async (status) => {
    receiveCase(status);
    renderPanel();

    const edit = await screen.findByRole("button", { name: "Edit application" });
    expect(screen.queryByRole("combobox", { name: "Profession" })).not.toBeInTheDocument();
    expect(screen.getByText("Please update your evidence link.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Not now" })).toHaveAttribute("href", "/teach");

    fireEvent.click(edit);

    expect(screen.getByRole("combobox", { name: "Profession" })).toHaveValue("");
    fireEvent.change(screen.getByRole("combobox", { name: "Profession" }), { target: { value: "psychologist" } });
    expect(screen.queryByRole("textbox", { name: /^Registry \/ license type/ })).not.toBeInTheDocument();
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

  it.each([
    ["psychologist", "Professional credential verified"],
    ["coach", "Professional evidence reviewed"],
    ["holistic", "Professional evidence reviewed"],
    ["other", "Professional evidence reviewed"],
    ["legacy", "Professional verification approved"],
  ] as const)("labels an approved %s request accurately without reopening the form", async (kind, label) => {
    receiveCase("approved", kind);
    renderPanel();

    expect(await screen.findByRole("heading", { name: label })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to studio" })).toHaveAttribute("href", "/teach");
    expect(screen.queryByRole("button", { name: /Request professional badge|Edit application/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not display a verified badge while a request is pending", async () => {
    receiveCase("pending", "psychologist");
    renderPanel();

    expect(await screen.findByRole("heading", { name: "In review" })).toBeVisible();
    expect(screen.queryByText(/Professional credential verified|Professional evidence reviewed|Professional verification approved/)).not.toBeInTheDocument();
    expect(screen.queryByText("Training verified")).not.toBeInTheDocument();
  });

  async function chooseKind(kind: string) {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Request professional badge" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Profession" }), { target: { value: kind } });
  }

  it.each(["coach", "holistic"])("submits %s with a link and no license fields", async (kind) => {
    await chooseKind(kind);
    expect(screen.queryByRole("textbox", { name: /Registration number|Issuing country|Registry/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Evidence links" }), { target: { value: "https://instagram.com/professional" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({
      verificationKind: kind,
      profession: kind === "coach" ? "Coach" : "Holistic practitioner",
      registrationId: undefined,
      registrationRegion: undefined,
      evidenceLinks: ["https://instagram.com/professional"],
      documentPath: undefined,
      note: undefined,
    }));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("requires psychologist registration and region in addition to evidence", async () => {
    await chooseKind("psychologist");
    expect(screen.getByRole("textbox", { name: "Registration number" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "Issuing country or state" })).toBeRequired();
    expect(screen.queryByRole("textbox", { name: /Registry \/ license type/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Evidence links" }), { target: { value: "https://directory.org/profile" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Registration number" }), { target: { value: "PSY-123" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Issuing country or state" }), { target: { value: "Florida" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      verificationKind: "psychologist", profession: "Psychologist", registrationId: "PSY-123", registrationRegion: "Florida",
    })));
  });

  it("prevents submission without a link or file", async () => {
    await chooseKind("coach");
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a professional link or a certificate to request a badge.");
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("requires a description for other professions", async () => {
    await chooseKind("other");
    expect(screen.getByRole("textbox", { name: "Your profession" })).toBeRequired();
    fireEvent.change(screen.getByRole("textbox", { name: "Evidence links" }), { target: { value: "https://directory.org/profile" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(mocks.submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Your profession" }), { target: { value: "Yoga instructor" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ verificationKind: "other", profession: "Yoga instructor" })));
  });

  it.each([
    ["HEIC photo", "image/heic", 10],
    ["empty PDF", "application/pdf", 0],
    ["oversized JPEG", "image/jpeg", 10 * 1024 * 1024 + 1],
  ] as const)("rejects an invalid %s before upload with actionable guidance", async (_label, type, size) => {
    await chooseKind("coach");
    const file = new File([new Uint8Array(size)], "evidence", { type });
    fireEvent.change(screen.getByLabelText("Take photo"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a non-empty JPG, PNG, WebP or PDF file up to 10 MB. Convert HEIC photos to JPG or PNG.");
    expect(screen.queryByRole("button", { name: "Remove document" })).not.toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("uses native document and camera inputs without uploading on selection", async () => {
    await chooseKind("coach");
    const documentInput = screen.getByLabelText("Document or diploma");
    const cameraInput = screen.getByLabelText("Take photo");
    expect(documentInput).toHaveAttribute("type", "file");
    expect(documentInput).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,application/pdf");
    expect(cameraInput).toHaveAttribute("accept", "image/*");
    expect(cameraInput).toHaveAttribute("capture", "environment");
    fireEvent.change(cameraInput, { target: { files: [new File(["photo"], "diploma.jpg", { type: "image/jpeg" })] } });
    expect(screen.getByText("diploma.jpg")).toBeVisible();
    expect(mocks.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove document" }));
    expect(screen.queryByText("diploma.jpg")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a professional link or a certificate to request a badge.");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("reuses a successful private upload after submission fails and replaces it when the file changes", async () => {
    mocks.submit.mockRejectedValueOnce({ message: "private database detail" });
    await chooseKind("coach");
    const file = new File(["document"], "diploma.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Document or diploma"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not submit verification. Please try again.");
    expect(screen.queryByText(/private database detail/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(file);
    expect(mocks.submit).toHaveBeenLastCalledWith(expect.objectContaining({ documentPath: "creator-1/evidence.pdf", evidenceLinks: [] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Document or diploma"), { target: { files: [new File(["new"], "new.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled());
  });

  it("keeps edits when the admission flag arrives later", async () => {
    let resolveFlag!: (value: boolean) => void;
    mocks.fetchFlag.mockReturnValue(new Promise<boolean>((resolve) => { resolveFlag = resolve; }));
    await chooseKind("other");
    fireEvent.change(screen.getByRole("textbox", { name: "Your profession" }), { target: { value: "Yoga instructor" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Evidence links" }), { target: { value: "https://directory.org/profile" } });
    await act(async () => { resolveFlag(false); });
    expect(screen.getByRole("combobox", { name: "Profession" })).toHaveValue("other");
    expect(screen.getByRole("textbox", { name: "Your profession" })).toHaveValue("Yoga instructor");
    expect(screen.getByRole("textbox", { name: "Evidence links" })).toHaveValue("https://directory.org/profile");
  });

  it("validates the full evidence input before uploading a selected document", async () => {
    await chooseKind("coach");
    fireEvent.change(screen.getByLabelText("Document or diploma"), { target: { files: [new File(["document"], "diploma.pdf", { type: "application/pdf" })] } });
    fireEvent.change(screen.getByRole("textbox", { name: "Evidence links" }), { target: { value: "https://" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use a valid https:// professional link.");
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  async function failRequestAfterUpload() {
    mocks.submit.mockRejectedValueOnce(new Error("database internals"));
    await chooseKind("coach");
    fireEvent.change(screen.getByLabelText("Document or diploma"), { target: { files: [new File(["document"], "diploma.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await screen.findByText("Could not submit verification. Please try again.");
  }

  it("deletes an unreferenced upload once before removing it and blocks concurrent actions", async () => {
    await failRequestAfterUpload();
    let finishRemoval!: () => void;
    mocks.remove.mockReturnValue(new Promise<void>((resolve) => { finishRemoval = resolve; }));
    const remove = screen.getByRole("button", { name: "Remove document" });
    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(remove).toBeDisabled();
    expect(screen.getByLabelText("Document or diploma")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Removing document..." })).toBeDisabled();
    expect(screen.getByText("diploma.pdf")).toBeVisible();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("creator-1/evidence.pdf");
    await act(async () => { finishRemoval(); });
    expect(screen.queryByText("diploma.pdf")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("retains the attachment and uploaded path when cleanup fails", async () => {
    await failRequestAfterUpload();
    mocks.remove.mockRejectedValueOnce(new Error("storage private detail"));
    fireEvent.click(screen.getByRole("button", { name: "Remove document" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove the uploaded document. Please try again before replacing or removing it.");
    expect(screen.queryByText(/storage private detail/)).not.toBeInTheDocument();
    expect(screen.getByText("diploma.pdf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenLastCalledWith(expect.objectContaining({ documentPath: "creator-1/evidence.pdf" }));
  });

  it("detaches an existing reviewed case document without deleting its referenced file", async () => {
    receiveCase("needs_changes", "coach", "creator-1/existing.pdf");
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Edit application" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove document" }));
    expect(screen.queryByText("Private document attached")).not.toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resubmit for review" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ documentPath: undefined })));
  });

  it("waits for cleanup before accepting a replacement file", async () => {
    await failRequestAfterUpload();
    let finishRemoval!: () => void;
    mocks.remove.mockReturnValue(new Promise<void>((resolve) => { finishRemoval = resolve; }));
    fireEvent.change(screen.getByLabelText("Document or diploma"), { target: { files: [new File(["replacement"], "replacement.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText("diploma.pdf")).toBeVisible();
    expect(screen.queryByText("replacement.pdf")).not.toBeInTheDocument();
    await act(async () => { finishRemoval(); });
    expect(screen.getByText("replacement.pdf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("creator-1/evidence.pdf");
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled());
  });

  it("does not submit if the private upload fails and keeps the file for retry", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("storage internals"));
    await chooseKind("coach");
    fireEvent.change(screen.getByLabelText("Document or diploma"), { target: { files: [new File(["document"], "diploma.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not submit verification. Please try again.");
    expect(screen.queryByText(/storage internals/)).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByText("diploma.pdf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.upload).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["http://directory.org/profile", "Use a valid https:// professional link (max 300 characters)."],
    [Array.from({ length: 7 }, (_, index) => `https://directory.org/${index}`).join("\n"), "Attach at most 6 evidence links."],
  ])("rejects invalid evidence before uploading: %s", async (links, message) => {
    await chooseKind("coach");
    fireEvent.change(screen.getByRole("textbox", { name: "Evidence links" }), { target: { value: links } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
