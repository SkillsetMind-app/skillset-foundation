import { describe, expect, it } from "vitest";

import {
  getPermissionDefinition,
  getRolePermissions,
  getSubjectPermissions,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  hasRole,
  isPermission,
  isRole,
  permissionKeys,
  roleHasPermission,
} from "./index";

describe("permissions", () => {
  it("maps core roles to expected baseline permissions", () => {
    expect(roleHasPermission("guest", "auth.signIn")).toBe(true);
    expect(roleHasPermission("student", "payments.checkout")).toBe(true);
    expect(roleHasPermission("teacher", "teacherStudio.access")).toBe(true);
    expect(roleHasPermission("moderator", "community.moderate")).toBe(true);
    expect(roleHasPermission("support", "users.support")).toBe(true);
  });

  it("keeps privileged capabilities away from lower roles", () => {
    expect(roleHasPermission("guest", "payments.checkout")).toBe(false);
    expect(roleHasPermission("student", "teacherStudio.access")).toBe(false);
    expect(roleHasPermission("teacher", "courses.publish")).toBe(true);
    expect(roleHasPermission("teacher", "courses.submitForReview")).toBe(false);
    expect(roleHasPermission("teacher", "certificates.issue")).toBe(false);
    expect(roleHasPermission("support", "platform.accessAdmin")).toBe(false);
    expect(roleHasPermission("moderator", "certificates.revoke")).toBe(false);
  });

  it("grants ops course review without escalation or destructive powers", () => {
    expect(isRole("ops")).toBe(true);
    expect(roleHasPermission("ops", "platform.accessAdmin")).toBe(true);
    expect(roleHasPermission("ops", "courses.publish")).toBe(true);
    expect(roleHasPermission("ops", "courses.manageAll")).toBe(true);
    expect(roleHasPermission("ops", "users.manage")).toBe(false);
    expect(roleHasPermission("ops", "payments.refund")).toBe(false);
    expect(roleHasPermission("ops", "certificates.issue")).toBe(false);
  });

  it("grants admins every declared permission", () => {
    expect(getRolePermissions("admin")).toEqual(permissionKeys);
  });

  it("evaluates role subjects and explicit permission grants", () => {
    const subject = {
      role: "student" as const,
      permissions: ["teacherStudio.access" as const],
    };

    expect(hasRole(subject, "student")).toBe(true);
    expect(hasPermission(subject, "payments.checkout")).toBe(true);
    expect(hasPermission(subject, "teacherStudio.access")).toBe(true);
    expect(hasAllPermissions(subject, ["courses.enroll", "community.post"])).toBe(
      true,
    );
    expect(hasAnyPermission(subject, ["certificates.revoke", "users.support"])).toBe(
      false,
    );
    expect(getSubjectPermissions(subject)).toContain("teacherStudio.access");
  });

  it("guards runtime role and permission strings", () => {
    expect(isRole("teacher")).toBe(true);
    expect(isRole("owner")).toBe(false);
    expect(isPermission("firebaseIntegration.read")).toBe(true);
    expect(isPermission("firebase.read")).toBe(false);
    expect(getPermissionDefinition("community.post")?.area).toBe("community");
  });
});
