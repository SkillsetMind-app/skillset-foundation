import { describe, expect, it, vi } from "vitest";

import PlatformPage from "@/app/platform/page";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("/platform", () => {
  it("manda para o catalogo em vez de abrir a vitrine interna sem saida (F15)", () => {
    PlatformPage();

    expect(mocks.redirect).toHaveBeenCalledWith("/courses");
  });
});
