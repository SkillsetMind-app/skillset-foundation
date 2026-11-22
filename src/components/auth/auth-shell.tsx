import type { ReactNode } from "react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { getServerTranslation } from "@/lib/i18n/server";

type AuthShellProps = {
  title: string;
  /** Sem descricao, a propria tela escreve a sua (a ativacao do ensino). */
  description?: string;
  children: ReactNode;
  footer: ReactNode;
};

export async function AuthShell({ title, description, children, footer }: AuthShellProps) {
  const { t } = await getServerTranslation();

  return (
    <AuthFrame homeLabel={t("auth.page.backToHome")}>
      <h1 className="auth-title display-title">{title}</h1>
      {description ? <p className="auth-description">{description}</p> : null}
      {children}
      <div className="auth-footer">{footer}</div>
    </AuthFrame>
  );
}
