import { describe, expect, it, vi } from "vitest";

import PlatformPage from "@/app/platform/page";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("/platform", () => {
  it("redirects to the catalog instead of opening the internal storefront with no way out (F15)", () => {
    PlatformPage();

    expect(mocks.redirect).toHaveBeenCalledWith("/courses");
  });
});
