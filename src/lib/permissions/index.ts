type Values<T> = T[keyof T];

export const roles = [
  "guest",
  "student",
  "teacher",
  "admin",
  "support",
  "moderator",
  "ops",
] as const;

export type Role = (typeof roles)[number];

export type PermissionArea =
  | "auth"
  | "courses"
  | "payments"
  | "community"
  | "teacherStudio"
  | "certificates"
  | "users"
  | "platform";

export type PermissionDefinition<
  Area extends PermissionArea = PermissionArea,
> = {
  key: `${Area}.${string}`;
  area: Area;
  label: string;
  description: string;
};

export const permissionDefinitions = {
  auth: {
    signIn: {
      key: "auth.signIn",
      area: "auth",
      label: "Sign in",
      description: "Can access sign-in surfaces.",
    },
    signUp: {
      key: "auth.signUp",
      area: "auth",
      label: "Sign up",
      description: "Can access account creation surfaces.",
    },
    signOut: {
      key: "auth.signOut",
      area: "auth",
      label: "Sign out",
      description: "Can end an authenticated session.",
    },
    manageSessions: {
      key: "auth.manageSessions",
      area: "auth",
      label: "Manage sessions",
      description: "Can review and revoke user sessions.",
    },
  },
  courses: {
    readCatalog: {
      key: "courses.readCatalog",
      area: "courses",
      label: "Read course catalog",
      description: "Can view public course catalog content.",
    },
    enroll: {
      key: "courses.enroll",
      area: "courses",
      label: "Enroll in courses",
      description: "Can enroll in available learning experiences.",
    },
    viewLearning: {
      key: "courses.viewLearning",
      area: "courses",
      label: "View learning",
      description: "Can access enrolled learning content.",
    },
    create: {
      key: "courses.create",
      area: "courses",
      label: "Create courses",
      description: "Can create draft course content.",
    },
    submitForReview: {
      key: "courses.submitForReview",
      area: "courses",
      label: "Submit courses for review",
      description: "Can send owned course drafts into the review queue.",
    },
    publish: {
      key: "courses.publish",
      area: "courses",
      label: "Publish courses",
      description: "Can publish teacher-owned course content.",
    },
    manageAll: {
      key: "courses.manageAll",
      area: "courses",
      label: "Manage all courses",
      description: "Can manage course content across the platform.",
    },
  },
  payments: {
    checkout: {
      key: "payments.checkout",
      area: "payments",
      label: "Checkout",
      description: "Can purchase paid learning products.",
    },
    manageSubscriptions: {
      key: "payments.manageSubscriptions",
      area: "payments",
      label: "Manage subscriptions",
      description: "Can manage billing subscriptions.",
    },
    refund: {
      key: "payments.refund",
      area: "payments",
      label: "Refund payments",
      description: "Can issue or request refunds.",
    },
  },
  community: {
    read: {
      key: "community.read",
      area: "community",
      label: "Read community",
      description: "Can view community spaces.",
    },
    post: {
      key: "community.post",
      area: "community",
      label: "Post community content",
      description: "Can create posts and replies in community spaces.",
    },
    moderate: {
      key: "community.moderate",
      area: "community",
      label: "Moderate community",
      description: "Can moderate community posts and replies.",
    },
  },
  teacherStudio: {
    access: {
      key: "teacherStudio.access",
      area: "teacherStudio",
      label: "Access teacher studio",
      description: "Can access teacher studio surfaces.",
    },
    manageCourses: {
      key: "teacherStudio.manageCourses",
      area: "teacherStudio",
      label: "Manage teacher courses",
      description: "Can manage courses in teacher studio.",
    },
    manageStorefront: {
      key: "teacherStudio.manageStorefront",
      area: "teacherStudio",
      label: "Manage instructor storefront",
      description: "Can edit storefront branding and course showcase ordering.",
    },
  },
  certificates: {
    view: {
      key: "certificates.view",
      area: "certificates",
      label: "View certificates",
      description: "Can view earned certificates.",
    },
    issue: {
      key: "certificates.issue",
      area: "certificates",
      label: "Issue certificates",
      description: "Can issue completion certificates.",
    },
    revoke: {
      key: "certificates.revoke",
      area: "certificates",
      label: "Revoke certificates",
      description: "Can revoke issued certificates.",
    },
  },
  users: {
    support: {
      key: "users.support",
      area: "users",
      label: "Support users",
      description: "Can help users with account and learning issues.",
    },
    manage: {
      key: "users.manage",
      area: "users",
      label: "Manage users",
      description: "Can manage user records and roles.",
    },
  },
  platform: {
    viewOps: {
      key: "platform.viewOps",
      area: "platform",
      label: "View operations",
      description: "Can view operational dashboards.",
    },
    accessAdmin: {
      key: "platform.accessAdmin",
      area: "platform",
      label: "Access admin",
      description: "Can access administrative surfaces.",
    },
  },
} as const satisfies {
  [Area in PermissionArea]: Record<string, PermissionDefinition<Area>>;
};

