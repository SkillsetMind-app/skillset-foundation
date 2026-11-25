import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import TeacherCouponsPage from "@/app/teach/coupons/page";
import TeacherIntegrationsPage from "@/app/teach/integrations/page";
import TeacherTeamPage from "@/app/teach/team/page";
import { platformNav } from "@/data/site";

// "Collaborators" and "Integrations" were "coming soon" signs in the menu, and
// "Coupons" a sign saying that coupons live in each product. All three
// left the menu; the routes stay alive and lead to the page that makes sense,
// so that no old link gets a 404.

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("dead items of the teacher menu", () => {
  it.each([
    ["/teach/team", TeacherTeamPage, "/teach"],
    ["/teach/integrations", TeacherIntegrationsPage, "/account/payments"],
    ["/teach/coupons", TeacherCouponsPage, "/teach/builder"],
  ] as const)("%s redireciona para %s", (_route, Page, destination) => {
    expect(() => Page()).toThrow(`REDIRECT:${destination}`);
  });

  it("none of them shows up in the bar anymore", () => {
    const hrefs = platformNav.filter((item) => item.contexts.length > 0).map((item) => item.href);

    expect(hrefs).not.toContain("/teach/team");
    expect(hrefs).not.toContain("/teach/integrations");
    expect(hrefs).not.toContain("/teach/coupons");
  });

  // A card that points to an address that only redirects misleads: "Coupons"
  // on the products page reloaded the page itself, and "Integrations" landed
  // in Earnings. No screen (besides the tests and the routes themselves) links to them.
  it("no card or link on the screens points to the addresses that only redirect", () => {
    const files = ["components", "data"].flatMap((dir) =>
      readdirSync(join(process.cwd(), "src", dir), { recursive: true, encoding: "utf8" })
        .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
        .map((file) => join("src", dir, file)),
    );

    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) =>
      /["'`]\/teach\/(team|integrations|coupons)["'`?]/.test(readFileSync(join(process.cwd(), file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
