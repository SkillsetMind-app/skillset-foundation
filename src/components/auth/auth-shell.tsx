import type { ReactNode } from "react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { PageHeadingProvider, PageHeadingText } from "@/components/auth/page-heading";
import { getServerTranslation } from "@/lib/i18n/server";

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
};

export async function AuthShell({ title, description, children, footer }: AuthShellProps) {
  const { t } = await getServerTranslation();

  // Titulo e descricao sao os da pagina, ate a tela de baixo dizer outro (a
  // ativacao curta do ensino em /onboarding, por exemplo): page-heading.tsx.
  return (
    <AuthFrame homeLabel={t("auth.page.backToHome")}>
      <PageHeadingProvider>
        <h1 className="auth-title display-title">
          <PageHeadingText part="title" fallback={title} />
        </h1>
        <p className="auth-description">
          <PageHeadingText part="description" fallback={description} />
        </p>
        {children}
        <div className="auth-footer">{footer}</div>
      </PageHeadingProvider>
    </AuthFrame>
  );
}
