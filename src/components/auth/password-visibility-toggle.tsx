"use client";

import { Eye, EyeOff } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";

// The eye that shows the password, the same on every password field (sign in, signup,
// password change and Security tab). It only toggles the field `type`, which keeps
// the same value. It goes inside a `relative` around the field, which reserves the
// space with `pr-11`. The 44px width is fixed here: on the Security tab, outside
// the entry screens, no rule guaranteed the touch target. The name is a
// single one ("Show password") and the state comes from aria-pressed: swapping both gave
// "Hide password, pressed", which contradicts itself. It stays OUTSIDE the field <label>,
// otherwise the button name enters the field name.
export function PasswordVisibilityToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t("auth.showPassword")}
      aria-pressed={visible}
      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
    >
      {visible ? (
        <EyeOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Eye className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
