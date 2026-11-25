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

  // Title and description are the page's, until the screen below says otherwise (the
  // short teaching activation in /onboarding, for example): page-heading.tsx.
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
