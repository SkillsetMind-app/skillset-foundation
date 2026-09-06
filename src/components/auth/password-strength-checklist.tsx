"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";

import { Circle, CircleCheck } from "lucide-react";

type PasswordRequirement = {
  id: string;
  label: string;
  test: (password: string) => boolean;
};

const passwordRequirements: PasswordRequirement[] = [
  {
    id: "length",
    label: "At least 8 characters",
    test: (password) => password.length >= 8,
  },
  {
    id: "uppercase",
    label: "At least one uppercase letter (A-Z)",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "At least one lowercase letter (a-z)",
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: "number",
    label: "At least one number (0-9)",
    test: (password) => /\d/.test(password),
  },
  {
    id: "special",
    label: "At least one special character (!@#$%^&*)",
    test: (password) => /[!@#$%^&*]/.test(password),
  },
];

export function getPasswordRequirementState(password: string) {
  return passwordRequirements.map((requirement) => ({
    ...requirement,
    met: requirement.test(password),
  }));
}

export function isStrongPassword(password: string) {
  return getPasswordRequirementState(password).every((requirement) => requirement.met);
}

export function PasswordStrengthChecklist({ password }: { password: string }) {
  const { t } = useTranslation();
  const requirements = getPasswordRequirementState(password);

  return (
    <div className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
        {t("authFlow.passwordRules.title")}
      </p>
      <ul className="mt-2 grid gap-1.5">
        {requirements.map((requirement) => {
          const Icon = requirement.met ? CircleCheck : Circle;

          return (
            <li
              key={requirement.id}
              className={`flex items-center gap-2 text-xs leading-5 ${
                requirement.met
                  ? "text-[var(--color-success-fg)]"
                  : "text-[var(--color-ink-soft)]"
              }`}
            >
              <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
              <span className={requirement.met ? "line-through decoration-1" : ""}>
                {t(`authFlow.passwordRules.${requirement.id}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
