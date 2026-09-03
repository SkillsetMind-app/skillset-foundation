/**
 * Primitivos de UI. Todos leem as variáveis de design existentes
 * (--color-*, --radius-*, --shadow-*); nenhum inventa valor novo.
 *
 * AVISO SOBRE className
 * ---------------------
 * `cn()` usa tailwind-merge, que resolve conflito entre UTILITÁRIOS
 * (rounded-[10px] contra rounded-[14px] — o último vence). Ele não sabe nada
 * sobre as classes globais do globals.css. Como .button-solid, .button-outline
 * e .button-danger definem `color` com !important (globals.css:1008, 1062,
 * 1087), passar className="text-red-500" para um Button NÃO troca a cor do
 * texto: o !important vence qualquer utilitário. Se uma tela precisar de outra
 * cor de texto no botão, isso pede uma variante nova no CSS global, não uma
 * prop aqui.
 */
export { Button, buttonClasses } from "@/components/ui/button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "@/components/ui/button";
export { Card } from "@/components/ui/card";
export type { CardProps } from "@/components/ui/card";
export { EmptyState } from "@/components/ui/empty-state";
export type { EmptyStateProps } from "@/components/ui/empty-state";
export { Eyebrow } from "@/components/ui/eyebrow";
export type { EyebrowProps } from "@/components/ui/eyebrow";
export { Field } from "@/components/ui/field";
export type { FieldA11y, FieldProps } from "@/components/ui/field";
export { InlineAlert } from "@/components/ui/inline-alert";
export type { InlineAlertProps } from "@/components/ui/inline-alert";
export { SectionHeader } from "@/components/ui/section-header";
export type { SectionHeaderProps } from "@/components/ui/section-header";
