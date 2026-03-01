import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Portioning Calculator",
  description: "Catering food portioning calculator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 min-h-screen`}
      >
        <nav className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-6">
            <Link href="/" className="text-lg font-bold text-gray-900">
              Portioning
            </Link>
            <Link href="/events" className="text-sm text-gray-600 hover:text-gray-900">
              Events
            </Link>
            <span className="border-l border-gray-300 h-4" />
            <Link href="/accounts" className="text-sm text-gray-600 hover:text-gray-900">
              Accounts
            </Link>
            <Link href="/leads" className="text-sm text-gray-600 hover:text-gray-900">
              Leads
            </Link>
            <Link href="/quotes" className="text-sm text-gray-600 hover:text-gray-900">
              Quotes
            </Link>
            <Link href="/venues" className="text-sm text-gray-600 hover:text-gray-900">
              Venues
            </Link>
            <span className="border-l border-gray-300 h-4" />
            <Link href="/staff" className="text-sm text-gray-600 hover:text-gray-900">
              Staff
            </Link>
            <Link href="/equipment" className="text-sm text-gray-600 hover:text-gray-900">
              Equipment
            </Link>
            <span className="border-l border-gray-300 h-4" />
            <Link href="/invoices" className="text-sm text-gray-600 hover:text-gray-900">
              Invoices
            </Link>
            <Link href="/pricing" className="text-sm text-gray-600 hover:text-gray-900">
              Pricing
            </Link>
            <span className="border-l border-gray-300 h-4" />
            <Link href="/help" className="text-sm text-gray-600 hover:text-gray-900">
              Help
            </Link>
            <span className="border-l border-gray-300 h-4" />
            <Link href="/settings" className="text-sm text-gray-600 hover:text-gray-900">
              Settings
            </Link>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
