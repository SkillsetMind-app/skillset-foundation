import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), upload: vi.fn(), from: vi.fn(), sign: vi.fn(), rpc: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({
  auth: { getUser: mocks.getUser }, storage: { from: mocks.from }, rpc: mocks.rpc,
}) }));
import { uploadVerificationEvidence, getVerificationEvidenceDownload, submitCreatorVerification, removeVerificationEvidence } from "./creator-verification";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  mocks.from.mockReturnValue({ upload: mocks.upload, createSignedUrl: mocks.sign, remove: mocks.remove });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ error: null });
});

describe("private verification documents", () => {
  it("does not claim removal when storage refuses or filters the object", async () => {
    mocks.remove.mockResolvedValue({ data: [], error: null });
    await expect(removeVerificationEvidence("owner/file.pdf")).rejects.toThrow(/Could not remove/);
    mocks.remove.mockResolvedValue({ data: [{ name: "owner/file.pdf" }], error: null });
    await expect(removeVerificationEvidence("owner/file.pdf")).resolves.toBeUndefined();
    expect(mocks.remove).toHaveBeenLastCalledWith(["owner/file.pdf"]);
  });
  it("uploads only to private evidence storage with a generated name, never the personal filename", async () => {
    const path = await uploadVerificationEvidence(new File(["pdf"], "personal-diploma.pdf", { type: "application/pdf" }));
    expect(mocks.from).toHaveBeenCalledWith("verification-evidence");
    expect(path).toMatch(/^owner\/[0-9a-f-]+\.pdf$/);
    expect(path).not.toContain("personal");
    expect(mocks.upload).toHaveBeenCalledWith(path, expect.any(File), { contentType: "application/pdf", upsert: false });
  });
  it("rejects active content and empty files before any upload", async () => {
    await expect(uploadVerificationEvidence(new File(["<svg/>"], "image.svg", { type: "image/svg+xml" }))).rejects.toThrow(/Choose/);
    await expect(uploadVerificationEvidence(new File([], "image.png", { type: "image/png" }))).rejects.toThrow(/Choose/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("requires a signed-in owner", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(uploadVerificationEvidence(new File(["pdf"], "file.pdf", { type: "application/pdf" }))).rejects.toThrow(/Sign in/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("requests an expiring download, never a public URL", async () => {
    mocks.sign.mockResolvedValue({ data: { signedUrl: "https://storage.example/signed" }, error: null });
    expect(await getVerificationEvidenceDownload("owner/file.pdf")).toBe("https://storage.example/signed");
    expect(mocks.sign).toHaveBeenCalledWith("owner/file.pdf", 60, { download: true });
  });
  it("submits a coach without fabricating registry details or approval", async () => {
    await submitCreatorVerification({ verificationKind: "coach", profession: "Coach", evidenceLinks: ["https://example.com/profile"] });
    expect(mocks.rpc).toHaveBeenCalledWith("submit_professional_badge", {
      p_kind: "coach", p_profession: "Coach", p_registration_id: undefined,
      p_registration_region: undefined, p_document_path: undefined,
      p_evidence_links: ["https://example.com/profile"], p_note: undefined,
    });
  });
});
