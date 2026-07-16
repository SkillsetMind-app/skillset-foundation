import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Cormorant_Garamond, Inter, Manrope } from "next/font/google";
import { AuthProvider } from "@/components/auth/auth-provider";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { ConsoleSignature } from "@/components/shared/console-signature";
import { CookieConsent } from "@/components/site/cookie-consent";
import { PostHogProvider } from "@/app/posthog-provider";
import { brand } from "@/data/brand";
import { LOCALE_HTML_LANG } from "@/lib/i18n/config";
import { getServerLocale } from "@/lib/i18n/server";
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

const themeInitScript = `
(() => {
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: brand.title,
  description: brand.description,
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: brand.faviconUrl,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();

  return (
    <html
      lang={LOCALE_HTML_LANG[locale]}
      className={`${manrope.variable} ${cormorant.variable} ${inter.variable} h-full scroll-smooth`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-[var(--color-base)] text-[var(--color-ink)] antialiased">
        <ConsoleSignature />
        <PostHogProvider>
          <I18nProvider initialLocale={locale}>
            <AuthProvider>{children}</AuthProvider>
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
