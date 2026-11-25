import { describe, expect, it } from "vitest";

import { getAutosaveBlockedReason } from "@/components/teacher/course-builder-studio";

const ok = {
  isEditable: true,
  priceFieldIsValid: true,
  installmentsAreValid: true,
  draftStructureError: false,
};

describe("getAutosaveBlockedReason", () => {
  // The worst failure mode of the builder was silent: with an invalid field the
  // autosave stopped and the screen showed the SAME gray "Unsaved changes" badge that
  // appears in the normal 1.8s debounce. The teacher kept building modules
  // thinking it was saving, and lost everything on reload.
  it("does not block when the draft is valid", () => {
    expect(getAutosaveBlockedReason(ok)).toBeNull();
  });

  it.each([
    [{ priceFieldIsValid: false }, "price"],
    [{ installmentsAreValid: false }, "installments"],
    [{ draftStructureError: true }, "structure"],
  ])("names the blocker instead of just stopping (%o)", (override, expected) => {
    const reason = getAutosaveBlockedReason({ ...ok, ...override });
    expect(reason).toBe(expected);
  });

  // A published/archived course is not editable: there is no draft to lose, and
  // an alarm here would be permanent noise in the top bar.
  it("stays quiet when the course is not editable", () => {
    expect(
      getAutosaveBlockedReason({ ...ok, isEditable: false, priceFieldIsValid: false }),
    ).toBeNull();
  });

  // Price is the first gate, and it is what the teacher touches most: when more than one
  // field is invalid, the message points to it — not to a generic one.
  it("points to the price when more than one field is invalid", () => {
    expect(
      getAutosaveBlockedReason({
        ...ok,
        priceFieldIsValid: false,
        installmentsAreValid: false,
      }),
    ).toMatch(/price/);
  });
});
