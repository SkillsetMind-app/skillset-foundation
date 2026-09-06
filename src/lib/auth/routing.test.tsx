import { describe, expect, it } from "vitest";

import type { SkillsetUser } from "@/domain/auth";
import {
  getPrimaryWorkspaceHref,
  getSafeReturnTo,
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
});