export type PermissionDefinitionGroups = typeof permissionDefinitions;
export type Permission = Values<{
  [Area in keyof PermissionDefinitionGroups]: Values<
    PermissionDefinitionGroups[Area]
  >;
}>["key"];
export type PermissionSubject = {
  role?: Role | null;
  roles?: readonly Role[];
  permissions?: readonly Permission[];
};

export const allPermissionDefinitions = Object.values(
  permissionDefinitions,
).flatMap((group) => Object.values(group)) as PermissionDefinition[];

export const permissionKeys = allPermissionDefinitions.map(
  (definition) => definition.key,
) as Permission[];

const guestPermissions = [
  "auth.signIn",
  "auth.signUp",
  "courses.readCatalog",
  "community.read",
] as const satisfies readonly Permission[];

const studentPermissions = [
  ...guestPermissions,
  "auth.signOut",
  "courses.enroll",
  "courses.viewLearning",
  "payments.checkout",
  "community.post",
  "certificates.view",
] as const satisfies readonly Permission[];

const teacherPermissions = [
  ...studentPermissions,
  "teacherStudio.access",
  "teacherStudio.manageCourses",
  "teacherStudio.manageStorefront",
  "courses.create",
  "courses.publish",
] as const satisfies readonly Permission[];

const supportPermissions = [
  ...guestPermissions,
  "auth.manageSessions",
  "courses.viewLearning",
  "payments.manageSubscriptions",
  "payments.refund",
  "certificates.view",
  "users.support",
  "platform.viewOps",
] as const satisfies readonly Permission[];

const moderatorPermissions = [
  ...studentPermissions,
  "community.moderate",
] as const satisfies readonly Permission[];

// Operations team: handles post-publication compliance exceptions and opens
// the /ops workspace. Deliberately WITHOUT users.manage (no role escalation),
// payments.refund, or certificates.issue/revoke — those stay admin-only.
const opsPermissions = [
  ...studentPermissions,
  "platform.viewOps",
  "platform.accessAdmin",
  "courses.publish",
  "courses.manageAll",
  "community.moderate",
  "users.support",
] as const satisfies readonly Permission[];

export const rolePermissionMatrix: Record<Role, readonly Permission[]> = {
  guest: guestPermissions,
  student: studentPermissions,
  teacher: teacherPermissions,
  admin: permissionKeys,
  support: supportPermissions,
  moderator: moderatorPermissions,
  ops: opsPermissions,
};

const roleSet: ReadonlySet<string> = new Set(roles);
const permissionSet: ReadonlySet<string> = new Set(permissionKeys);
const permissionDefinitionsByKey = new Map(
  allPermissionDefinitions.map((definition) => [definition.key, definition]),
);

export function isRole(value: string): value is Role {
  return roleSet.has(value);
}

export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}

export function getPermissionDefinition(
  permission: Permission,
): PermissionDefinition | undefined {
  return permissionDefinitionsByKey.get(permission);
}

export function getRolePermissions(role: Role): readonly Permission[] {
  return rolePermissionMatrix[role];
}

export function roleHasPermission(
  role: Role,
  permission: Permission,
): boolean {
  return rolePermissionMatrix[role].includes(permission);
}

export function getSubjectPermissions(
  subject: Role | PermissionSubject | null | undefined,
): readonly Permission[] {
  return Array.from(getSubjectPermissionSet(subject));
}

export function hasRole(
  subject: Role | PermissionSubject | null | undefined,
  role: Role,
): boolean {
  if (!subject) {
    return false;
  }

  if (typeof subject === "string") {
    return subject === role;
  }

  return subject.role === role || subject.roles?.includes(role) === true;
}

export function hasPermission(
  subject: Role | PermissionSubject | null | undefined,
  permission: Permission,
): boolean {
  return getSubjectPermissionSet(subject).has(permission);
}

export function hasAnyPermission(
  subject: Role | PermissionSubject | null | undefined,
  permissions: readonly Permission[],
): boolean {
  const subjectPermissions = getSubjectPermissionSet(subject);

  return permissions.some((permission) => subjectPermissions.has(permission));
}

export function hasAllPermissions(
  subject: Role | PermissionSubject | null | undefined,
  permissions: readonly Permission[],
): boolean {
  const subjectPermissions = getSubjectPermissionSet(subject);

  return permissions.every((permission) => subjectPermissions.has(permission));
}

function getSubjectPermissionSet(
  subject: Role | PermissionSubject | null | undefined,
): Set<Permission> {
  const permissions = new Set<Permission>();

  if (!subject) {
    return permissions;
  }

  if (typeof subject === "string") {
    addRolePermissions(permissions, subject);

    return permissions;
  }

  if (subject.role) {
    addRolePermissions(permissions, subject.role);
  }

  subject.roles?.forEach((role) => addRolePermissions(permissions, role));
  subject.permissions?.forEach((permission) => permissions.add(permission));

  return permissions;
}

function addRolePermissions(permissions: Set<Permission>, role: Role): void {
  rolePermissionMatrix[role].forEach((permission) => permissions.add(permission));
}
