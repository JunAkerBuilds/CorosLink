import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = "https://coroslink.vercel.app";
const DESCRIPTION =
  "CorosLink is an unofficial COROS watch companion for desktop — sync music from Spotify, YouTube & Apple Music over USB, install offline maps, build GPX routes, and review your training analytics on macOS, Windows, and Linux.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "CorosLink — Your COROS watch companion for desktop",
    template: "%s | CorosLink",
  },
  description: DESCRIPTION,
  applicationName: "CorosLink",
  keywords: [
    "CorosLink",
    "COROS watch companion",
    "COROS music sync",
    "COROS offline maps",
    "COROS route builder",
    "COROS training analytics",
    "Pace Pro",
    "desktop companion app",
  ],
  authors: [{ name: "CorosLink Contributors" }],
  creator: "CorosLink Contributors",
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: "CorosLink — Your COROS watch companion for desktop",
    description: DESCRIPTION,
    siteName: "CorosLink",
    images: [
      {
        url: "/og-image.png",
        width: 2360,
        height: 1456,
        alt: "CorosLink desktop app showcase",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CorosLink — Your COROS watch companion for desktop",
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#05080b",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
