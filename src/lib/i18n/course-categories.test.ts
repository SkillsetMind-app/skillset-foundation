import { describe, expect, it } from "vitest";

import { getCourseCategoryLabel } from "./course-categories";
import { getDictionary, translate } from "./dictionaries";

describe("course category labels", () => {
  it("localizes platform labels while retaining their English values", () => {
    const category = "Coaching as a Business";
    expect(getCourseCategoryLabel(category, (key) => translate(getDictionary("es"), key)))
      .toBe("Coaching como negocio");
    expect(getCourseCategoryLabel(category, (key) => translate(getDictionary("en"), key)))
      .toBe(category);
  });

  it.each(["My creator-written category", "constructor", "toString"])(
    "preserves creator content that is not a platform category: %s",
    (category) => {
      expect(getCourseCategoryLabel(category, () => "must not translate this"))
        .toBe(category);
    },
  );
});
