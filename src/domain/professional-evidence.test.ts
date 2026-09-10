import { describe, expect, it } from "vitest";
import { validateProfessionalEvidence, type SubmitCreatorVerificationInput } from "./creator-verification";

const coach: SubmitCreatorVerificationInput = {
  verificationKind: "coach", profession: "Coach", evidenceLinks: ["https://www.linkedin.com/in/example"],
};

describe("professional badge evidence", () => {
  it("accepts a coach professional link without a license number", () => {
    expect(() => validateProfessionalEvidence(coach)).not.toThrow();
  });
  it("does not treat a psychologist social link as a license", () => {
    expect(() => validateProfessionalEvidence({ ...coach, verificationKind: "psychologist" })).toThrow(/license/);
  });
  it("accepts a psychologist license with issuing region and supporting evidence", () => {
    expect(() => validateProfessionalEvidence({ ...coach, verificationKind: "psychologist",
      registrationId: "PSY-1234", registrationRegion: "California" })).not.toThrow();
  });
  it("allows a private certificate instead of a public social link", () => {
    expect(() => validateProfessionalEvidence({ ...coach, evidenceLinks: [], documentPath: "owner/document.pdf" })).not.toThrow();
  });
  it("requires evidence only when a badge is requested", () => {
    expect(() => validateProfessionalEvidence({ ...coach, evidenceLinks: [] })).toThrow(/professional link or a certificate/);
  });
  it.each(["https://", "http://example.com", "javascript:alert(1)", "https://user:pass@example.com"])("rejects unsafe or malformed evidence %s", (link) => {
    expect(() => validateProfessionalEvidence({ ...coach, evidenceLinks: [link] })).toThrow(/https/);
  });
});
