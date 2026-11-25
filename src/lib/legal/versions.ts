// Each bump re-prompts the matching acceptance (LegalAcceptanceGate). Keep them
// equal to the page's effective date — legalPages.common.effectiveDate for
// Terms and Privacy, legalPages.teacherTerms.effectiveDate for the Teacher
// Terms: the legal page test checks it.
//
// With each new version, also rewrite the "What changed" summary on the acceptance
// screen (legalAcceptance.body, en and es): it describes THIS change.
export const currentTermsVersion = "2026-11-24";
export const currentPrivacyVersion = "2026-11-24";
export const currentTeacherTermsVersion = "2026-11-24";
