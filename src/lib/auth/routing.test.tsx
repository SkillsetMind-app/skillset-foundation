import { describe, expect, it } from "vitest";

import type { SkillsetUser } from "@/domain/auth";
import {
  getPrimaryWorkspaceHref,
  getWorkspaceHomeHref,
} from "@/lib/auth/routing";

describe("workspace routing", () => {
  it("maps each role to its primary workspace", () => {
    expect(getPrimaryWorkspaceHref({ roles: ["student"] })).toBe("/learn");
    expect(getPrimaryWorkspaceHref({ roles: ["teacher"] })).toBe("/teach");
    expect(getPrimaryWorkspaceHref({ roles: ["support"] })).toBe("/ops");
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
