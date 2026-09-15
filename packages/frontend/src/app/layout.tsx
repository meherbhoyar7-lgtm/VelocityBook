import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "VelocityBook — High-Performance Matching Engine & Trading Terminal",
  description: "Ultra-low latency in-memory order book matching engine with ACID double-entry ledger settlement, sharded worker execution, and real-time streaming L2 depth.",
  keywords: ["order book", "matching engine", "high frequency trading", "fintech", "cryptocurrency", "acid ledger"],
  authors: [{ name: "VelocityBook Core Engineering" }],
  openGraph: {
    title: "VelocityBook — High-Performance Matching Engine",
    description: "Ultra-low latency in-memory order book matching engine with sharded worker execution",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
