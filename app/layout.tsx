import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@excalidraw/excalidraw/index.css";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "SapphireAI - The interviewer that sees how you think",
    template: "%s | SapphireAI"
  },
  description:
    "Practice a beginner-friendly AI engineering interview on a live whiteboard with follow-ups grounded in what you said and drew.",
  applicationName: "SapphireAI",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
