import { describe, expect, it } from "vitest";

import type { SkillsetUser } from "@/domain/auth";
import type { UserProfile } from "@/domain/user-profile";
import {
  getEntryReturnTo,
  getOnboardedReturnTo,
  getPlanCheckoutReturnTo,
  getPlanCheckoutRoute,
  getPostAuthRoute,
  getPrimaryWorkspaceHref,
  getSafeReturnTo,
  getTeacherOnboardingRoute,
  getWorkspaceHomeHref,
} from "@/lib/auth/routing";

describe("workspace routing", () => {
  it("maps each role to its primary workspace", () => {
    expect(getPrimaryWorkspaceHref({ roles: ["student"] })).toBe("/learn");
    expect(getPrimaryWorkspaceHref({ roles: ["teacher"] })).toBe("/teach");
    expect(getPrimaryWorkspaceHref({ roles: ["admin"] })).toBe("/ops");
  });

  it("sends a role to /ops only when it can actually open /ops", () => {
    // /ops gates on platform.accessAdmin. "ops" holds it and used to be
    // stranded on /learn; "support" does not and used to land on a denial
    // screen. Routing asks the permission now, so both agree with the gate.
    expect(getPrimaryWorkspaceHref({ roles: ["ops"] })).toBe("/ops");
    expect(getPrimaryWorkspaceHref({ roles: ["support"] })).toBe("/learn");
  });

  it("keeps application chrome inside the active workspace", () => {
    const teacher = {
      roles: ["teacher"],
    } satisfies Pick<SkillsetUser, "roles">;

    expect(getWorkspaceHomeHref("/teach/builder", teacher)).toBe("/teach");
    expect(getWorkspaceHomeHref("/learn/courses/example", teacher)).toBe("/learn");
    expect(getWorkspaceHomeHref("/account/profile", teacher)).toBe("/teach");
    expect(getWorkspaceHomeHref("/account/payments", null)).toBe("/teach");
  });
});

describe("explicit workspace intent after sign-in", () => {
  const student: UserProfile = {
    uid: "student-1", email: "learner@example.test", displayName: "Learner",
    photoURL: null, roles: ["student"], onboardingCompleted: true,
    onboardingPath: "student",
    createdAt: "2026-09-06T00:00:00Z",
    updatedAt: "2026-09-06T00:00:00Z",
    lastLoginAt: "2026-09-06T00:00:00Z",
  };

  it("sends an onboarded learner asking to teach to teacher onboarding without changing roles", () => {
    expect(getPostAuthRoute(student, "teacher")).toBe("/onboarding?path=teacher");
    expect(student.roles).toEqual(["student"]);
    expect(student.onboardingPath).toBe("student");
  });

  it("opens the requested workspace for a teacher who also has operations access", () => {
    const teacher: UserProfile = { ...student, roles: ["student", "teacher", "admin"] };
    expect(getPostAuthRoute(teacher, "teacher")).toBe("/teach");
    expect(getPostAuthRoute(teacher, "student")).toBe("/learn");
    expect(getPostAuthRoute(teacher)).toBe("/ops");
  });

  it("still requires the initial onboarding before either workspace", () => {
    expect(getPostAuthRoute({ ...student, onboardingCompleted: false }, "teacher"))
      .toBe("/welcome?path=teacher");
    expect(getPostAuthRoute(null, "student")).toBe("/welcome?path=student");
  });
});

