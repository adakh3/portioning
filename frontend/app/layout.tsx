import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import AppShell from "@/components/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face for the public landing + sign-in pages (REL-482).
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const SITE_DESCRIPTION =
  "Win more catering revenue — capture every inquiry, quote in minutes, and close more " +
  "events, with AI drafting the follow-ups and triaging your leads.";

// `/` is now the public front door, so these tags are what a search crawler or a
// Slack/LinkedIn unfurl actually reads. The title stays short because it is also
// the browser-tab label on every staff page.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://catering.relogue.com"),
  title: "Relogue Catering",
  description: SITE_DESCRIPTION,
  openGraph: {
    title: "Relogue Catering — quote fast, win more",
    description: SITE_DESCRIPTION,
    type: "website",
    images: [{ url: "/landing/hero.jpg", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Relogue Catering — quote fast, win more",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
