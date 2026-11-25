/**
 * UI primitives. All of them read the existing design variables
 * (--color-*, --radius-*, --shadow-*); none invents a new value.
 *
 * WARNING ABOUT className
 * -----------------------
 * `cn()` uses tailwind-merge, which resolves conflicts between UTILITIES
 * (rounded-[10px] against rounded-[14px] — the last one wins). It knows nothing
 * about the global classes in globals.css. Since .button-solid, .button-outline
 * and .button-danger define `color` with !important (globals.css:1008, 1062,
 * 1087), passing className="text-red-500" to a Button does NOT change the
 * text color: the !important beats any utility. If a screen needs another
 * text color on the button, that calls for a new variant in the global CSS, not a
 * prop here.
 */
export { Button, buttonClasses } from "@/components/ui/button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "@/components/ui/button";
export { BusyLabel } from "@/components/ui/busy-label";
export type { BusyLabelProps } from "@/components/ui/busy-label";
export { Card } from "@/components/ui/card";
export type { CardProps } from "@/components/ui/card";
// Client component ("use client" in the file): can be imported from here
// by another client component; in a server page, only as a child.
export { ConfirmDialog } from "@/components/ui/confirm-dialog";
export type { ConfirmDialogProps } from "@/components/ui/confirm-dialog";
export { EmptyState } from "@/components/ui/empty-state";
export type { EmptyStateProps } from "@/components/ui/empty-state";
export { Eyebrow } from "@/components/ui/eyebrow";
export type { EyebrowProps } from "@/components/ui/eyebrow";
export { Field } from "@/components/ui/field";
export type { FieldA11y, FieldProps } from "@/components/ui/field";
export { InlineAlert } from "@/components/ui/inline-alert";
export type { InlineAlertProps } from "@/components/ui/inline-alert";
export { ProgressBar } from "@/components/ui/progress-bar";
export type { ProgressBarProps } from "@/components/ui/progress-bar";
export { SectionHeader } from "@/components/ui/section-header";
export type { SectionHeaderProps } from "@/components/ui/section-header";