describe("post-login return paths", () => {
  it.each(["\t", "\n", "\r"])("rejects a browser-normalized external destination (%j)", (control) => {
    const raw = `/${control}/attacker.example`;
    const params = new URLSearchParams(`returnTo=${encodeURIComponent(raw)}`);

    // Next's client router resolves with URL too: these bytes become //host.
    expect(new URL(raw, "https://skillsetmind.com").origin).toBe("https://attacker.example");
    expect(getSafeReturnTo(params)).toBeNull();
  });

  it("preserves a local course link with its query and fragment", () => {
    const path = "/courses/example?offer=annual#checkout";
    expect(getSafeReturnTo(new URLSearchParams({ returnTo: path }))).toBe(path);
  });

  // Each string is judged the way the browser will read it: dot segments
  // resolved, percent escapes decoded. None may leave the site or loop sign-in.
  it.each([
    "//evil.com",
    "/\\evil.com",
    "/..//evil.com",
    "/.//evil.com",
    "/%2e%2e//evil.com",
    "/%2F%2Fevil.com",
    "/%2f/evil.com",
    "/.%2F/evil.com",
    "/%5Cevil.com",
    "/%5cevil.com",
    "%2F%2Fevil.com",
    "/%09/evil.com",
    "/%0a/evil.com",
    "/\u0000/evil.com",
    "/\u007f/evil.com",
    "/courses/\\evil.com",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "https://evil.com",
    "http:evil.com",
    "evil.com",
    "/%",
    "/./login",
    "/x/../login?next=route",
    "/%6Cogin",
    "/loading#x",
  ])("rejects %j", (returnTo) => {
    expect(getSafeReturnTo(new URLSearchParams({ returnTo }))).toBeNull();
  });

  it.each([
    ["/courses/x/../focus", "/courses/focus"],
    ["/./courses/focus", "/courses/focus"],
    ["/courses/focus?ref=a%2Fb", "/courses/focus?ref=a%2Fb"],
    ["/courses/a b", "/courses/a%20b"],
  ])("returns the resolved path for %j", (returnTo, expected) => {
    expect(getSafeReturnTo(new URLSearchParams({ returnTo }))).toBe(expected);
  });
});

