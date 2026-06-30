type Values<T> = T[keyof T];

export type FeatureFlagArea =
  | "auth"
  | "payments"
  | "community"
  | "teacherStudio"
  | "certificates"
  | "firebaseIntegration";

export type FeatureFlagDefinition<
  Area extends FeatureFlagArea = FeatureFlagArea,
> = {
  key: `${Area}.${string}`;
  area: Area;
  label: string;
  description: string;
  defaultEnabled: boolean;
};

export const featureFlagDefinitions = {
  auth: {
    emailPassword: {
      key: "auth.emailPassword",
      area: "auth",
      label: "Email/password auth",
      description: "Allows learners and staff to sign in with email credentials.",
      defaultEnabled: true,
    },
    passwordReset: {
      key: "auth.passwordReset",
      area: "auth",
      label: "Password reset",
      description: "Allows users to request password reset flows.",
      defaultEnabled: true,
    },
    mfa: {
      key: "auth.mfa",
      area: "auth",
      label: "Two-factor authentication",
      description:
        "Enables TOTP two-factor enrollment and the sign-in challenge. Requires Firebase Identity Platform (MFA) to be enabled on the project.",
      defaultEnabled: false,
    },
  },
  payments: {
    checkout: {
      key: "payments.checkout",
      area: "payments",
      label: "Checkout",
      description: "Enables paid course and subscription checkout surfaces.",
      defaultEnabled: false,
    },
    subscriptions: {
      key: "payments.subscriptions",
      area: "payments",
      label: "Subscriptions",
      description: "Enables recurring subscription management.",
      defaultEnabled: false,
    },
  },
  community: {
    spaces: {
      key: "community.spaces",
      area: "community",
      label: "Community spaces",
      description: "Enables learner and instructor community spaces.",
      defaultEnabled: true,
    },
    discussions: {
      key: "community.discussions",
      area: "community",
      label: "Discussions",
      description: "Enables threaded community discussions.",
      defaultEnabled: true,
    },
  },
  teacherStudio: {
    dashboard: {
      key: "teacherStudio.dashboard",
      area: "teacherStudio",
      label: "Teacher dashboard",
      description: "Enables the teacher studio dashboard shell.",
      defaultEnabled: false,
    },
    courseBuilder: {
      key: "teacherStudio.courseBuilder",
      area: "teacherStudio",
      label: "Course builder",
      description: "Enables teacher-owned course authoring tools.",
      defaultEnabled: false,
    },
  },
  certificates: {
    issuance: {
      key: "certificates.issuance",
      area: "certificates",
      label: "Certificate issuance",
      description: "Enables issuing completion certificates.",
      defaultEnabled: false,
    },
    sharing: {
      key: "certificates.sharing",
      area: "certificates",
      label: "Certificate sharing",
      description: "Enables public certificate sharing links.",
      defaultEnabled: false,
    },
  },
  firebaseIntegration: {
    enabled: {
      key: "firebaseIntegration.enabled",
      area: "firebaseIntegration",
      label: "Firebase integration",
      description: "Enables Firebase-backed platform integration points.",
      defaultEnabled: true,
    },
    cloudStorage: {
      key: "firebaseIntegration.cloudStorage",
      area: "firebaseIntegration",
      label: "Firebase cloud storage",
      description: "Enables Firebase Cloud Storage for uploaded assets.",
      defaultEnabled: false,
    },
  },
} as const satisfies {
  [Area in FeatureFlagArea]: Record<string, FeatureFlagDefinition<Area>>;
};

export type FeatureFlagDefinitionGroups = typeof featureFlagDefinitions;
export type FeatureFlag = Values<{
  [Area in keyof FeatureFlagDefinitionGroups]: Values<
    FeatureFlagDefinitionGroups[Area]
  >;
}>;
export type FeatureFlagKey = FeatureFlag["key"];
export type FeatureFlagState = Record<FeatureFlagKey, boolean>;
export type FeatureFlagOverrides = Partial<FeatureFlagState>;

export const allFeatureFlagDefinitions = Object.values(
  featureFlagDefinitions,
).flatMap((group) => Object.values(group)) as FeatureFlag[];

export const featureFlagKeys = allFeatureFlagDefinitions.map(
  (definition) => definition.key,
) as FeatureFlagKey[];

export const defaultFeatureFlags = Object.freeze(
  Object.fromEntries(
    allFeatureFlagDefinitions.map((definition) => [
      definition.key,
      definition.defaultEnabled,
    ]),
  ),
) as Readonly<FeatureFlagState>;

const featureFlagDefinitionsByKey = new Map<FeatureFlagKey, FeatureFlag>(
  allFeatureFlagDefinitions.map((definition) => [definition.key, definition]),
);

const featureFlagKeySet: ReadonlySet<string> = new Set(featureFlagKeys);

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return featureFlagKeySet.has(value);
}

export function getFeatureFlagDefinition(
  key: FeatureFlagKey,
): FeatureFlag | undefined {
  return featureFlagDefinitionsByKey.get(key);
}

export function getFeatureFlagsByArea(
  area: FeatureFlagArea,
): readonly FeatureFlag[] {
  return Object.values(featureFlagDefinitions[area]) as FeatureFlag[];
}

export function createFeatureFlags(
  overrides: FeatureFlagOverrides = {},
): FeatureFlagState {
  return {
    ...defaultFeatureFlags,
    ...overrides,
  };
}

export function isFeatureEnabled(
  flags: FeatureFlagOverrides | undefined,
  key: FeatureFlagKey,
): boolean {
  return flags?.[key] ?? defaultFeatureFlags[key];
}

export function getPublicFeatureFlagOverrides(): FeatureFlagOverrides {
  const overrides: FeatureFlagOverrides = {};
  const checkoutFlag = process.env.NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED;

  if (checkoutFlag === "true" || checkoutFlag === "false") {
    overrides["payments.checkout"] = checkoutFlag === "true";
  }

  const mfaFlag = process.env.NEXT_PUBLIC_AUTH_MFA_ENABLED;

  if (mfaFlag === "true" || mfaFlag === "false") {
    overrides["auth.mfa"] = mfaFlag === "true";
  }

  return overrides;
}

export function isPublicFeatureEnabled(key: FeatureFlagKey): boolean {
  return isFeatureEnabled(getPublicFeatureFlagOverrides(), key);
}
