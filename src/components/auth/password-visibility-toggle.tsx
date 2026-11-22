"use client";

import { Eye, EyeOff } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";

// O olho de mostrar a senha, o mesmo em todo campo de senha (entrar, cadastro,
// troca de senha e aba Segurança). Só alterna o `type` do campo, que fica com
// o mesmo valor. Vai dentro de um `relative` em volta do campo, que reserva o
// espaço com `pr-11`. A largura de 44px é cravada aqui: na aba Segurança, fora
// das telas de entrada, nenhuma regra garantia o alvo de toque.
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
      aria-label={t(visible ? "auth.hidePassword" : "auth.showPassword")}
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