// A /pricing button carries the plan and the cycle; they reach the card screen
// (/account/billing/upgrade) as an ordinary returnTo.
describe("plan picked on /pricing", () => {
  const card = (plan: string, cycle: string) => `/account/billing/upgrade?plan=${plan}&cycle=${cycle}`;

  it.each(["basic", "starter", "pro"].flatMap((plan) => ["monthly", "yearly"].map((cycle) => [plan, cycle])))(
    "opens the card screen for %s %s",
    (plan, cycle) => {
      expect(getPlanCheckoutRoute(new URLSearchParams({ plan, cycle }))).toBe(card(plan, cycle));
    },
  );

  // Closed list: Enterprise (`plus`), the no-plan state, another casing, an
  // extra value, a missing half. None of them is a choice.
  it.each([
    ["plus", "monthly"],
    ["free", "monthly"],
    ["enterprise", "yearly"],
    ["Starter", "monthly"],
    ["starter", "weekly"],
    ["starter", "Yearly"],
    ["starter", ""],
    ["", "monthly"],
    ["pro&cycle=yearly", "monthly"],
    ["//evil.example", "monthly"],
  ])("ignores plan %j with cycle %j", (plan, cycle) => {
    const params = new URLSearchParams({ plan, cycle });
    expect(getPlanCheckoutRoute(params)).toBeNull();
    expect(getEntryReturnTo(params)).toBeNull();
  });

  it("ignores a plan with no cycle and a cycle with no plan", () => {
    expect(getPlanCheckoutRoute(new URLSearchParams("plan=pro"))).toBeNull();
    expect(getPlanCheckoutRoute(new URLSearchParams("cycle=yearly"))).toBeNull();
    expect(getPlanCheckoutRoute(new URLSearchParams())).toBeNull();
  });

  it("gives the entry the plan only when no deep link came with it", () => {
    expect(getEntryReturnTo(new URLSearchParams("plan=pro&cycle=yearly"))).toBe(card("pro", "yearly"));
    expect(getEntryReturnTo(new URLSearchParams({ plan: "pro", cycle: "yearly", returnTo: "/courses/focus" })))
      .toBe("/courses/focus");
    expect(getEntryReturnTo(new URLSearchParams("path=teacher"))).toBeNull();
  });

  it("recognises only the card screen of a plan on offer as that choice", () => {
    expect(getPlanCheckoutReturnTo(card("starter", "monthly"))).toBe(card("starter", "monthly"));
    // Rebuilt, never echoed: anything extra on the link is dropped.
    expect(getPlanCheckoutReturnTo(`${card("starter", "monthly")}&coupon=x#pay`)).toBe(card("starter", "monthly"));
    for (const other of [
      null,
      "",
      "/courses/focus",
      "/teach?plan=pro&cycle=yearly",
      card("plus", "monthly"),
      card("pro", "weekly"),
      "/account/billing/upgrade",
      "/account/billing/upgrade/x?plan=pro&cycle=yearly",
      "https://evil.example/account/billing/upgrade?plan=pro&cycle=yearly",
      "//evil.example/account/billing/upgrade?plan=pro&cycle=yearly",
    ]) {
      expect(getPlanCheckoutReturnTo(other)).toBeNull();
    }
  });

  it("carries only that choice into teacher activation", () => {
    expect(getTeacherOnboardingRoute()).toBe("/onboarding?path=teacher");
    expect(getTeacherOnboardingRoute("/courses/focus")).toBe("/onboarding?path=teacher");
    expect(getTeacherOnboardingRoute(card("plus", "monthly"))).toBe("/onboarding?path=teacher");
    expect(getTeacherOnboardingRoute(card("pro", "yearly"))).toBe(
      "/onboarding?path=teacher&returnTo=%2Faccount%2Fbilling%2Fupgrade%3Fplan%3Dpro%26cycle%3Dyearly",
    );
  });

  it("opens the card screen only for a teacher with no plan yet", () => {
    const choice = card("starter", "yearly");
    expect(getOnboardedReturnTo({ roles: ["teacher"] }, choice)).toBe(choice);
    expect(getOnboardedReturnTo({ roles: ["teacher"], currentPlanId: "free" }, choice)).toBe(choice);
    // Already on a plan (bought or granted): null, the usual route.
    expect(getOnboardedReturnTo({ roles: ["teacher"], currentPlanId: "basic" }, choice)).toBeNull();
    expect(getOnboardedReturnTo({ roles: ["teacher"], currentPlanId: "plus" }, choice)).toBeNull();
    // Not teaching yet: activation first, with the choice.
    expect(getOnboardedReturnTo({ roles: ["student"] }, choice)).toBe(getTeacherOnboardingRoute(choice));
    expect(getOnboardedReturnTo({ roles: ["student"] }, choice, "teacher")).toBe(getTeacherOnboardingRoute(choice));
    // Through the learner entry nobody opens a plan: null, the usual route.
    expect(getOnboardedReturnTo({ roles: ["teacher"] }, choice, "student")).toBeNull();
    expect(getOnboardedReturnTo({ roles: ["student"] }, choice, "student")).toBeNull();
  });

  // A repeated parameter is read the way the card screen reads it (the first
  // one), and the route that comes out carries a single plan and cycle.
  it("reads a repeated parameter by its first value only", () => {
    expect(getPlanCheckoutRoute(new URLSearchParams("plan=pro&plan=plus&cycle=yearly&cycle=weekly")))
      .toBe(card("pro", "yearly"));
    expect(getPlanCheckoutRoute(new URLSearchParams("plan=plus&plan=pro&cycle=yearly"))).toBeNull();
    expect(getPlanCheckoutReturnTo("/account/billing/upgrade?plan=plus&plan=pro&cycle=yearly")).toBeNull();
  });

  it("leaves every other deep link exactly as it was", () => {
    expect(getOnboardedReturnTo({ roles: ["student"] }, "/courses/focus/checkout?offer=LAUNCH"))
      .toBe("/courses/focus/checkout?offer=LAUNCH");
    expect(getOnboardedReturnTo({ roles: ["teacher"], currentPlanId: "pro" }, "/teach/courses")).toBe("/teach/courses");
    expect(getOnboardedReturnTo({ roles: ["student"] }, "/courses/focus", "student")).toBe("/courses/focus");
    expect(getOnboardedReturnTo({ roles: ["student"] }, null)).toBeNull();
  });
});
