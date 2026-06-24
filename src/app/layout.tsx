import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ConsoleSignature } from "@/components/shared/console-signature";
import { CookieConsent } from "@/components/site/cookie-consent";
import { PostHogProvider } from "@/app/posthog-provider";
import { brand } from "@/data/brand";
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: brand.title,
  description: brand.description,
  icons: {
    icon: brand.faviconUrl,
    shortcut: brand.faviconUrl,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${cormorant.variable} h-full scroll-smooth`}
    >
      <body className="min-h-full bg-[var(--color-base)] text-[var(--color-ink)] antialiased">
        <ConsoleSignature />
        <PostHogProvider>
          <AuthProvider>{children}</AuthProvider>
          <CookieConsent />
        </PostHogProvider>
      </body>
    </html>
  );
}
