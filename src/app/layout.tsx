import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Cormorant_Garamond, Inter, Manrope } from "next/font/google";
import { AuthProvider } from "@/components/auth/auth-provider";
import { LessonUploadProvider } from "@/components/teacher/lesson-upload-provider";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { ConsoleSignature } from "@/components/shared/console-signature";
import { CookieConsent } from "@/components/site/cookie-consent";
import { RealCoursesProvider } from "@/components/site/real-courses";
import { PostHogProvider } from "@/app/posthog-provider";
import { brand } from "@/data/brand";
import { hasRealPublishedCourse } from "@/lib/data/server/public-course";
import { DEFAULT_LOCALE, LOCALE_HTML_LANG } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getServerLocale, getServerTranslation } from "@/lib/i18n/server";
import { SITE_URL } from "@/lib/seo/page-metadata";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Design V2: Inter for tabular numeric display (--font-num / .num utility).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Also stamps html.js: globals.css hides .reveal-on-view sections only under
// that class, so a visitor without JavaScript still sees the whole page.
const themeInitScript = `
(() => {
  document.documentElement.classList.add("js");
  try {
    const mode = window.localStorage.getItem("skillset_theme");
    const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = mode === "dark" || (mode === "system" && systemDark) ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
`;

// Título padrão de toda página sem título próprio (a sala de aula e o estúdio
// inteiros): segue o idioma, como o <html lang> logo abaixo.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return {
    metadataBase: new URL(SITE_URL),
    title: t("siteMetadata.title"),
    description: t("siteMetadata.description"),
    icons: {
      icon: "/favicon.ico",
      shortcut: "/favicon.ico",
      apple: brand.faviconUrl,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Há curso real publicado? Lido uma vez aqui (anônimo, cache de 5 min) para
  // as ilhas cliente que linkam a loja não buscarem nada no navegador.
  const [locale, hasRealCourses] = await Promise.all([getServerLocale(), hasRealPublishedCourse()]);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={LOCALE_HTML_LANG[locale]}
      className={`${manrope.variable} ${cormorant.variable} ${inter.variable} h-full scroll-smooth`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-[var(--color-base)] text-[var(--color-ink)] antialiased">
        <ConsoleSignature />
        <PostHogProvider>
          <I18nProvider
            initialLocale={locale}
            // Only English is in the client bundle; any other locale rides along
            // with the page so the first render (and hydration) is already in it.
            initialDictionary={locale === DEFAULT_LOCALE ? undefined : getDictionary(locale)}
          >
            <RealCoursesProvider value={hasRealCourses}>
              <AuthProvider><LessonUploadProvider>{children}</LessonUploadProvider></AuthProvider>
            </RealCoursesProvider>
            <CookieConsent />
          </I18nProvider>
        </PostHogProvider>
        {/* Vercel Web Analytics + Speed Insights — enable both in Vercel project settings (Analytics / Speed Insights). */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
