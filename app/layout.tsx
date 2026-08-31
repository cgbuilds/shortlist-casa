import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import { BRAND_BLURB, BRAND_NAME, BRAND_TAGLINE, BRAND_URL } from "@/lib/brand";
import "./globals.css";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

const sans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(BRAND_URL),
  title: BRAND_NAME,
  description: BRAND_TAGLINE,
  applicationName: BRAND_NAME,
  openGraph: {
    title: BRAND_NAME,
    description: BRAND_BLURB,
    url: BRAND_URL,
    siteName: BRAND_NAME,
    type: "website",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "overlays-content",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${display.variable} ${sans.variable} antialiased`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
